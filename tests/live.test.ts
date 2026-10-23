import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import {
  acceptLiveRequest, finalizeLiveItem, recordPaddleBid, rejectLiveRequest, reopenItem,
  requestLiveBid, setLiveRunState, startLiveItem, voidLastLiveBid,
} from '@/lib/bidding'
import { expectError, itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = (await makeAdmin('volunteer'))!
})

const req = (bidderId: string, itemId: string, amountCents: number) =>
  requestLiveBid({ bidderId, itemId, amountCents, idempotencyKey: key() })
const paddle = (itemId: string, paddleNumber: number, amountCents: number, idempotencyKey = key()) =>
  recordPaddleBid({ itemId, paddleNumber, amountCents, adminId: admin.id, idempotencyKey })

async function liveItem(over = {}) {
  const item = await makeItem(ev.id, { kind: 'live', start: 10000, inc: 1000, ...over })
  await startLiveItem(item.id, admin.id)
  return item
}

describe('live item lifecycle', () => {
  it('only one live item can be on the block at a time', async () => {
    const a = await makeItem(ev.id, { kind: 'live' })
    const b = await makeItem(ev.id, { kind: 'live' })
    await startLiveItem(a.id, admin.id)
    await expectError(startLiveItem(b.id, admin.id), 'LIVE_ITEM_ACTIVE')
    await setLiveRunState(a.id, 'close', admin.id, true)
    await startLiveItem(b.id, admin.id)
  })

  it('bidding is refused until the item is opened, while paused, and after closing', async () => {
    const [x] = await makeBidders(ev.id, 1)
    const item = await makeItem(ev.id, { kind: 'live', start: 10000, inc: 1000 })
    await expectError(req(x.id, item.id, 10000), 'NOT_OPEN')
    await expectError(paddle(item.id, x.bidder_number, 10000), 'NOT_OPEN')
    await startLiveItem(item.id, admin.id)
    await setLiveRunState(item.id, 'pause', admin.id)
    await expectError(req(x.id, item.id, 10000), 'PAUSED')
    await expectError(paddle(item.id, x.bidder_number, 10000), 'PAUSED')
    await setLiveRunState(item.id, 'resume', admin.id)
    await paddle(item.id, x.bidder_number, 10000)
  })
})

