import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import { placeSilentBid, requestLiveBid, startLiveItem, setLiveRunState } from '@/lib/bidding'
import { advanceRooms, battleScore, drawJackpot, endRoomEvent, startRoomEvent } from '@/lib/rooms'
import { gameState, gameTick } from '@/lib/game-state'
import { finalizeNow } from '@/lib/lifecycle'
import { recordPurchase } from '@/lib/powerups'
import { recordPayment } from '@/lib/checkout'
import { expectError, itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = await makeAdmin()
  await query(`update events set game_mode = true, auto_accept_live = true where id = $1`, [ev.id])
  await query(`update room_event_defs set enabled = true`)
})
const sbid = (b: string, item: string, amt: number, exp: number | null) => placeSilentBid({ bidderId: b, itemId: item, amountCents: amt, expectedCurrentCents: exp, idempotencyKey: key() })
const expireNow = (id: string) => query(`update room_event_sessions set ends_at = clock_timestamp() - interval '1 second' where id = $1`, [id])

describe('Lightning Round', () => {
  it('drops the step to $1 on the chosen silent items only, for its duration; leading bids and deadlines are untouched', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const i1 = await makeItem(ev.id, { num: 1, inc: 500 })
    const i2 = await makeItem(ev.id, { num: 2, inc: 500 })
    await sbid(a.id, i1.id, 5000, null)
    await sbid(a.id, i2.id, 5000, null)
    const close1 = (await itemRow(i1.id)).closes_at
    const s = await startRoomEvent(ev.id, 'lightning', admin.id, { itemIds: [i1.id] })
    expect(s.endsAt).not.toBeNull()
    expect((await itemRow(i1.id)).current_bid_cents).toBe(5000)
    await expect(sbid(b.id, i1.id, 5050, 5000)).rejects.toMatchObject({ code: 'TOO_LOW' })
    await sbid(b.id, i1.id, 5100, 5000)
    await expect(sbid(b.id, i2.id, 5100, 5000)).rejects.toMatchObject({ code: 'TOO_LOW' }) // not part of the round
    expect((await gameState(ev.id)).room?.code).toBe('lightning')
    await expireNow(s.sessionId)
    expect(await advanceRooms(ev.id)).toBe(1)
    await expect(sbid(a.id, i1.id, 5200, 5100)).rejects.toMatchObject({ code: 'TOO_LOW' })
    await sbid(a.id, i1.id, 5600, 5100)
    expect((await itemRow(i1.id)).closes_at).toEqual(close1)
    expect((await query(`select headline from announcements where kind = 'room.lightning.end'`)).length).toBe(1)
  })

  it('refuses a second concurrent Room Event, and needs game mode', async () => {
    await makeItem(ev.id, { num: 1 })
    await startRoomEvent(ev.id, 'lightning', admin.id)
    await expectError(startRoomEvent(ev.id, 'battle', admin.id), 'ALREADY_ACTIVE')
    await query(`update events set game_mode = false`)
    await query(`update room_event_sessions set status = 'ended'`)
    await expectError(startRoomEvent(ev.id, 'battle', admin.id), 'GAME_OFF')
  })

  it('can be switched off by an administrator', async () => {
    await makeItem(ev.id, { num: 1 })
    await query(`update room_event_defs set enabled = false where code = 'lightning'`)
    await expectError(startRoomEvent(ev.id, 'lightning', admin.id), 'DISABLED')
  })
})

describe('Battle of the Room', () => {
  it('deals teams alternately by bidder number — balanced, deterministic and stable', async () => {
    const bs = await makeBidders(ev.id, 7)
    const s = await startRoomEvent(ev.id, 'battle', admin.id)
    const t = await query<{ bidder_number: number; team: string }>(`select b.bidder_number, t.team from room_teams t join bidders b on b.id = t.bidder_id where session_id = $1 order by 1`, [s.sessionId])
    expect(t.map((x) => x.team)).toEqual(['gold', 'black', 'gold', 'black', 'gold', 'black', 'gold'])
    expect(t.map((x) => x.bidder_number)).toEqual(bs.map((b) => b.bidder_number).sort((a, b) => a - b))
  })

  it('scores accepted bids (silent and live) once each, in game points, without changing any auction result', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const silent = await makeItem(ev.id, { num: 1, start: 5000 })
    const live = await makeItem(ev.id, { kind: 'live', start: 5000 })
    await startLiveItem(live.id, admin.id)
    const s = await startRoomEvent(ev.id, 'battle', admin.id)
    await sbid(a.id, silent.id, 5000, null) // gold: 10 (no raise over the starting bid)
    await sbid(b.id, silent.id, 7000, 5000) // black: 10 + floor(2000/1000) = 12
    await requestLiveBid({ bidderId: a.id, itemId: live.id, amountCents: 10000, idempotencyKey: key() }) // gold: 10 + 5
    const k = key()
    await requestLiveBid({ bidderId: b.id, itemId: live.id, amountCents: 10500, idempotencyKey: k })
    await requestLiveBid({ bidderId: b.id, itemId: live.id, amountCents: 10500, idempotencyKey: k }) // double tap: replay, no extra points
    const sc = await battleScore(s.sessionId)
    expect(sc.gold.points).toBe(10 + 15)
    expect(sc.black.points).toBe(12 + 10)
    expect(await query('select 1 from room_event_scores')).toHaveLength(4)
    expect((await itemRow(silent.id)).current_bid_cents).toBe(7000) // winners unaffected
    await endRoomEvent(s.sessionId, admin.id)
    const res = (await one<{ result: any }>('select result from room_event_sessions where id = $1', [s.sessionId]))!.result
    expect(res.winner).toBe('gold')
  })

  it('does not score bids placed after it ends, and a late registrant joins the smaller team', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await makeItem(ev.id, { num: 1 })
    const s = await startRoomEvent(ev.id, 'battle', admin.id)
    const [late] = await makeBidders(ev.id, 1)
    await sbid(late.id, it.id, 5000, null)
    expect((await query('select team from room_teams where bidder_id = $1', [late.id]))[0].team).toBe('black')
    await expireNow(s.sessionId)
    await advanceRooms(ev.id)
    await sbid(a.id, it.id, 6000, 5000)
    expect(await query('select 1 from room_event_scores')).toHaveLength(1)
  })
})

