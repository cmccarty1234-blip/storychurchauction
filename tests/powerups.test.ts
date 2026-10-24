import { beforeEach, describe, expect, it } from 'vitest'
import { one, query, tx } from '@/lib/db'
import { placeSilentBid, requestLiveBid, setLiveRunState, startLiveItem } from '@/lib/bidding'
import { advance } from '@/lib/lifecycle'
import { activatePowerUp, inventory, powerupRevenue, previewPowerUp, recordPurchase, updateDef, voidPurchase } from '@/lib/powerups'
import { expectError, itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  await query(`update powerup_defs set enabled = (code not in ('block','back_in')), price_cents = case code when 'resurrection' then 3000 when 'final_call' then 1500 when 'knockout' then 3000 when 'challenge_flag' then 2000 when 'block' then 5000 else 1500 end, max_per_bidder = null`)
  ev = await makeEvent()
  admin = await makeAdmin()
  await query(`update events set game_mode = true, auto_accept_live = true where id = $1`, [ev.id])
})

const tick = (id: string) => tx((c) => advance(c, id))
async function age(itemId: string, secs: number) {
  await query(
    `update auction_items set deadline_at = deadline_at - make_interval(secs => $2), provisional_until = provisional_until - make_interval(secs => $2),
            started_at = started_at - make_interval(secs => $2) where id = $1`,
    [itemId, secs],
  )
}
const buy = (bidderId: string, code: string, quantity = 1, method = 'cash') =>
  recordPurchase({ bidderId, code, quantity, method, adminId: admin.id, idempotencyKey: key() })
const use = (bidderId: string, itemId: string, code: string, extra: { targetNumber?: number; amountCents?: number } = {}) =>
  activatePowerUp({ bidderId, itemId, code, idempotencyKey: key(), ...extra })
const phone = (b: string, item: string, amt: number) => requestLiveBid({ bidderId: b, itemId: item, amountCents: amt, idempotencyKey: key() })

async function liveItem(over: Record<string, unknown> = {}) {
  const it = await makeItem(ev.id, { kind: 'live', start: 5000, inc: 500, ...over })
  await startLiveItem(it.id, admin.id)
  return it
}
/** Live item with two bids, closed into its provisional window. */
async function provisionalLive() {
  const [a, b, c] = await makeBidders(ev.id, 3)
  const it = await liveItem()
  await phone(a.id, it.id, 5000)
  await phone(b.id, it.id, 5500)
  await setLiveRunState(it.id, 'close', admin.id, true)
  return { it, a, b, c }
}
const avail = async (bidderId: string, code: string) => (await inventory(bidderId)).find((r) => r.code === code)!.available

describe('purchases & inventory', () => {
  it('a recorded sale credits inventory immediately; the same submission twice is one sale', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const k = key()
    const r1 = await recordPurchase({ bidderId: a.id, code: 'resurrection', quantity: 2, method: 'cash', adminId: admin.id, idempotencyKey: k })
    const r2 = await recordPurchase({ bidderId: a.id, code: 'resurrection', quantity: 2, method: 'cash', adminId: admin.id, idempotencyKey: k })
    expect(r2.replay).toBe(true)
    expect(r2.id).toBe(r1.id)
    expect(await avail(a.id, 'resurrection')).toBe(2)
    expect((await powerupRevenue(ev.id)).totalCents).toBe(6000)
  })

  it('revenue is reported separately by method; complimentary units are free; nothing touches winning_results or payments', async () => {
    const [a] = await makeBidders(ev.id, 1)
    await buy(a.id, 'final_call', 2, 'cash')
    await buy(a.id, 'knockout', 1, 'check')
    await buy(a.id, 'challenge_flag', 1, 'card_terminal')
    await buy(a.id, 'final_call', 1, 'comp')
    const rev = await powerupRevenue(ev.id)
    expect(rev).toMatchObject({ cashCents: 3000, checkCents: 3000, cardCents: 2000, totalCents: 8000, units: 5, complimentaryUnits: 1 })
    expect(await query('select 1 from payments')).toHaveLength(0)
    expect(await query('select 1 from winning_results')).toHaveLength(0)
  })

  it('refuses disabled Power-Ups and per-guest limits; void is refused once units are used', async () => {
    const [a] = await makeBidders(ev.id, 1)
    await expectError(buy(a.id, 'block'), 'POWERUP_DISABLED')
    await query(`update powerup_defs set max_per_bidder = 2 where code = 'final_call'`)
    await buy(a.id, 'final_call', 2)
    await expectError(buy(a.id, 'final_call', 1), 'LIMIT')
    const p = await buy(a.id, 'resurrection', 1)
    await voidPurchase(p.id, admin.id, 'typo')
    expect(await avail(a.id, 'resurrection')).toBe(0)
    await expectError(voidPurchase(p.id, admin.id, 'again'), 'ALREADY_VOIDED')
    expect((await powerupRevenue(ev.id)).totalCents).toBe(3000)
  })

  it('a sale cannot be voided once its units have been used', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const sale = await buy(a.id, 'final_call', 1)
    const item = await liveItem()
    await use(a.id, item.id, 'final_call')
    await expectError(voidPurchase(sale.id, admin.id, 'refund'), 'ALREADY_USED')
  })

  it('price changes apply to new sales only', async () => {
    const [a] = await makeBidders(ev.id, 1)
    await buy(a.id, 'final_call')
    await updateDef('final_call', { price_cents: 2500 }, admin.id)
    await buy(a.id, 'final_call')
    expect((await powerupRevenue(ev.id)).totalCents).toBe(1500 + 2500)
  })
})

