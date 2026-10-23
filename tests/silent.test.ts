import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import { closeSilentItem, finalizeDueSilentItems, placeSilentBid, reopenItem } from '@/lib/bidding'
import { expectError, itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})

const bid = (bidderId: string, itemId: string, amountCents: number, expectedCurrentCents: number | null, extra: object = {}) =>
  placeSilentBid({ bidderId, itemId, amountCents, expectedCurrentCents, idempotencyKey: key(), ...extra })

describe('silent bidding rules', () => {
  it('accepts a valid opening bid and updates the leader', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await makeItem(ev.id, { start: 5000, inc: 500 })
    const r = await bid(a.id, item.id, 5000, null)
    expect(r.currentCents).toBe(5000)
    expect(r.minNextCents).toBe(5500)
    const row = await itemRow(item.id)
    expect([row.current_bid_cents, row.current_bidder_id, row.bid_count]).toEqual([5000, a.id, 1])
  })

  it('rejects below-starting and invalid-increment bids with the correct minimum', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await makeItem(ev.id, { start: 5000, inc: 500 })
    await expectError(bid(a.id, item.id, 4999, null), 'TOO_LOW')
    await bid(a.id, item.id, 5000, null)
    const e = await expectError(bid(b.id, item.id, 5499, 5000), 'TOO_LOW')
    expect(e.data.minNextCents).toBe(5500)
    await bid(b.id, item.id, 5500, 5000) // exactly the minimum is fine
    await bid(a.id, item.id, 9000, 5500) // a jump bid is fine
    expect((await itemRow(item.id)).current_bid_cents).toBe(9000)
  })

  it('rejects stale bids (client saw an old high bid) and reports the real one', async () => {
    const [a, b, c] = await makeBidders(ev.id, 3)
    const item = await makeItem(ev.id)
    await bid(a.id, item.id, 5000, null)
    await bid(b.id, item.id, 5500, 5000)
    const e = await expectError(bid(c.id, item.id, 6000, 5000), 'STALE') // c still thinks it's 5000
    expect(e.data.currentCents).toBe(5500)
    expect(e.data.minNextCents).toBe(6000)
  })

  it('rejects a bidder outbidding themselves, junk amounts and unknown items', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await makeItem(ev.id)
    await bid(a.id, item.id, 5000, null)
    await expectError(bid(a.id, item.id, 6000, 5000), 'ALREADY_LEADING')
    await expectError(bid(a.id, item.id, 0, 5000), 'INVALID_AMOUNT')
    await expectError(bid(a.id, item.id, 12.5 as any, 5000), 'INVALID_AMOUNT')
    await expectError(bid(a.id, item.id, 99_999_999, 5000), 'AMOUNT_TOO_HIGH')
    await expectError(bid(a.id, '00000000-0000-0000-0000-000000000000', 5000, null), 'ITEM_NOT_FOUND')
  })

  it('is idempotent: a double-tap does not create a second bid', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await makeItem(ev.id)
    const k = key()
    const base = { bidderId: a.id, itemId: item.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: k }
    const results = await Promise.all([placeSilentBid(base), placeSilentBid(base), placeSilentBid(base)])
    expect(results.filter((r) => !r.replay)).toHaveLength(1)
    expect((await one<{ n: number }>('select count(*)::int n from silent_bids'))!.n).toBe(1)
  })

  it('rejects bids after the closing time and before the start', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const closed = await makeItem(ev.id, { closes_at: new Date(Date.now() - 1000) })
    await expectError(bid(a.id, closed.id, 5000, null), 'CLOSED')
    await query(`update events set silent_start_at = now() + interval '1 hour' where id = $1`, [ev.id])
    const item = await makeItem(ev.id)
    await expectError(bid(a.id, item.id, 5000, null), 'NOT_STARTED')
  })

  it('rejects bids on draft items, non-open items and live items', async () => {
    const [a] = await makeBidders(ev.id, 1)
    await expectError(bid(a.id, (await makeItem(ev.id, { status: 'draft' })).id, 5000, null), 'ITEM_NOT_FOUND')
    await expectError(bid(a.id, (await makeItem(ev.id, { status: 'closed' })).id, 5000, null), 'CLOSED')
    await expectError(bid(a.id, (await makeItem(ev.id, { kind: 'live' })).id, 5000, null), 'WRONG_KIND')
  })

  it('records an assisted bid with both the guest and the volunteer', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const admin = await makeAdmin('volunteer')
    const item = await makeItem(ev.id)
    await bid(a.id, item.id, 5000, null, { adminId: admin.id })
    const row = await one<any>('select * from silent_bids')
    expect(row.bidder_id).toBe(a.id)
    expect(row.placed_by_admin_id).toBe(admin.id)
    expect((await one<any>(`select * from audit_logs where action = 'bid.assisted'`))).toBeTruthy()
  })

  it('accepted bids are immutable at the database level', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await makeItem(ev.id)
    await bid(a.id, item.id, 5000, null)
    await expect(query('update silent_bids set amount_cents = 1')).rejects.toThrow(/immutable/)
    await expect(query('delete from silent_bids')).rejects.toThrow(/immutable/)
  })
})

