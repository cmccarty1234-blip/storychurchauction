import { beforeEach, describe, expect, it } from 'vitest'
import { one, pool, query } from '@/lib/db'
import { adminFromToken, adminLogin, bidderFromToken, createBidder, registerBidder, resetBidderPin, signInBidder } from '@/lib/auth-core'
import { parseContact } from '@/lib/contact'
import { expectError, makeAdmin, makeEvent, resetDb } from './helpers'

beforeEach(async () => {
  await resetDb()
  await makeEvent()
})

describe('contact parsing', () => {
  it('normalizes phones and emails and rejects junk', () => {
    expect(parseContact('719-555-0123')).toEqual({ type: 'phone', value: '+17195550123' })
    expect(parseContact('(719) 555 0123')).toEqual({ type: 'phone', value: '+17195550123' })
    expect(parseContact('1 719 555 0123')).toEqual({ type: 'phone', value: '+17195550123' })
    expect(parseContact(' Jane@Example.COM ')).toEqual({ type: 'email', value: 'jane@example.com' })
    for (const bad of ['', '12345', 'abc', 'jane@', '@x.com', 'jane@x', '719-555-012']) expect(parseContact(bad)).toBeNull()
  })
})

describe('bidder registration (name + contact → bidder number + PIN)', () => {
  it('registers with name + phone: bidder #1001, a 4-digit PIN, and a persistent session', async () => {
    const r = await registerBidder('719-555-0123', 'Jane Doe')
    expect(r.bidder.bidder_number).toBe(1001)
    expect(r.bidder.phone).toBe('+17195550123')
    expect(r.pin).toMatch(/^\d{4}$/)
    expect((await bidderFromToken(r.token))?.id).toBe(r.bidder.id)
    expect((await bidderFromToken(r.token))?.name).toBe('Jane Doe') // session persists across lookups
  })

  it('registers with name + email (normalised to lower case)', async () => {
    const r = await registerBidder('Jane@Example.com', 'Jane Doe')
    expect(r.bidder.email).toBe('jane@example.com')
    expect(r.bidder.phone).toBeNull()
  })

  it('stores only a hash of the PIN', async () => {
    const r = await registerBidder('719-555-0123', 'Jane Doe')
    const row = await one<{ pin_hash: string }>('select pin_hash from bidders where id = $1', [r.bidder.id])
    expect(row!.pin_hash.startsWith('scrypt$')).toBe(true)
    expect(row!.pin_hash).not.toContain(`$${r.pin}`)
  })

  it('rejects invalid contact info and invalid names', async () => {
    await expectError(registerBidder('not-a-contact', 'Jane Doe'), 'INVALID_CONTACT')
    await expectError(registerBidder('719-555', 'Jane Doe'), 'INVALID_CONTACT')
    await expectError(registerBidder('719-555-0123', ' '), 'INVALID_NAME')
    await expectError(registerBidder('719-555-0123', 'x'.repeat(81)), 'INVALID_NAME')
  })

  it('refuses a duplicate registration: no second bidder, and the first account is untouched', async () => {
    const first = await registerBidder('719-555-0123', 'Jane Doe')
    await expectError(registerBidder('(719) 555-0123', 'Someone Else'), 'DUPLICATE_CONTACT')
    await registerBidder('jane@example.com', 'Jane Again')
    await expectError(registerBidder('JANE@example.com', 'Jane Third'), 'DUPLICATE_CONTACT')
    const rows = await query<{ name: string }>('select name from bidders where id = $1', [first.bidder.id])
    expect(rows[0].name).toBe('Jane Doe')
    expect((await one<{ n: number }>('select count(*)::int n from bidders'))!.n).toBe(2)
  })

  it('a bidder number alone (or a wrong PIN) cannot sign in', async () => {
    const r = await registerBidder('719-555-0123', 'Jane Doe')
    const wrong = r.pin === '0000' ? '1111' : '0000'
    await expectError(signInBidder(r.bidder.bidder_number, wrong), 'BAD_SIGNIN')
    await expectError(signInBidder(9999, r.pin), 'BAD_SIGNIN') // unknown number looks identical
    await expectError(signInBidder(r.bidder.bidder_number, ''), 'INVALID_SIGNIN')
  })

  it('signs back in on a new device with number + PIN (the old session keeps working)', async () => {
    const r = await registerBidder('719-555-0123', 'Jane Doe')
    const again = await signInBidder(r.bidder.bidder_number, r.pin)
    expect(again.bidder.id).toBe(r.bidder.id)
    expect(again.token).not.toBe(r.token)
    expect((await bidderFromToken(again.token))?.id).toBe(r.bidder.id)
    expect((await bidderFromToken(r.token))?.id).toBe(r.bidder.id)
  })

  it('locks sign-in after 5 wrong PINs, even for the right PIN, until the lock passes', async () => {
    const r = await registerBidder('719-555-0123', 'Jane Doe')
    const wrong = r.pin === '0000' ? '1111' : '0000'
    for (let i = 0; i < 5; i++) await expectError(signInBidder(r.bidder.bidder_number, wrong), 'BAD_SIGNIN')
    await expectError(signInBidder(r.bidder.bidder_number, r.pin), 'LOCKED')
    await query(`update bidders set pin_locked_until = now() - interval '1 second' where id = $1`, [r.bidder.id])
    await signInBidder(r.bidder.bidder_number, r.pin)
  })

  it('a volunteer PIN reset issues a new PIN, signs the guest out everywhere, and is audited', async () => {
    const admin = await makeAdmin('volunteer')
    const r = await registerBidder('719-555-0123', 'Jane Doe')
    for (let i = 0; i < 5; i++) await signInBidder(r.bidder.bidder_number, r.pin === '0000' ? '1111' : '0000').catch(() => {})
    const reset = await resetBidderPin(r.bidder.id, admin.id)
    expect(reset.pin).toMatch(/^\d{4}$/)
    expect(await bidderFromToken(r.token)).toBeNull()
    await signInBidder(r.bidder.bidder_number, reset.pin) // lockout cleared too
    expect(await one(`select 1 from audit_logs where action = 'bidder.pin_reset'`)).toBeTruthy()
  })

  it('assisted bidders get unique sequential numbers and need no contact; no PIN until staff issue one', async () => {
    const ev = await one<{ id: string }>('select id from events')
    const admin = await makeAdmin()
    const a = await createBidder(pool(), { eventId: ev!.id, name: 'Grandma Rose', assisted: true, adminId: admin.id })
    const b = await createBidder(pool(), { eventId: ev!.id, name: 'Grandpa Joe', assisted: true, adminId: admin.id })
    expect([a.bidder_number, b.bidder_number]).toEqual([1001, 1002])
    await expectError(signInBidder(a.bidder_number, '1234'), 'BAD_SIGNIN')
  })

  it('concurrent registrations never share a bidder number', async () => {
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => registerBidder(`719-555-${String(2000 + i)}`, `Guest ${i}`)))
    const nums = res.map((r) => r.bidder.bidder_number)
    expect(new Set(nums).size).toBe(20)
    expect(Math.min(...nums)).toBe(1001)
    expect(Math.max(...nums)).toBe(1020)
  })
})

describe('admin authentication', () => {
  it('logs in with the right password only; unknown/wrong/inactive are rejected identically', async () => {
    await makeAdmin('admin', 'a@test.local')
    const ok = await adminLogin('A@test.local', 'password123')
    expect((await adminFromToken(ok.token))?.role).toBe('admin')
    await expectError(adminLogin('a@test.local', 'wrong-password'), 'BAD_LOGIN')
    await expectError(adminLogin('nobody@test.local', 'password123'), 'BAD_LOGIN')
    await query(`update admin_users set active = false`)
    await expectError(adminLogin('a@test.local', 'password123'), 'BAD_LOGIN')
    expect(await adminFromToken(ok.token)).toBeNull() // deactivation kills existing sessions
  })

  it('a bidder session token is not an admin session', async () => {
    const { token } = await registerBidder('719-555-0123', 'Jane Doe')
    expect(await adminFromToken(token)).toBeNull()
    expect(await adminFromToken('garbage')).toBeNull()
    expect(await adminFromToken(undefined)).toBeNull()
  })
})
