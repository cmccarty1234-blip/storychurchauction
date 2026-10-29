import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '@/lib/db'
import { activatePowerUp, inventory, powerupRevenue, recordPurchase } from '@/lib/powerups'
import { pieLine, pieSummary, throwPie } from '@/lib/pies'
import { gameState } from '@/lib/game-state'
import { startLiveItem } from '@/lib/bidding'
import { expectError, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  await query(`update powerup_defs set enabled = (code not in ('block','back_in')), price_cents = case code when 'pie_small' then 10000 when 'pie_large' then 20000 else price_cents end`)
  ev = await makeEvent()
  admin = await makeAdmin()
  await query(`update events set game_mode = true where id = $1`, [ev.id])
})
const buy = (bidderId: string, code: string, quantity = 1, method = 'cash') => recordPurchase({ bidderId, code, quantity, method, adminId: admin.id, idempotencyKey: key() })
const left = async (bidderId: string, code: string) => (await inventory(bidderId)).find((r) => r.code === code)!.available

describe('Pie Brandon in the Face', () => {
  it('sign-ups at $100 / $200 are counted in their own line, not as Power-Up sales', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    await buy(a.id, 'pie_small', 2)
    await buy(b.id, 'pie_large', 1)
    await buy(b.id, 'final_call', 1)
    expect(await pieSummary(ev.id)).toMatchObject({ smallSold: 2, largeSold: 1, smallLeft: 2, largeLeft: 1, thrown: 0, cents: 40000 })
    expect((await powerupRevenue(ev.id)).totalCents).toBe(1500) // only the Final Call
    const st = await gameState(ev.id)
    expect(st.totals).toMatchObject({ powerupCents: 1500, pieCents: 40000 })
    expect(st.pies).toMatchObject({ smallSold: 2, largeSold: 1 })
    expect(await query('select 1 from payments')).toHaveLength(0) // never part of an auction checkout
  })

  it('the line is in sign-up order and shrinks as pies are thrown', async () => {
    const [a, b, c] = await makeBidders(ev.id, 3)
    await buy(b.id, 'pie_large', 1)
    await buy(a.id, 'pie_small', 2)
    await buy(c.id, 'pie_small', 1)
    let line = await pieLine(ev.id)
    expect(line.map((l) => `${l.bidderNumber}:${l.size}`)).toEqual([`${b.bidder_number}:large`, `${a.bidder_number}:small`, `${a.bidder_number}:small`, `${c.bidder_number}:small`])
    await throwPie({ eventId: ev.id, bidderNumber: b.bidder_number, code: 'pie_large', adminId: admin.id })
    await throwPie({ eventId: ev.id, bidderNumber: a.bidder_number, code: 'pie_small', adminId: admin.id })
    line = await pieLine(ev.id)
    expect(line.map((l) => `${l.bidderNumber}:${l.size}`)).toEqual([`${a.bidder_number}:small`, `${c.bidder_number}:small`])
    expect((await pieSummary(ev.id)).thrown).toBe(2)
  })

  it('a guest can never throw more pies than they paid for, even with simultaneous taps', async () => {
    const [a] = await makeBidders(ev.id, 1)
    await buy(a.id, 'pie_small', 1)
    const res = await Promise.allSettled([1, 2, 3].map(() => throwPie({ eventId: ev.id, bidderNumber: a.bidder_number, code: 'pie_small', adminId: admin.id })))
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await left(a.id, 'pie_small')).toBe(0)
    await expectError(throwPie({ eventId: ev.id, bidderNumber: a.bidder_number, code: 'pie_small', adminId: admin.id }), 'NO_PIE')
    await expectError(throwPie({ eventId: ev.id, bidderNumber: a.bidder_number, code: 'pie_large', adminId: admin.id }), 'NO_PIE')
  })

  it('announces each throw on the projector feed, from the real event only', async () => {
    const [a] = await makeBidders(ev.id, 1)
    await buy(a.id, 'pie_large', 1)
    expect((await gameState(ev.id)).announcements).toHaveLength(0)
    await throwPie({ eventId: ev.id, bidderNumber: a.bidder_number, code: 'pie_large', adminId: admin.id })
    const ann = (await gameState(ev.id)).announcements
    expect(ann[0]).toMatchObject({ kind: 'pie.thrown', interrupt: true })
    expect(ann[0].headline).toContain(`#${a.bidder_number}`)
  })

  it('is not a Power-Up: guests cannot "activate" it on an auction item', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await makeItem(ev.id, { kind: 'live' })
    await startLiveItem(it.id, admin.id)
    await buy(a.id, 'pie_small', 1)
    await expectError(activatePowerUp({ bidderId: a.id, itemId: it.id, code: 'pie_small', idempotencyKey: key() }), 'NOT_ELIGIBLE')
    expect(await left(a.id, 'pie_small')).toBe(1)
  })

  it('a voided sign-up drops out of the line and the totals', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const r = await buy(a.id, 'pie_large', 1)
    const { voidPurchase } = await import('@/lib/powerups')
    await voidPurchase(r.id, admin.id, 'typo')
    expect(await pieLine(ev.id)).toHaveLength(0)
    expect((await pieSummary(ev.id)).cents).toBe(0)
  })
})