describe('activation basics', () => {
  it('needs inventory, game mode and a legal target — and consumes nothing when refused', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await liveItem()
    await expectError(use(a.id, it.id, 'final_call'), 'NO_INVENTORY')
    await buy(a.id, 'resurrection')
    await expectError(use(a.id, it.id, 'resurrection'), 'NOT_ELIGIBLE') // item is not in its window
    expect(await avail(a.id, 'resurrection')).toBe(1)
    await query(`update events set game_mode = false`)
    await buy(a.id, 'final_call')
    await expectError(use(a.id, it.id, 'final_call'), 'GAME_OFF')
    expect(await avail(a.id, 'final_call')).toBe(1)
  })

  it('a double-tapped activation (same key) uses one unit, not two', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await liveItem()
    await buy(a.id, 'final_call', 2)
    const k = key()
    await activatePowerUp({ bidderId: a.id, itemId: it.id, code: 'final_call', idempotencyKey: k })
    const again = await activatePowerUp({ bidderId: a.id, itemId: it.id, code: 'final_call', idempotencyKey: k })
    expect(again.replay).toBe(true)
    expect(await avail(a.id, 'final_call')).toBe(1)
  })

  it('preview reports the exact effect without consuming anything', async () => {
    const { it, c } = await provisionalLive()
    await buy(c.id, 'resurrection')
    const p = await previewPowerUp({ bidderId: c.id, itemId: it.id, code: 'resurrection' })
    expect(p.seconds).toBe(60)
    expect(p.effect).toMatch(/60 seconds/)
    expect(await avail(c.id, 'resurrection')).toBe(1)
    expect((await itemRow(it.id)).status).toBe('provisional')
  })
})