describe('mobile bid requests', () => {
  it('a request is NOT an accepted bid until the clerk accepts it', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await liveItem()
    const r = await req(a.id, item.id, 10000)
    expect((await itemRow(item.id)).current_bid_cents).toBeNull()
    expect((await query('select * from live_accepted_bids')).length).toBe(0)
    await acceptLiveRequest(r.requestId, admin.id)
    const row = await itemRow(item.id)
    expect([row.current_bid_cents, row.current_bidder_id]).toEqual([10000, a.id])
    const accepted = await one<any>('select * from live_accepted_bids')
    expect([accepted.source, accepted.seq, accepted.request_id]).toEqual(['mobile', 1, r.requestId])
  })

  it('rejects requests below the next minimum and a request from the current leader', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await liveItem()
    await expectError(req(a.id, item.id, 9999), 'TOO_LOW')
    await acceptLiveRequest((await req(a.id, item.id, 10000)).requestId, admin.id)
    await expectError(req(b.id, item.id, 10500), 'TOO_LOW') // next is 11000
    await expectError(req(a.id, item.id, 12000), 'ALREADY_LEADING')
  })

  it('rejecting leaves the bid untouched and cannot be repeated or reversed', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await liveItem()
    const r = await req(a.id, item.id, 10000)
    await rejectLiveRequest(r.requestId, admin.id)
    expect((await itemRow(item.id)).current_bid_cents).toBeNull()
    await expectError(acceptLiveRequest(r.requestId, admin.id), 'ALREADY_RESOLVED')
    await expectError(rejectLiveRequest(r.requestId, admin.id), 'ALREADY_RESOLVED')
  })

  it('duplicate submissions (same idempotency key) create a single request', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await liveItem()
    const base = { bidderId: a.id, itemId: item.id, amountCents: 10000, idempotencyKey: 'dup-1' }
    const rs = await Promise.all([requestLiveBid(base), requestLiveBid(base), requestLiveBid(base)])
    expect(new Set(rs.map((r) => r.requestId)).size).toBe(1)
    expect((await query('select * from live_bid_requests')).length).toBe(1)
  })

  it('a newer request from the same guest supersedes their older pending one', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await liveItem()
    const r1 = await req(a.id, item.id, 10000)
    const r2 = await req(a.id, item.id, 11000)
    const rows = await query<any>('select id, status from live_bid_requests order by created_at')
    expect(rows.find((r) => r.id === r1.requestId).status).toBe('superseded')
    expect(rows.find((r) => r.id === r2.requestId).status).toBe('pending')
  })

  it('accepting the same request from many clerk screens at once records exactly one bid', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await liveItem()
    const r = await req(a.id, item.id, 10000)
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => acceptLiveRequest(r.requestId, admin.id)))
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect((await query('select * from live_accepted_bids')).length).toBe(1)
  })

  it('simultaneous requests from 30 guests are all recorded; accepting the top one expires the rest', async () => {
    const bidders = await makeBidders(ev.id, 30)
    const item = await liveItem()
    const rs = await Promise.all(bidders.map((b, i) => req(b.id, item.id, 10000 + i * 1000)))
    expect((await query('select * from live_bid_requests where status = $1', ['pending'])).length).toBe(30)
    await acceptLiveRequest(rs[29].requestId, admin.id) // $39,000 — highest
    expect((await query('select * from live_bid_requests where status = $1', ['pending'])).length).toBe(0)
    expect((await query('select * from live_bid_requests where status = $1', ['expired'])).length).toBe(29)
    await expectError(acceptLiveRequest(rs[3].requestId, admin.id), 'ALREADY_RESOLVED')
  })

  it('accepting a request that has been overtaken by a paddle bid is refused as out of order', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await liveItem()
    // Raced: request pending, then the clerk's paddle bid lands above it before the request is looked at.
    const r = await req(a.id, item.id, 10000)
    await paddle(item.id, b.bidder_number, 12000)
    await expectError(acceptLiveRequest(r.requestId, admin.id), 'ALREADY_RESOLVED') // already auto-expired as outbid
  })
})

describe('paddle bids', () => {
  it('records paddle bids in the same history; amounts must strictly increase', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await liveItem()
    await expectError(paddle(item.id, a.bidder_number, 9000), 'TOO_LOW') // below opening
    await paddle(item.id, a.bidder_number, 10000)
    await expectError(paddle(item.id, b.bidder_number, 10000), 'OUT_OF_ORDER') // equal
    await expectError(paddle(item.id, b.bidder_number, 9500), 'OUT_OF_ORDER') // lower
    await paddle(item.id, b.bidder_number, 15000) // clerk may jump past the suggestion
    await expectError(paddle(item.id, 9999, 20000), 'BIDDER_NOT_FOUND')
    const hist = await query<any>('select seq, amount_cents, source from live_accepted_bids order by seq')
    expect(hist.map((h) => [h.seq, h.amount_cents, h.source])).toEqual([[1, 10000, 'paddle'], [2, 15000, 'paddle']])
  })

  it('a double-tapped paddle entry (same key) is recorded once', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const item = await liveItem()
    const k = 'paddle-key'
    const rs = await Promise.all([paddle(item.id, a.bidder_number, 10000, k), paddle(item.id, a.bidder_number, 10000, k), paddle(item.id, a.bidder_number, 10000, k)])
    expect(rs.filter((r) => !r.replay)).toHaveLength(1)
    expect((await query('select * from live_accepted_bids')).length).toBe(1)
  })

  it('undoing the last bid restores the previous leader; history keeps both rows', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await liveItem()
    await paddle(item.id, a.bidder_number, 10000)
    await paddle(item.id, b.bidder_number, 12000)
    await expectError(voidLastLiveBid(item.id, admin.id, ' '), 'REASON_REQUIRED')
    await voidLastLiveBid(item.id, admin.id, 'Wrong paddle')
    let row = await itemRow(item.id)
    expect([row.current_bid_cents, row.current_bidder_id, row.bid_count]).toEqual([10000, a.id, 1])
    expect((await query('select * from live_accepted_bids')).length).toBe(2)
    await paddle(item.id, b.bidder_number, 12000) // same amount may be re-entered after a void
    await voidLastLiveBid(item.id, admin.id, 'again')
    await voidLastLiveBid(item.id, admin.id, 'and again')
    row = await itemRow(item.id)
    expect([row.current_bid_cents, row.current_bidder_id]).toEqual([null, null])
    await expectError(voidLastLiveBid(item.id, admin.id, 'nothing left'), 'NOTHING_TO_UNDO')
  })
})