describe('silent bidding concurrency', () => {
  it('60 simultaneous bids at DIFFERENT amounts produce one consistent, strictly increasing chain', async () => {
    const bidders = await makeBidders(ev.id, 60)
    const item = await makeItem(ev.id, { start: 5000, inc: 500 })
    // Everyone saw "no bids yet" and bids a distinct valid amount.
    const results = await Promise.allSettled(bidders.map((b, i) => bid(b.id, item.id, 5000 + i * 500, null)))
    const ok = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    // With everyone expecting "no bids yet", exactly ONE can win the race; all others see STALE.
    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(59)
    expect(failed.every((f) => f.reason.code === 'STALE')).toBe(true)
    const row = await itemRow(item.id)
    const top = await one<any>('select max(amount_cents) m, count(*)::int n from silent_bids')
    expect(top.n).toBe(1)
    expect(row.current_bid_cents).toBe(top.m)
    expect(row.bid_count).toBe(1)
  })

  it('retrying clients converge: every accepted bid exceeds the previous by at least the increment', async () => {
    const bidders = await makeBidders(ev.id, 40)
    const item = await makeItem(ev.id, { start: 5000, inc: 500 })
    let accepted = 0
    await Promise.all(
      bidders.map(async (b) => {
        for (let attempt = 0; attempt < 1000; attempt++) {
          const cur = (await itemRow(item.id)).current_bid_cents as number | null
          const amount = cur == null ? 5000 : cur + 500
          try {
            await bid(b.id, item.id, amount, cur)
            accepted++
            return
          } catch (e: any) {
            if (!['STALE', 'TOO_LOW'].includes(e.code)) throw e
          }
        }
      }),
    )
    const bids = await query<{ amount_cents: number; created_at: Date }>('select amount_cents from silent_bids order by created_at, amount_cents')
    expect(accepted).toBe(40)
    expect(bids).toHaveLength(40)
    const amounts = bids.map((b) => b.amount_cents).sort((x, y) => x - y)
    amounts.forEach((a, i) => i > 0 && expect(a - amounts[i - 1]).toBeGreaterThanOrEqual(500))
    expect((await itemRow(item.id)).current_bid_cents).toBe(amounts[amounts.length - 1])
  })

  it('identical simultaneous bids: exactly one wins', async () => {
    const bidders = await makeBidders(ev.id, 25)
    const item = await makeItem(ev.id)
    const results = await Promise.allSettled(bidders.map((b) => bid(b.id, item.id, 5000, null)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await one<{ n: number }>('select count(*)::int n from silent_bids'))!.n).toBe(1)
  })
})

describe('silent auction close & winners', () => {
  it('finalizes the highest bid as the winner once, and only after the closing time', async () => {
    const [a, b, c] = await makeBidders(ev.id, 3)
    const item = await makeItem(ev.id, { closes_at: new Date(Date.now() + 1500) })
    const noBids = await makeItem(ev.id, { closes_at: new Date(Date.now() + 1500) })
    await bid(a.id, item.id, 5000, null)
    await bid(b.id, item.id, 7000, 5000)
    await bid(c.id, item.id, 7500, 7000)
    await bid(a.id, item.id, 8000, 7500)
    expect(await finalizeDueSilentItems()).toBe(0) // not closed yet
    await new Promise((r) => setTimeout(r, 1700))
    const n = await Promise.all([finalizeDueSilentItems(), finalizeDueSilentItems(), finalizeDueSilentItems()])
    expect(n.reduce((s, x) => s + x, 0)).toBe(2) // two items, finalized once in total despite 3 callers
    const wr = await query<any>('select * from winning_results')
    expect(wr).toHaveLength(1)
    expect([wr[0].bidder_id, wr[0].amount_cents, wr[0].item_id]).toEqual([a.id, 8000, item.id])
    expect((await itemRow(noBids.id)).status).toBe('finalized')
    await expectError(bid(b.id, item.id, 9000, 8000), 'CLOSED')
    expect((await query('select * from item_collections')).length).toBe(1)
  })

  it('an admin can close early and reopen with a reason; the old result is voided, not deleted', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const admin = await makeAdmin()
    const item = await makeItem(ev.id)
    await bid(a.id, item.id, 5000, null)
    await closeSilentItem(item.id, admin.id)
    expect((await query('select * from winning_results where voided_at is null')).length).toBe(1)
    await expectError(reopenItem(item.id, admin.id, '  ', new Date(Date.now() + 60000)), 'REASON_REQUIRED')
    await reopenItem(item.id, admin.id, 'Bid entered in error', new Date(Date.now() + 60000))
    expect((await query('select * from winning_results where voided_at is null')).length).toBe(0)
    expect((await query('select * from winning_results where voided_at is not null')).length).toBe(1)
    await bid(b.id, item.id, 5500, 5000)
    expect((await itemRow(item.id)).current_bid_cents).toBe(5500)
    expect((await one<any>(`select details from audit_logs where action = 'item.reopened'`)).details.reason).toBe('Bid entered in error')
  })
})
