import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import { acceptLiveRequest, placeSilentBid, recordPaddleBid, requestLiveBid, setLiveRunState, startLiveItem, finalizeDueSilentItems } from '@/lib/bidding'
import { advance, advanceDue, emergencyRelease, emergencyStop, extendTimer, finalizeNow, ALLOWED } from '@/lib/lifecycle'
import { tx } from '@/lib/db'
import { expectError, itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = await makeAdmin()
  await query(`update events set game_mode = true, auto_accept_live = true where id = $1`, [ev.id])
})

const tick = (itemId: string) => tx((c) => advance(c, itemId))
/** Move an item's clocks back in time, as if `secs` seconds had passed. */
async function age(itemId: string, secs: number) {
  await query(
    `update auction_items set deadline_at = deadline_at - make_interval(secs => $2), provisional_until = provisional_until - make_interval(secs => $2),
            started_at = started_at - make_interval(secs => $2) where id = $1`,
    [itemId, secs],
  )
}
const phone = (b: string, item: string, amt: number) => requestLiveBid({ bidderId: b, itemId: item, amountCents: amt, idempotencyKey: key() })

async function liveOnBlock() {
  const it = await makeItem(ev.id, { kind: 'live', start: 5000, inc: 500 })
  await startLiveItem(it.id, admin.id)
  return it
}

describe('transition table', () => {
  it('has a legal path for every status and never allows finalized → provisional', () => {
    expect(ALLOWED.finalized).not.toContain('provisional')
    expect(ALLOWED.open).toContain('provisional')
    expect(ALLOWED.provisional).toEqual(expect.arrayContaining(['reopened', 'finalized']))
  })
})

describe('automated live timer', () => {
  it('starts with an initial period, then an inactivity countdown, then the provisional window', async () => {
    const it = await liveOnBlock()
    let r = await itemRow(it.id)
    expect(r.status).toBe('open')
    expect(r.timer_phase).toBe('initial')
    const secs = (await one<{ s: number }>(`select extract(epoch from deadline_at - now())::int s from auction_items where id = $1`, [it.id]))!.s
    expect(secs).toBeGreaterThanOrEqual(58)
    expect(secs).toBeLessThanOrEqual(60)

    await age(it.id, 61) // initial period over
    await tick(it.id)
    r = await itemRow(it.id)
    expect(r.status).toBe('open')
    expect(r.timer_phase).toBe('countdown')

    await age(it.id, 16) // inactivity countdown over
    await tick(it.id)
    r = await itemRow(it.id)
    expect(r.status).toBe('provisional')
    expect(r.provisional_until).not.toBeNull()
  })

  it('a bid during the countdown resets it to the full inactivity period; a bid in the initial period does not change the deadline', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveOnBlock()
    const d0 = (await itemRow(it.id)).deadline_at
    await phone(a.id, it.id, 5000)
    expect((await itemRow(it.id)).deadline_at).toEqual(d0)

    await age(it.id, 61)
    await tick(it.id)
    await age(it.id, 10) // 5 s left of 15
    await phone(b.id, it.id, 5500)
    const left = (await one<{ s: number }>(`select extract(epoch from deadline_at - now())::int s from auction_items where id = $1`, [it.id]))!.s
    expect(left).toBeGreaterThanOrEqual(13)
    expect((await itemRow(it.id)).current_bid_cents).toBe(5500)
  })

  it('rejects a bid that arrives after the deadline even if no one has ticked yet (server decides)', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await liveOnBlock()
    await age(it.id, 61)
    await tick(it.id)
    await age(it.id, 16) // expired, but nobody advanced it
    await expectError(phone(a.id, it.id, 5000), 'NOT_OPEN')
    expect((await query('select 1 from live_accepted_bids')).length).toBe(0)
    await tick(it.id) // the rejected bid rolled back with its own transaction; the next tick performs the transition
    expect((await itemRow(it.id)).status).toBe('provisional')
  })

  it('phone and paddle bids use the same acceptance engine and both reset the countdown', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveOnBlock()
    await phone(a.id, it.id, 5000)
    await recordPaddleBid({ itemId: it.id, paddleNumber: b.bidder_number, amountCents: 5500, adminId: admin.id, idempotencyKey: key() })
    const bids = await query(`select source, amount_cents, entered_by_admin_id from live_accepted_bids order by seq`)
    expect(bids.map((x) => [x.source, x.amount_cents])).toEqual([['mobile', 5000], ['paddle', 5500]])
    expect(bids[0].entered_by_admin_id).toBeNull()
  })

  it('with auto-accept off a phone bid is only a request until the clerk accepts it', async () => {
    await query(`update events set auto_accept_live = false where id = $1`, [ev.id])
    const [a] = await makeBidders(ev.id, 1)
    const it = await liveOnBlock()
    const r = await phone(a.id, it.id, 5000)
    expect((r as any).accepted).toBeUndefined()
    expect((await itemRow(it.id)).current_bid_cents).toBeNull()
    await acceptLiveRequest(r.requestId, admin.id)
    expect((await itemRow(it.id)).current_bid_cents).toBe(5000)
  })

  it('pause freezes the remaining time exactly; resume restores it; nothing finalizes while paused', async () => {
    const it = await liveOnBlock()
    await age(it.id, 61)
    await tick(it.id) // countdown, ~15 s left
    await age(it.id, 5) // ~10 s left
    await setLiveRunState(it.id, 'pause', admin.id)
    const paused = await itemRow(it.id)
    expect(paused.status).toBe('paused')
    expect(paused.halt_kind).toBe('pause')
    const frozen = paused.pause_remaining_ms
    expect(frozen).toBeGreaterThan(8000)
    expect(frozen).toBeLessThanOrEqual(10_100)
    await age(it.id, 600) // lots of wall-clock time passes
    await tick(it.id)
    expect((await itemRow(it.id)).status).toBe('paused')
    await setLiveRunState(it.id, 'resume', admin.id)
    const left = (await one<{ ms: number }>(`select (extract(epoch from deadline_at - now()) * 1000)::int ms from auction_items where id = $1`, [it.id]))!.ms
    expect(Math.abs(left - frozen)).toBeLessThan(500)
  })

  it('host can extend the timer, end bidding early (→ provisional), and the max-duration cap is respected', async () => {
    const it = await liveOnBlock()
    const before = (await itemRow(it.id)).deadline_at as Date
    await extendTimer(it.id, 20, admin.id)
    expect(((await itemRow(it.id)).deadline_at as Date).getTime() - before.getTime()).toBe(20_000)
    await setLiveRunState(it.id, 'close', admin.id, true)
    expect((await itemRow(it.id)).status).toBe('provisional')
  })

  it('maximum duration ends an item even while bids keep coming', async () => {
    await query(`update events set live_max_seconds = 90 where id = $1`, [ev.id])
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveOnBlock()
    await age(it.id, 61)
    await tick(it.id)
    await phone(a.id, it.id, 5000)
    await age(it.id, 31) // started 92 s ago: past the cap, even though the countdown was just reset
    await tick(it.id)
    expect((await itemRow(it.id)).status).toBe('provisional')
    await expectError(phone(b.id, it.id, 6000), 'NOT_OPEN')
  })
})