describe('Resurrection', () => {
  it('reopens a provisional item for 60 s; the prior leader keeps the lead; the activator does not win automatically', async () => {
    const { it, a, b, c } = await provisionalLive()
    await buy(c.id, 'resurrection')
    const until = (await itemRow(it.id)).provisional_until
    const r = await use(c.id, it.id, 'resurrection')
    expect(r.seconds).toBe(60)
    const row = await itemRow(it.id)
    expect(row.status).toBe('reopened')
    expect(row.current_bidder_id).toBe(b.id)
    expect(row.current_bid_cents).toBe(5500)
    expect(row.provisional_until).toEqual(until) // the deadline never resets
    expect(await avail(c.id, 'resurrection')).toBe(0)
    // everyone may bid while it's open; earlier bids stay in history
    await phone(a.id, it.id, 6000)
    expect((await query('select 1 from live_accepted_bids where item_id = $1', [it.id])).length).toBe(3)
    // reopening ends → back to the remainder of the provisional window → finalizes to the highest bid
    await age(it.id, 61)
    await tick(it.id)
    expect((await itemRow(it.id)).status).toBe('provisional')
    await age(it.id, 300)
    await tick(it.id)
    const w = await query('select bidder_id, amount_cents from winning_results')
    expect(w).toEqual([{ bidder_id: a.id, amount_cents: 6000 }])
  })

  it('is limited to one reopening per item, whoever pays for it', async () => {
    const { it, a, c } = await provisionalLive()
    await buy(c.id, 'resurrection')
    await buy(a.id, 'resurrection')
    await use(c.id, it.id, 'resurrection')
    await age(it.id, 61)
    await tick(it.id)
    await expectError(use(a.id, it.id, 'resurrection'), 'LIMIT')
    expect(await avail(a.id, 'resurrection')).toBe(1)
  })

  it('shows/limits the real remaining time and refuses when too little is left', async () => {
    const { it, c } = await provisionalLive()
    await buy(c.id, 'resurrection')
    await query(`update auction_items set provisional_until = now() + interval '25 seconds' where id = $1`, [it.id])
    const p = await previewPowerUp({ bidderId: c.id, itemId: it.id, code: 'resurrection' })
    expect(p.seconds).toBeLessThanOrEqual(25)
    expect(p.effect).toMatch(/only has/)
    const r = await use(c.id, it.id, 'resurrection')
    const d = (await one<{ s: number }>(`select extract(epoch from deadline_at - now())::int s from auction_items where id = $1`, [it.id]))!.s
    expect(d).toBeLessThanOrEqual(25)
    expect(r.seconds).toBeLessThanOrEqual(25)

    const other = await provisionalLive2()
    await buy(other.c.id, 'resurrection')
    await query(`update auction_items set provisional_until = now() + interval '5 seconds' where id = $1`, [other.it.id])
    await expectError(use(other.c.id, other.it.id, 'resurrection'), 'TOO_LATE')
    expect(await avail(other.c.id, 'resurrection')).toBe(1)
  })

  it('cannot be used after finalization', async () => {
    const { it, c } = await provisionalLive()
    await buy(c.id, 'resurrection')
    await age(it.id, 301)
    await tick(it.id)
    expect((await itemRow(it.id)).status).toBe('finalized')
    await expectError(use(c.id, it.id, 'resurrection'), 'NOT_ELIGIBLE')
    expect(await avail(c.id, 'resurrection')).toBe(1)
  })

  it('works on silent items too', async () => {
    await query(`update events set provisional_silent = true where id = $1`, [ev.id])
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await makeItem(ev.id, { num: 1 })
    await placeSilentBid({ bidderId: a.id, itemId: it.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    await query(`update auction_items set closes_at = now() - interval '10 seconds' where id = $1`, [it.id])
    await tick(it.id)
    expect((await itemRow(it.id)).status).toBe('provisional')
    await buy(b.id, 'resurrection')
    await use(b.id, it.id, 'resurrection')
    await placeSilentBid({ bidderId: b.id, itemId: it.id, amountCents: 5500, expectedCurrentCents: 5000, idempotencyKey: key() })
    expect((await itemRow(it.id)).current_bidder_id).toBe(b.id)
  })
})

async function provisionalLive2() {
  // helper for a second independent item (needs its own bidders)
  const bs = await makeBidders(ev.id, 3)
  const it = await liveItem()
  await phone(bs[0].id, it.id, 5000)
  await setLiveRunState(it.id, 'close', admin.id, true)
  return { it, c: bs[2] }
}

describe('Final Call', () => {
  it('adds 30 s on the server; max one per bidder per item and two per item', async () => {
    const [a, b, c] = await makeBidders(ev.id, 3)
    const it = await liveItem()
    for (const x of [a, b, c]) await buy(x.id, 'final_call', 2)
    const d0 = (await itemRow(it.id)).deadline_at as Date
    await use(a.id, it.id, 'final_call')
    expect(((await itemRow(it.id)).deadline_at as Date).getTime() - d0.getTime()).toBe(30_000)
    await expectError(use(a.id, it.id, 'final_call'), 'LIMIT')
    await use(b.id, it.id, 'final_call')
    await expectError(use(c.id, it.id, 'final_call'), 'LIMIT') // two per item
    expect(await avail(c.id, 'final_call')).toBe(2)
  })

  it('cannot be used once bidding has closed, so it cannot bypass the provisional deadline', async () => {
    const { it, c } = await provisionalLive()
    await buy(c.id, 'final_call')
    await expectError(use(c.id, it.id, 'final_call'), 'NOT_ELIGIBLE')
  })

  it('extends a silent item’s own closing time', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await makeItem(ev.id, { num: 1 })
    await buy(a.id, 'final_call')
    const e = await one<{ silent_close_at: Date }>('select silent_close_at from events where id = $1', [ev.id])
    await use(a.id, it.id, 'final_call')
    expect(((await itemRow(it.id)).closes_at as Date).getTime() - e!.silent_close_at.getTime()).toBe(30_000)
  })
})

describe('The Knockout', () => {
  it('needs a configured minimum bid that has been reached, and ends bidding into the provisional window', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveItem()
    await buy(b.id, 'knockout', 2)
    await expectError(use(b.id, it.id, 'knockout'), 'NOT_ELIGIBLE') // no minimum configured
    await query('update auction_items set min_qualifying_bid_cents = 8000 where id = $1', [it.id])
    await phone(a.id, it.id, 5000)
    await expectError(use(b.id, it.id, 'knockout'), 'NOT_ELIGIBLE') // not reached yet
    await phone(b.id, it.id, 8000)
    await use(b.id, it.id, 'knockout')
    const row = await itemRow(it.id)
    expect(row.status).toBe('provisional')
    expect(row.current_bidder_id).toBe(b.id)
    expect(await query('select 1 from winning_results')).toHaveLength(0) // knockout never finalizes ownership
    await expectError(use(b.id, it.id, 'knockout'), 'LIMIT') // one Knockout per item
  })

  it('must be used before the final countdown begins', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveItem()
    await query('update auction_items set min_qualifying_bid_cents = 5000 where id = $1', [it.id])
    await phone(a.id, it.id, 5000)
    await buy(b.id, 'knockout')
    await age(it.id, 61)
    await tick(it.id) // countdown phase
    await expectError(use(b.id, it.id, 'knockout'), 'TOO_LATE')
    expect(await avail(b.id, 'knockout')).toBe(1)
  })

  it('Resurrection remains available after a Knockout', async () => {
    const [a, b, c] = await makeBidders(ev.id, 3)
    const it = await liveItem()
    await query('update auction_items set min_qualifying_bid_cents = 5000 where id = $1', [it.id])
    await phone(a.id, it.id, 5000)
    await buy(b.id, 'knockout')
    await buy(c.id, 'resurrection')
    await use(b.id, it.id, 'knockout')
    await use(c.id, it.id, 'resurrection')
    expect((await itemRow(it.id)).status).toBe('reopened')
  })
})

