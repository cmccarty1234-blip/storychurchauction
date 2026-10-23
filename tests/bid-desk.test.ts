import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '@/lib/db'
import { deskGuest, deskItem } from '@/lib/bid-desk'
import { placeSilentBid } from '@/lib/bidding'
import { expectError, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})

const bid = (bidderId: string, itemId: string, amountCents: number, expected: number | null, adminId?: string) =>
  placeSilentBid({ bidderId, itemId, amountCents, expectedCurrentCents: expected, idempotencyKey: key(), adminId })

describe('Bid Desk lookups', () => {
  it('shows what a guest is winning and where they were outbid (with the new minimum)', async () => {
    const [a, b] = await makeBidders(ev.id, 2)
    const i1 = await makeItem(ev.id, { num: 1, start: 5000, inc: 500 })
    const i2 = await makeItem(ev.id, { num: 2, start: 5000, inc: 500 })
    await bid(a.id, i1.id, 5000, null)
    await bid(a.id, i2.id, 5000, null)
    await bid(b.id, i2.id, 6000, 5000) // a is outbid on item 2
    const g = await deskGuest(ev.id, a.bidder_number)
    expect(g.bidder.number).toBe(a.bidder_number)
    expect(g.leading.map((x) => x.number)).toEqual([1])
    expect(g.outbid.map((x) => [x.number, x.myTopCents, x.currentCents, x.minNextCents, x.leaderNumber])).toEqual([[2, 5000, 6000, 6500, b.bidder_number]])
    expect(g.finished).toEqual([])
  })

  it('puts closed items under "finished" and never lists items the guest has not bid on', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const open = await makeItem(ev.id, { num: 1 })
    const closing = await makeItem(ev.id, { num: 2 })
    await makeItem(ev.id, { num: 3 }) // never bid on
    await bid(a.id, open.id, 5000, null)
    await bid(a.id, closing.id, 5000, null)
    await query(`update auction_items set closes_at = now() - interval '1 minute' where id = $1`, [closing.id])
    const g = await deskGuest(ev.id, a.bidder_number)
    expect(g.leading.map((x) => x.number)).toEqual([1])
    expect(g.finished.map((x) => x.number)).toEqual([2])
    expect(g.outbid).toEqual([])
  })

  it('assisted bids placed from the desk show up for the guest and credit the volunteer', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const vol = await makeAdmin('volunteer')
    const it = await makeItem(ev.id, { num: 1 })
    await bid(a.id, it.id, 5000, null, vol.id)
    expect((await deskGuest(ev.id, a.bidder_number)).leading.map((x) => x.number)).toEqual([1])
    expect((await query<{ placed_by_admin_id: string }>('select placed_by_admin_id from silent_bids'))[0].placed_by_admin_id).toBe(vol.id)
  })

  it('rejects unknown guests, unknown / hidden items, and live items', async () => {
    await expectError(deskGuest(ev.id, 99999), 'BIDDER_NOT_FOUND')
    await expectError(deskItem(ev.id, 77), 'ITEM_NOT_FOUND')
    await makeItem(ev.id, { num: 5, status: 'draft' })
    await expectError(deskItem(ev.id, 5), 'ITEM_NOT_FOUND')
    await makeItem(ev.id, { num: 101, kind: 'live' })
    await expectError(deskItem(ev.id, 101), 'WRONG_KIND')
  })

  it('looks up an open silent item with its minimum next bid', async () => {
    await makeItem(ev.id, { num: 4, start: 4000, inc: 500, title: 'Coffee Basket' })
    const it = await deskItem(ev.id, 4)
    expect(it).toMatchObject({ number: 4, title: 'Coffee Basket', open: true, currentCents: null, minNextCents: 4000, incrementCents: 500 })
  })
})