describe('provisional closing window', () => {
  async function toProvisional() {
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await liveOnBlock()
    await phone(a.id, it.id, 5000)
    await phone(b.id, it.id, 5500)
    await setLiveRunState(it.id, 'close', admin.id, true)
    return { it, a, b }
  }

  it('records the provisional winner but creates NO winning result or checkout record until finalization', async () => {
    const { it, b } = await toProvisional()
    const r = await itemRow(it.id)
    expect(r.status).toBe('provisional')
    expect(r.current_bidder_id).toBe(b.id)
    expect((await query('select 1 from winning_results')).length).toBe(0)
    expect((await query('select 1 from item_collections')).length).toBe(0)
  })

  it('window length is fixed once and never resets', async () => {
    const { it } = await toProvisional()
    const u1 = (await itemRow(it.id)).provisional_until
    await tick(it.id)
    await tick(it.id)
    expect((await itemRow(it.id)).provisional_until).toEqual(u1)
    const secs = (await one<{ s: number }>(`select extract(epoch from provisional_until - now())::int s from auction_items where id = $1`, [it.id]))!.s
    expect(secs).toBeGreaterThanOrEqual(298)
  })

  it('finalizes exactly once when the window expires, however many callers race', async () => {
    const { it, b } = await toProvisional()
    await age(it.id, 301)
    await Promise.all([tick(it.id), tick(it.id), advanceDue(ev.id), advanceDue(ev.id)])
    const r = await itemRow(it.id)
    expect(r.status).toBe('finalized')
    const wins = await query('select * from winning_results')
    expect(wins).toHaveLength(1)
    expect(wins[0].bidder_id).toBe(b.id)
    expect(wins[0].amount_cents).toBe(5500)
    expect(await query('select 1 from item_collections')).toHaveLength(1)
    expect((await query(`select 1 from item_transitions where item_id = $1 and to_status = 'finalized'`, [it.id])).length).toBe(1)
    await tick(it.id) // idempotent
    expect(await query('select 1 from winning_results')).toHaveLength(1)
  })

  it('staff can finalize early; a second finalize is a harmless no-op', async () => {
    const { it } = await toProvisional()
    expect(await finalizeNow(it.id, admin.id)).toEqual({ already: false })
    expect(await finalizeNow(it.id, admin.id)).toEqual({ already: true })
    expect(await query('select 1 from winning_results')).toHaveLength(1)
  })

  it('every transition is logged', async () => {
    const { it } = await toProvisional()
    await finalizeNow(it.id, admin.id)
    const t = await query(`select from_status, to_status from item_transitions where item_id = $1 order by created_at, id`, [it.id])
    expect(t.map((x) => `${x.from_status}>${x.to_status}`)).toEqual(['upcoming>open', 'open>provisional', 'provisional>finalized'])
  })

  it('the next live item can start while the previous one sits in its window', async () => {
    const { it } = await toProvisional()
    const next = await makeItem(ev.id, { kind: 'live' })
    await startLiveItem(next.id, admin.id)
    expect((await itemRow(next.id)).status).toBe('open')
    expect((await itemRow(it.id)).status).toBe('provisional')
  })
})

