import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { one, pool, query, tx, type Db } from './db'
import { AppError } from './errors'
import { parseContact } from './contact'
import { getEvent } from './events'
import { audit } from './audit'

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex')
export const newToken = () => crypto.randomBytes(32).toString('base64url')
export const hashToken = (t: string) => sha256(`tok:${t}`)

export const BIDDER_SESSION_DAYS = 30
export const ADMIN_SESSION_HOURS = 12

// ───────────── passwords (admin) ─────────────
export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16)
  const h = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`
}
export async function verifyPassword(pw: string, stored: string) {
  const [, saltHex, hashHex] = stored.split('$')
  if (!saltHex || !hashHex) return false
  const h = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64)
  const expected = Buffer.from(hashHex, 'hex')
  return h.length === expected.length && crypto.timingSafeEqual(h, expected)
}

// ───────────── registration & PIN sign-in (bidders) ─────────────
// Email/phone are contact RECORDS only. Identity on a phone = the session cookie; getting back in on another
// device needs bidder number + the 4-digit PIN shown once at registration (volunteers can reset it).
const MAX_PIN_FAILURES = 5
const LOCK_MINUTES = 15

const newPin = () => String(crypto.randomInt(0, 10_000)).padStart(4, '0')

export type BidderRow = {
  id: string
  event_id: string
  bidder_number: number
  name: string
  phone: string | null
  email: string | null
  assisted: boolean
}

export async function registerBidder(rawContact: string, name: string) {
  const contact = parseContact(rawContact)
  if (!contact) throw new AppError('INVALID_CONTACT', 'Enter a valid mobile number (like 719-555-0123) or email address.')
  const clean = name.trim().replace(/\s+/g, ' ')
  if (clean.length < 2) throw new AppError('INVALID_NAME', 'Please enter your full name.')
  if (clean.length > 80) throw new AppError('INVALID_NAME', 'That name is too long.')
  const event = await getEvent()

  // Crude flood guard so a script can't burn through bidder numbers.
  const recent = await one<{ n: number }>(`select count(*)::int n from bidders where event_id = $1 and created_at > now() - interval '1 minute'`, [event.id])
  if ((recent?.n ?? 0) >= 600) throw new AppError('RATE_LIMITED', 'Lots of people are registering right now. Please try again in a minute.', 429)

  const pin = newPin()
  const pinHash = await hashPassword(pin)
  return tx(async (c) => {
    const bidder = await createBidder(c, { eventId: event.id, name: clean, [contact.type]: contact.value })
    await c.query('update bidders set pin_hash = $2 where id = $1', [bidder.id, pinHash])
    const token = await createSession(c, 'bidder_sessions', 'bidder_id', bidder.id, BIDDER_SESSION_DAYS * 24)
    return { bidder, token, pin }
  })
}

const BAD_SIGNIN = () => new AppError('BAD_SIGNIN', 'That bidder number and PIN don’t match. If you’ve lost your PIN, any volunteer can reset it.', 401)

export async function signInBidder(bidderNumber: number, pin: string) {
  if (!Number.isInteger(bidderNumber) || !/^\d{4}$/.test(pin)) throw new AppError('INVALID_SIGNIN', 'Enter your bidder number and 4-digit PIN.')
  const event = await getEvent()
  const b = await one<BidderRow & { pin_hash: string | null; pin_failed: number; locked: boolean }>(
    `select *, coalesce(pin_locked_until > now(), false) as locked from bidders where event_id = $1 and bidder_number = $2`,
    [event.id, bidderNumber],
  )
  // Always do one hash comparison so unknown numbers cost the same as wrong PINs.
  const ok = await verifyPassword(pin, b?.pin_hash ?? 'scrypt$00$00')
  if (!b) throw BAD_SIGNIN()
  if (b.locked) throw new AppError('LOCKED', `Too many wrong PINs. Try again in ${LOCK_MINUTES} minutes, or ask a volunteer to reset your PIN.`, 429)
  if (!ok || !b.pin_hash) {
    const failed = b.pin_failed + 1
    if (failed >= MAX_PIN_FAILURES) {
      await query(`update bidders set pin_failed = 0, pin_locked_until = now() + ($2 || ' minutes')::interval where id = $1`, [b.id, String(LOCK_MINUTES)])
    } else {
      await query('update bidders set pin_failed = $2 where id = $1', [b.id, failed])
    }
    throw BAD_SIGNIN()
  }
  await query('update bidders set pin_failed = 0, pin_locked_until = null where id = $1', [b.id])
  const token = await createSession(pool(), 'bidder_sessions', 'bidder_id', b.id, BIDDER_SESSION_DAYS * 24)
  return { bidder: b as BidderRow, token }
}

/** Staff-only: issue a fresh PIN (also clears any lockout and signs the guest out everywhere). */
export async function resetBidderPin(bidderId: string, adminId: string) {
  const pin = newPin()
  const row = await one<{ event_id: string; bidder_number: number }>(
    'update bidders set pin_hash = $2, pin_failed = 0, pin_locked_until = null where id = $1 returning event_id, bidder_number',
    [bidderId, await hashPassword(pin)],
  )
  if (!row) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
  await query('delete from bidder_sessions where bidder_id = $1', [bidderId])
  await audit({ eventId: row.event_id, actorType: 'admin', actorId: adminId, action: 'bidder.pin_reset', entityType: 'bidder', entityId: bidderId, details: { bidderNumber: row.bidder_number } })
  return { pin, bidderNumber: row.bidder_number }
}

/** Allocates the next human-readable bidder number (also the paddle number) under a row lock. */
export async function createBidder(
  db: Db,
  p: { eventId: string; name: string; phone?: string | null; email?: string | null; assisted?: boolean; adminId?: string; verified?: boolean },
): Promise<BidderRow> {
  const ev = await one<{ next_bidder_number: number }>(
    'update events set next_bidder_number = next_bidder_number + 1 where id = $1 returning next_bidder_number - 1 as next_bidder_number',
    [p.eventId],
    db,
  )
  if (!ev) throw new AppError('NO_EVENT', 'Event not found', 500)
  try {
    const row = await one<BidderRow>(
      `insert into bidders (event_id, bidder_number, name, phone, email, assisted, registered_by_admin_id, verified_at)
       values ($1,$2,$3,$4,$5,$6,$7, ${p.verified ? 'now()' : 'null'}) returning *`,
      [p.eventId, ev.next_bidder_number, p.name, p.phone ?? null, p.email ?? null, !!p.assisted, p.adminId ?? null],
      db,
    )
    return row!
  } catch (e: any) {
    if (e.code === '23505') throw new AppError('DUPLICATE_CONTACT', 'That phone or email is already registered. Sign in with your bidder number and PIN, or ask a volunteer for help.', 409)
    throw e
  }
}

// ───────────── sessions ─────────────
export async function createSession(db: Db, table: 'bidder_sessions' | 'admin_sessions', col: 'bidder_id' | 'admin_id', id: string, hours: number) {
  const token = newToken()
  await query(
    `insert into ${table} (token_hash, ${col}, expires_at) values ($1,$2, now() + ($3 || ' hours')::interval)`,
    [hashToken(token), id, String(hours)],
    db,
  )
  return token
}

export async function bidderFromToken(token: string | undefined) {
  if (!token) return null
  return (
    (await one<BidderRow>(
      `select b.* from bidder_sessions s join bidders b on b.id = s.bidder_id
        where s.token_hash = $1 and s.expires_at > now()`,
      [hashToken(token)],
    )) ?? null
  )
}

export type AdminRow = { id: string; email: string; name: string; role: 'admin' | 'volunteer' }

export async function adminFromToken(token: string | undefined) {
  if (!token) return null
  return (
    (await one<AdminRow>(
      `select a.id, a.email, a.name, a.role from admin_sessions s join admin_users a on a.id = s.admin_id
        where s.token_hash = $1 and s.expires_at > now() and a.active`,
      [hashToken(token)],
    )) ?? null
  )
}

export async function adminLogin(email: string, password: string) {
  const row = await one<AdminRow & { password_hash: string; active: boolean }>(
    'select * from admin_users where lower(email) = lower($1)',
    [email.trim()],
  )
  // Always run a hash to keep timing similar whether or not the account exists.
  const ok = await verifyPassword(password, row?.password_hash ?? 'scrypt$00$00')
  if (!row || !row.active || !ok) throw new AppError('BAD_LOGIN', 'Incorrect email or password.', 401)
  const token = await createSession(await import('./db').then((m) => m.pool()), 'admin_sessions', 'admin_id', row.id, ADMIN_SESSION_HOURS)
  await audit({ actorType: 'admin', actorId: row.id, action: 'admin.login', entityType: 'admin_user', entityId: row.id })
  return { token, admin: { id: row.id, email: row.email, name: row.name, role: row.role } }
}

export async function createAdminUser(p: { email: string; name: string; password: string; role: 'admin' | 'volunteer' }) {
  if (p.password.length < 8) throw new AppError('WEAK_PASSWORD', 'Password must be at least 8 characters.')
  try {
    return await one<AdminRow>(
      'insert into admin_users (email, name, password_hash, role) values ($1,$2,$3,$4) returning id, email, name, role',
      [p.email.trim().toLowerCase(), p.name.trim(), await hashPassword(p.password), p.role],
    )
  } catch (e: any) {
    if (e.code === '23505') throw new AppError('DUPLICATE', 'A staff account with that email already exists.', 409)
    throw e
  }
}
