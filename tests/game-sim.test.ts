import { beforeEach, describe, expect, it } from 'vitest'
import { one, query, tx } from '@/lib/db'
import { placeSilentBid, requestLiveBid, setLiveRunState, startLiveItem } from '@/lib/bidding'
import { advance, advanceDue } from '@/lib/lifecycle'
import { activatePowerUp, inventory, powerupRevenue, recordPurchase } from '@/lib/powerups'
import { endRoomEvent, startRoomEvent } from '@/lib/rooms'
import { gameState } from '@/lib/game-state'
import { key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

// Deterministic pseudo-random so a failure is reproducible.
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  await query(`update powerup_defs set enabled = (code not in ('block','back_in')), max_per_bidder = null`)
  ev = await makeEvent()
  admin = await makeAdmin()
  await query(`update events set game_mode = true, auto_accept_live = true where id = $1`, [ev.id])
})

async function age(itemId: string, secs: number) {
  await query(
    `update auction_items set deadline_at = deadline_at - make_interval(secs => $2), provisional_until = provisional_until - make_interval(secs => $2),
            started_at = started_at - make_interval(secs => $2) where id = $1`,
    [itemId, secs],
  )
}

async function assertItemConsistent(itemId: string) {
  const it = (await one<any>('select * from auction_items where id = $1', [itemId]))!
  if (it.kind === 'live') {
    const bids = await query<any>(
      `select * from live_accepted_bids b where item_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id) order by seq`,
      [itemId],
    )
    // accepted amounts rise strictly with seq: the engine can never accept a lower or equal bid later
    for (let i = 1; i < bids.length; i++) expect(bids[i].amount_cents).toBeGreaterThan(bids[i - 1].amount_cents)
    const top = bids.at(-1)
    expect(it.current_bid_cents).toBe(top?.amount_cents ?? null)
    expect(it.current_bidder_id).toBe(top?.bidder_id ?? null)
    expect(it.bid_count).toBe(bids.length)
  } else {
    const top = await one<any>('select * from silent_bids where item_id = $1 order by amount_cents desc limit 1', [itemId])
    expect(it.current_bid_cents).toBe(top?.amount_cents ?? null)
    expect(it.current_bidder_id).toBe(top?.bidder_id ?? null)
  }
  const wins = await query<any>('select * from winning_results where item_id = $1 and voided_at is null', [itemId])
  expect(wins.length).toBeLessThanOrEqual(1)
  if (it.status === 'finalized' && it.current_bid_cents != null) {
    expect(wins).toHaveLength(1)
    expect(wins[0].amount_cents).toBe(it.current_bid_cents)
    expect(wins[0].bidder_id).toBe(it.current_bidder_id)
  }
  if (it.status !== 'finalized') expect(wins).toHaveLength(0) // provisional results never create a winner
}