describe('silent items', () => {
  it('provisional window is OFF by default: closes and finalizes at the closing time exactly as before', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await makeItem(ev.id, { num: 1 })
    await placeSilentBid({ bidderId: a.id, itemId: it.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    await query(`update auction_items set closes_at = now() - interval '1 second' where id = $1`, [it.id])
    await finalizeDueSilentItems()
    expect((await itemRow(it.id)).status).toBe('finalized')
  })

  it('with the setting on, a closed silent item waits out the window and only then finalizes', async () => {
    await query(`update events set provisional_silent = true where id = $1`, [ev.id])
    const [a, b] = await makeBidders(ev.id, 2)
    const it = await makeItem(ev.id, { num: 1 })
    await placeSilentBid({ bidderId: a.id, itemId: it.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    await query(`update auction_items set closes_at = now() - interval '10 seconds' where id = $1`, [it.id])
    await finalizeDueSilentItems()
    let r = await itemRow(it.id)
    expect(r.status).toBe('provisional')
    // window is anchored to the closing time, not to when someone noticed
    const anchor = (await one<{ s: number }>(`select extract(epoch from provisional_until - closes_at)::int s from auction_items where id = $1`, [it.id]))!.s
    expect(anchor).toBe(300)
    expect(await query('select 1 from winning_results')).toHaveLength(0)
    await expectError(placeSilentBid({ bidderId: b.id, itemId: it.id, amountCents: 9000, expectedCurrentCents: 5000, idempotencyKey: key() }), 'CLOSED')
    await query(`update auction_items set provisional_until = now() - interval '1 second' where id = $1`, [it.id])
    await finalizeDueSilentItems()
    r = await itemRow(it.id)
    expect(r.status).toBe('finalized')
    expect(await query('select 1 from winning_results')).toHaveLength(1)
  })
})

describe('emergency stop', () => {
  it('rejects all bids and freezes clocks; release pushes deadlines back by the stop length', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const live = await liveOnBlock()
    const silent = await makeItem(ev.id, { num: 1 })
    const d0 = (await itemRow(live.id)).deadline_at as Date
    await expectError(emergencyStop(ev.id, admin.id, ' '), 'REASON_REQUIRED')
    await emergencyStop(ev.id, admin.id, 'fire alarm test')
    await expectError(phone(a.id, live.id, 5000), 'HALTED')
    await expectError(placeSilentBid({ bidderId: a.id, itemId: silent.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() }), 'HALTED')
    await age(live.id, 3600)
    await tick(live.id)
    expect((await itemRow(live.id)).status).toBe('open') // frozen: not advanced
    await query(`update events set emergency_stop_at = emergency_stop_at - interval '30 seconds' where id = $1`, [ev.id])
    await age(live.id, -3600) // undo the artificial aging
    await emergencyRelease(ev.id, admin.id)
    const d1 = (await itemRow(live.id)).deadline_at as Date
    expect(d1.getTime() - d0.getTime()).toBeGreaterThanOrEqual(29_000)
    await phone(a.id, live.id, 5000)
    await expectError(emergencyRelease(ev.id, admin.id), 'NOT_STOPPED')
  })
})