describe('closing, finalizing and reopening', () => {
  it('closing needs confirmation, expires pending requests, and finalize needs confirmation + closed state', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await liveItem()
    await paddle(item.id, a.bidder_number, 10000)
    const r = await req(b.id, item.id, 11000)
    await expectError(finalizeLiveItem(item.id, admin.id, true), 'BAD_STATE') // still open
    await expectError(setLiveRunState(item.id, 'close', admin.id, false), 'CONFIRM_REQUIRED')
    await setLiveRunState(item.id, 'close', admin.id, true)
    expect((await one<any>('select status from live_bid_requests where id = $1', [r.requestId])).status).toBe('expired')
    await expectError(finalizeLiveItem(item.id, admin.id, false), 'CONFIRM_REQUIRED')
    const res = await finalizeLiveItem(item.id, admin.id, true)
    expect(res).toMatchObject({ sold: true, amountCents: 10000, bidderId: a.id })
    const wr = await query<any>('select * from winning_results')
    expect(wr).toHaveLength(1)
    expect([wr[0].bidder_id, wr[0].amount_cents, wr[0].source]).toEqual([a.id, 10000, 'live_bid'])
  })

  it('nothing is accepted after finalization; finalizing twice is refused', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await liveItem()
    await paddle(item.id, a.bidder_number, 10000)
    await setLiveRunState(item.id, 'close', admin.id, true)
    await finalizeLiveItem(item.id, admin.id, true)
    await expectError(paddle(item.id, b.bidder_number, 20000), 'NOT_OPEN')
    await expectError(req(b.id, item.id, 20000), 'NOT_OPEN')
    await expectError(finalizeLiveItem(item.id, admin.id, true), 'ALREADY_FINALIZED')
    await expectError(voidLastLiveBid(item.id, admin.id, 'too late'), 'BAD_STATE')
    expect((await query('select * from winning_results')).length).toBe(1)
  })

  it('an item closed with no bids finalizes as unsold (no winner record)', async () => {
    const item = await liveItem()
    await setLiveRunState(item.id, 'close', admin.id, true)
    expect(await finalizeLiveItem(item.id, admin.id, true)).toMatchObject({ sold: false })
    expect((await query('select * from winning_results')).length).toBe(0)
  })

  it('reopen needs a reason, voids the old winner (keeping history), and is audited', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const item = await liveItem()
    await paddle(item.id, a.bidder_number, 10000)
    await setLiveRunState(item.id, 'close', admin.id, true)
    await finalizeLiveItem(item.id, admin.id, true)
    await expectError(reopenItem(item.id, admin.id, ''), 'REASON_REQUIRED')
    await reopenItem(item.id, admin.id, 'Auctioneer missed a bid')
    expect((await itemRow(item.id)).status).toBe('paused')
    expect((await query('select * from winning_results where voided_at is null')).length).toBe(0)
    expect((await query('select * from winning_results where voided_at is not null')).length).toBe(1)
    await setLiveRunState(item.id, 'resume', admin.id)
    await paddle(item.id, b.bidder_number, 11000)
    await setLiveRunState(item.id, 'close', admin.id, true)
    await finalizeLiveItem(item.id, admin.id, true)
    const active = await one<any>('select * from winning_results where voided_at is null')
    expect([active.bidder_id, active.amount_cents]).toEqual([b.id, 11000])
    expect((await one<any>(`select details from audit_logs where action = 'item.reopened'`)).details.reason).toBe('Auctioneer missed a bid')
  })
})
