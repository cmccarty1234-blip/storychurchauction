import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { one, pool, query } from '@/lib/db'
import { placeSilentBid } from '@/lib/bidding'
import { key, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

const sql = readFileSync('scripts/sql/move-bids-1015-rocket-fizz.sql', 'utf8')

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})

async function setup() {
  const from = await makeItem(ev.id, { num: 80, title: 'Rocket Fizz 2', start: 2500, inc: 1000 })
  const to = await makeItem(ev.id, { num: 8, title: 'Rocket Fizz 1', start: 2500, inc: 1000 })
  const bidders = await makeBidders(ev.id, 3)
  // make one of them paddle #1015
  await query('update bidders set bidder_number = 1015 where id = $1', [bidders[0].id])
  return { from, to, kati: bidders[0], other: bidders[1], third: bidders[2] }
}
const row = (id: string) => one<{ current_bid_cents: number | null; current_bidder_id: string | null; bid_count: number }>('select current_bid_cents, current_bidder_id, bid_count from auction_items where id = $1', [id])
const bid = (itemId: string, bidderId: string, cents: number, expected: number | null) => placeSilentBid({ itemId, bidderId, amountCents: cents, expectedCurrentCents: expected, idempotencyKey: key() })

describe('move #1015 from Rocket Fizz 2 to Rocket Fizz 1', () => {
  it('moves the bid and fixes both items', async () => {
    const { from, to, kati, other } = await setup()
    await bid(from.id, kati.id, 2500, null) // Kati's bid on #80 (the one to move)
    await bid(to.id, other.id, 3500, null) // someone else on #8
    await pool().query(sql)
    expect(await row(from.id)).toEqual({ current_bid_cents: null, current_bidder_id: null, bid_count: 0 })
    expect(await row(to.id)).toEqual({ current_bid_cents: 3500, current_bidder_id: other.id, bid_count: 2 })
    expect((await query('select 1 from silent_bids where item_id = $1 and bidder_id = $2', [to.id, kati.id])).length).toBe(1)
    expect((await query(`select 1 from audit_logs where action = 'bid.moved'`)).length).toBe(1)
  })

  it('leaves another bidder as the leader on #80 when there are other bids', async () => {
    const { from, to, kati, other } = await setup()
    await bid(from.id, kati.id, 2500, null)
    await bid(from.id, other.id, 3500, 2500)
    await pool().query(sql)
    expect(await row(from.id)).toEqual({ current_bid_cents: 3500, current_bidder_id: other.id, bid_count: 1 })
    expect(await row(to.id)).toEqual({ current_bid_cents: 2500, current_bidder_id: kati.id, bid_count: 1 })
  })

  it('refuses when #8 already has a bid for the same amount, or the guest has no bid on #80', async () => {
    const { from, to, kati, other } = await setup()
    await expect(pool().query(sql)).rejects.toThrow(/no bid on item #80/)
    await bid(from.id, kati.id, 2500, null)
    await bid(to.id, other.id, 2500, null)
    await expect(pool().query(sql)).rejects.toThrow(/same amount/)
    expect(await row(from.id)).toMatchObject({ current_bid_cents: 2500, bid_count: 1 })
  })

  it('refuses when an item is closed', async () => {
    const { from, to, kati } = await setup()
    await bid(from.id, kati.id, 2500, null)
    await query(`update auction_items set status = 'closed' where id = $1`, [to.id])
    await expect(pool().query(sql)).rejects.toThrow(/no longer open/)
  })
})