describe('Mystery Jackpot', () => {
  it('draws one registered attendee, records an auditable snapshot, and requires a reason to redraw', async () => {
    await makeBidders(ev.id, 5)
    const s = await startRoomEvent(ev.id, 'jackpot', admin.id, { prize: 'Gift basket' })
    const d1 = await drawJackpot(s.sessionId, admin.id)
    expect(d1.entries).toBe(5)
    await expectError(drawJackpot(s.sessionId, admin.id), 'REASON_REQUIRED')
    const d2 = await drawJackpot(s.sessionId, admin.id, 'winner left early')
    expect(d2.winnerNumber).not.toBe(d1.winnerNumber)
    expect(d2.entries).toBe(4)
    const rows = await query('select entry_count, reason, redraw_of, entries from jackpot_draws order by created_at')
    expect(rows[1].reason).toBe('winner left early')
    expect(rows[1].redraw_of).not.toBeNull()
    expect(rows[0].entries).toHaveLength(5)
    expect((await query(`select 1 from audit_logs where action in ('room.jackpot.draw','room.jackpot.redraw')`)).length).toBe(2)
    await endRoomEvent(s.sessionId, admin.id)
    await expectError(drawJackpot(s.sessionId, admin.id, 'again'), 'NOT_ACTIVE')
  })

  it('is unbiased: every attendee wins roughly equally often', async () => {
    await makeBidders(ev.id, 4)
    const wins = new Map<number, number>()
    for (let i = 0; i < 240; i++) {
      const s = await startRoomEvent(ev.id, 'jackpot', admin.id)
      const d = await drawJackpot(s.sessionId, admin.id)
      wins.set(d.winnerNumber, (wins.get(d.winnerNumber) ?? 0) + 1)
      await endRoomEvent(s.sessionId, admin.id)
    }
    expect(wins.size).toBe(4)
    for (const n of wins.values()) {
      expect(n).toBeGreaterThan(30)
      expect(n).toBeLessThan(90)
    }
  }, 120_000)
})

describe('totals & ticker', () => {
  it('keeps leading bids, finalized wins, Power-Up revenue, payments and outstanding separate (no double counting)', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const live = await makeItem(ev.id, { kind: 'live', start: 5000 })
    const silent = await makeItem(ev.id, { num: 1, start: 4000 })
    await startLiveItem(live.id, admin.id)
    await requestLiveBid({ bidderId: a.id, itemId: live.id, amountCents: 20000, idempotencyKey: key() })
    await sbid(b.id, silent.id, 4000, null)
    let st = await gameState(ev.id)
    expect(st.totals).toMatchObject({ leadingCents: 24000, finalizedCents: 0, powerupCents: 0, paymentsCents: 0, outstandingCents: 0 })

    await recordPurchase({ bidderId: b.id, code: 'final_call', quantity: 2, method: 'cash', adminId: admin.id, idempotencyKey: key() })
    await setLiveRunState(live.id, 'close', admin.id, true)
    await finalizeNow(live.id, admin.id)
    st = await gameState(ev.id)
    expect(st.totals).toMatchObject({ finalizedCents: 20000, powerupCents: 3000, paymentsCents: 0, outstandingCents: 20000, itemsSold: 1 })

    await recordPayment({ bidderId: a.id, method: 'cash', amountCents: 5000, adminId: admin.id, idempotencyKey: key() })
    st = await gameState(ev.id)
    expect(st.totals).toMatchObject({ paymentsCents: 5000, outstandingCents: 15000, powerupCents: 3000 })
  })

  it('reports the goal, the silent closing time, and counts every accepted bid once (silent + live, not voided)', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    await query('update events set goal_cents = 600000 where id = $1', [ev.id])
    const silent = await makeItem(ev.id, { num: 1, start: 4000 })
    const live = await makeItem(ev.id, { kind: 'live', start: 5000 })
    await startLiveItem(live.id, admin.id)
    await sbid(a.id, silent.id, 4000, null)
    await sbid(b.id, silent.id, 4500, 4000)
    await requestLiveBid({ bidderId: a.id, itemId: live.id, amountCents: 5000, idempotencyKey: key() })
    const st = await gameState(ev.id)
    expect(st.bidsTonight).toBe(3)
    expect(st.event.goalCents).toBe(600000)
    expect(st.event.silentCloseAt).not.toBeNull()
    expect(st.hot[0]).toMatchObject({ number: 1, bidCount: 2 })
  })

  it('announcements come only from real events', async () => {
    const [a] = await makeBidders(ev.id, 1)
    expect((await gameState(ev.id)).announcements).toHaveLength(0)
    const live = await makeItem(ev.id, { kind: 'live' })
    await startLiveItem(live.id, admin.id)
    await requestLiveBid({ bidderId: a.id, itemId: live.id, amountCents: 5000, idempotencyKey: key() })
    await setLiveRunState(live.id, 'close', admin.id, true)
    await finalizeNow(live.id, admin.id)
    const kinds = (await gameState(ev.id)).announcements.map((x) => x.kind)
    expect(kinds).toEqual(expect.arrayContaining(['item.provisional', 'item.sold']))
    expect(await gameTick(ev.id)).toBe(0)
  })
})