describe('Challenge Flag', () => {
  it('places the qualifying bid and opens a 20 s challenge together; the window deadline does not move', async () => {
    const { it, c } = await provisionalLive()
    await buy(c.id, 'challenge_flag')
    const until = (await itemRow(it.id)).provisional_until
    const r = await use(c.id, it.id, 'challenge_flag', { amountCents: 6000 })
    expect(r.seconds).toBe(20)
    const row = await itemRow(it.id)
    expect(row.status).toBe('reopened')
    expect(row.current_bidder_id).toBe(c.id)
    expect(row.current_bid_cents).toBe(6000)
    expect(row.provisional_until).toEqual(until)
    expect(await avail(c.id, 'challenge_flag')).toBe(0)
  })

  it('a rejected challenge bid does NOT consume the Flag', async () => {
    const { it, c, b } = await provisionalLive()
    await buy(c.id, 'challenge_flag')
    await expectError(use(c.id, it.id, 'challenge_flag', { amountCents: 5500 }), 'TOO_LOW')
    await expectError(use(c.id, it.id, 'challenge_flag', {}), 'BID_REQUIRED')
    await buy(b.id, 'challenge_flag')
    await expectError(use(b.id, it.id, 'challenge_flag', { amountCents: 9000 }), 'ALREADY_LEADING')
    expect(await avail(c.id, 'challenge_flag')).toBe(1)
    expect((await itemRow(it.id)).status).toBe('provisional')
    expect(await query('select 1 from powerup_activations')).toHaveLength(0)
  })

  it('is live-only, once per item, and others may respond; highest accepted bid wins', async () => {
    const { it, a, c } = await provisionalLive()
    await buy(c.id, 'challenge_flag')
    await buy(a.id, 'challenge_flag')
    await use(c.id, it.id, 'challenge_flag', { amountCents: 6000 })
    await phone(a.id, it.id, 6500) // response during the challenge
    await age(it.id, 21)
    await tick(it.id)
    expect((await itemRow(it.id)).status).toBe('provisional')
    await expectError(use(a.id, it.id, 'challenge_flag', { amountCents: 9000 }), 'LIMIT')
    await age(it.id, 300)
    await tick(it.id)
    expect(await query('select bidder_id, amount_cents from winning_results')).toEqual([{ bidder_id: a.id, amount_cents: 6500 }])

    const [s] = await makeBidders(ev.id, 1)
    const silent = await makeItem(ev.id, { num: 1 })
    await buy(s.id, 'challenge_flag')
    await expectError(use(s.id, silent.id, 'challenge_flag', { amountCents: 9000 }), 'NOT_ELIGIBLE')
  })

  it('cannot extend the original provisional deadline: a short remainder shortens the challenge', async () => {
    const { it, c } = await provisionalLive()
    await buy(c.id, 'challenge_flag')
    await query(`update auction_items set provisional_until = now() + interval '12 seconds' where id = $1`, [it.id])
    const r = await use(c.id, it.id, 'challenge_flag', { amountCents: 6000 })
    expect(r.seconds).toBeLessThanOrEqual(12)
  })
})