describe('a whole night, simulated', () => {
  it('60 bidders, concurrent phone bids and Power-Ups across live + silent items keep every invariant', async () => {
    const r = rng(20261030)
    const bidders = await makeBidders(ev.id, 60)
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)]

    // The bidding desk sells a mix of Power-Ups.
    const codes = ['resurrection', 'final_call', 'knockout', 'challenge_flag']
    for (const b of bidders) for (let k = 0; k < 2; k++) await recordPurchase({ bidderId: b.id, code: pick(codes), quantity: 1, method: pick(['cash', 'check', 'card_terminal']), adminId: admin.id, idempotencyKey: key() })

    const silent: { id: string }[] = []
    for (let i = 1; i <= 5; i++) silent.push(await makeItem(ev.id, { num: i, start: 2000, inc: 500 }))
    const live: { id: string }[] = []
    for (let i = 0; i < 3; i++) live.push(await makeItem(ev.id, { kind: 'live', start: 5000, inc: 500 }))
    for (const l of live) await query('update auction_items set min_qualifying_bid_cents = 7000 where id = $1', [l.id])

    // ── silent: 150 concurrent bids from random guests ──
    for (let wave = 0; wave < 20; wave++) {
      await Promise.allSettled(
        silent.map(async (it) => {
          const cur = (await one<any>('select current_bid_cents c from auction_items where id = $1', [it.id]))!.c as number | null
          // three guests race for the same item at the same moment; exactly one of them can be next
          return Promise.allSettled(Array.from({ length: 3 }, () => placeSilentBid({ bidderId: pick(bidders).id, itemId: it.id, amountCents: (cur ?? 1500) + 500 * (1 + Math.floor(r() * 3)), expectedCurrentCents: cur, idempotencyKey: key() })))
        }),
      )
    }
    for (const s of silent) await assertItemConsistent(s.id)

    // ── live: each item gets a storm of concurrent bids and Power-Up attempts ──
    for (const l of live) {
      await startLiveItem(l.id, admin.id)
      for (let wave = 0; wave < 12; wave++) {
        const cur = (await one<any>('select current_bid_cents c from auction_items where id = $1', [l.id]))!.c as number | null
        await Promise.allSettled([
          ...Array.from({ length: 6 }, () => requestLiveBid({ bidderId: pick(bidders).id, itemId: l.id, amountCents: (cur ?? 4500) + 500 * (1 + Math.floor(r() * 4)), idempotencyKey: key() })),
          ...Array.from({ length: 2 }, () => activatePowerUp({ bidderId: pick(bidders).id, itemId: l.id, code: pick(['final_call', 'knockout']), idempotencyKey: key() })),
        ])
        await assertItemConsistent(l.id)
      }
      // end the item (a Knockout may already have done it), then let several people race for the reopening / challenges
      await tx((c) => advance(c, l.id))
      const st = (await one<any>('select status from auction_items where id = $1', [l.id]))!.status
      if (st === 'open') await setLiveRunState(l.id, 'close', admin.id, true)
      await Promise.allSettled([
        ...Array.from({ length: 6 }, () => activatePowerUp({ bidderId: pick(bidders).id, itemId: l.id, code: 'resurrection', idempotencyKey: key() })),
        ...Array.from({ length: 6 }, () => activatePowerUp({ bidderId: pick(bidders).id, itemId: l.id, code: 'challenge_flag', amountCents: 40_000 + Math.floor(r() * 5) * 500, idempotencyKey: key() })),
      ])
      await assertItemConsistent(l.id)
      // everything that can have happened is capped
      const uses = await query<any>('select powerup_code c, count(*)::int n from powerup_activations where item_id = $1 group by 1', [l.id])
      const caps: Record<string, number> = { resurrection: 1, final_call: 2, knockout: 1, challenge_flag: 1 }
      for (const u of uses) expect(u.n).toBeLessThanOrEqual(caps[u.c])
      // let any window run out
      for (let i = 0; i < 4; i++) {
        await age(l.id, 400)
        await advanceDue(ev.id)
      }
      expect((await one<any>('select status from auction_items where id = $1', [l.id]))!.status).toBe('finalized')
      await assertItemConsistent(l.id)
    }

    // ── a Room Event in the middle of everything ──
    const battle = await startRoomEvent(ev.id, 'battle', admin.id)
    await Promise.allSettled(Array.from({ length: 40 }, async () => {
      const it = pick(silent)
      const cur = (await one<any>('select current_bid_cents c from auction_items where id = $1', [it.id]))!.c as number | null
      return placeSilentBid({ bidderId: pick(bidders).id, itemId: it.id, amountCents: (cur ?? 1500) + 500, expectedCurrentCents: cur, idempotencyKey: key() })
    }))
    await endRoomEvent(battle.sessionId, admin.id)
    const accepted = (await one<any>(`select count(*)::int n from silent_bids where created_at >= (select starts_at from room_event_sessions where id = $1)`, [battle.sessionId]))!.n
    const scored = (await one<any>('select count(*)::int n from room_event_scores where session_id = $1', [battle.sessionId]))!.n
    expect(scored).toBe(accepted) // every accepted bid scored exactly once, nothing else did
    for (const s of silent) await assertItemConsistent(s.id)

    // ── inventory + money ──
    let used = 0
    for (const b of bidders) {
      const inv = await inventory(b.id)
      for (const row of inv) {
        expect(row.available).toBeGreaterThanOrEqual(0)
        expect(row.purchased - row.used).toBe(row.available)
        used += row.used
      }
    }
    expect((await one<any>('select count(*)::int n from powerup_activations'))!.n).toBe(used)
    const rev = await powerupRevenue(ev.id)
    expect(rev.totalCents).toBe((await one<any>('select coalesce(sum(total_cents),0)::int s from powerup_purchases'))!.s)
    expect(rev.units).toBe(120)

    const st = await gameState(ev.id)
    const finalized = (await one<any>('select coalesce(sum(amount_cents),0)::int s from winning_results where voided_at is null'))!.s
    expect(st.totals.finalizedCents).toBe(finalized)
    expect(st.totals.powerupCents).toBe(rev.totalCents)
    expect(st.totals.paymentsCents).toBe(0) // Power-Up cash never appears as an auction payment
    expect(st.totals.outstandingCents).toBe(finalized)
    // every transition that happened is in the log, and none was illegal
    const bad = await query(`select 1 from item_transitions where from_status = 'finalized' and to_status = 'provisional'`)
    expect(bad).toHaveLength(0)
  }, 240_000)
})