describe('concurrency', () => {
  it('two guests racing for the single Resurrection: exactly one succeeds, the other keeps their unit', async () => {
    const { it, a, c } = await provisionalLive()
    await buy(c.id, 'resurrection')
    await buy(a.id, 'resurrection')
    const res = await Promise.allSettled([use(c.id, it.id, 'resurrection'), use(a.id, it.id, 'resurrection')])
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await query('select 1 from powerup_activations')).length).toBe(1)
    expect((await avail(c.id, 'resurrection')) + (await avail(a.id, 'resurrection'))).toBe(1)
  })

  it('one unit cannot be spent twice from two devices on two items', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const i1 = await liveItem()
    const i2 = await makeItem(ev.id, { kind: 'live' })
    await query(`update auction_items set status = 'open', timed = true, timer_phase = 'initial', deadline_at = now() + interval '60 seconds', started_at = now() where id = $1`, [i2.id]).catch(() => {})
    await buy(a.id, 'final_call', 1)
    const res = await Promise.allSettled([use(a.id, i1.id, 'final_call'), use(a.id, i2.id, 'final_call')])
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await avail(a.id, 'final_call')).toBe(0)
  })

  it('a bid and a Knockout racing resolve in a single consistent order', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveItem()
    await query('update auction_items set min_qualifying_bid_cents = 5000 where id = $1', [it.id])
    await phone(a.id, it.id, 5000)
    await buy(b.id, 'knockout')
    const bidder = (await makeBidders(ev.id, 1))[0]
    await Promise.allSettled([use(b.id, it.id, 'knockout'), phone(bidder.id, it.id, 5500)])
    const row = await itemRow(it.id)
    expect(row.status).toBe('provisional')
    const top = (await query('select amount_cents from live_accepted_bids order by seq desc limit 1'))[0].amount_cents
    expect(row.current_bid_cents).toBe(top) // leader always equals the last accepted bid
  })
})

describe('Block & Back (safer version, off by default)', () => {
  beforeEach(async () => {
    await query(`update powerup_defs set enabled = true where code in ('block','back_in')`)
  })

  it('blocks one rival on one item for 30 s without cancelling their bids; Back-In lifts it', async () => {
    const [a, b, c] = await makeBidders(ev.id, 3)
    const it = await liveItem()
    await phone(b.id, it.id, 5000)
    await buy(a.id, 'block')
    await buy(b.id, 'back_in')
    await use(a.id, it.id, 'block', { targetNumber: b.bidder_number })
    expect((await itemRow(it.id)).current_bidder_id).toBe(b.id) // earlier bid stands
    await phone(c.id, it.id, 5500)
    await expectError(phone(b.id, it.id, 6000), 'BLOCKED')
    await use(b.id, it.id, 'back_in')
    await phone(b.id, it.id, 6000)
    expect((await itemRow(it.id)).current_bidder_id).toBe(b.id)
  })

  it('cannot block twice per item, block yourself or an assisted guest, or block during the final countdown', async () => {
    const [a, b, c] = await makeBidders(ev.id, 3)
    await query('update bidders set assisted = true where id = $1', [c.id])
    const it = await liveItem()
    await buy(a.id, 'block', 3)
    await expectError(use(a.id, it.id, 'block', { targetNumber: a.bidder_number }), 'NOT_ELIGIBLE')
    await expectError(use(a.id, it.id, 'block', { targetNumber: c.bidder_number }), 'NOT_ELIGIBLE')
    await use(a.id, it.id, 'block', { targetNumber: b.bidder_number })
    await expectError(use(a.id, it.id, 'block', { targetNumber: b.bidder_number }), 'LIMIT') // per-bidder-per-item cap
    await age(it.id, 61)
    await tick(it.id)
    await expectError(use(a.id, it.id, 'block', { targetNumber: b.bidder_number }), 'LIMIT')
    expect(await avail(a.id, 'block')).toBe(2)
  })

  it('holds the item open so the blocked bidder always gets a response window', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveItem()
    await query(`update auction_items set deadline_at = now() + interval '5 seconds' where id = $1`, [it.id])
    await buy(a.id, 'block')
    await use(a.id, it.id, 'block', { targetNumber: b.bidder_number })
    const left = (await one<{ s: number }>(`select extract(epoch from deadline_at - now())::int s from auction_items where id = $1`, [it.id]))!.s
    expect(left).toBeGreaterThanOrEqual(28)
  })

  it('is refused in the countdown phase', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveItem()
    await age(it.id, 61)
    await tick(it.id)
    await buy(a.id, 'block')
    await expectError(use(a.id, it.id, 'block', { targetNumber: b.bidder_number }), 'TOO_LATE')
  })
})
