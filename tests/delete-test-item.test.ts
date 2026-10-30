import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { one, pool, query } from '@/lib/db'
import { placeSilentBid } from '@/lib/bidding'
import { key, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

const sql = readFileSync('scripts/sql/delete-test-item-117.sql', 'utf8')

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})

describe('delete the #117 TEST item SQL', () => {
  it('removes the test item with its bids and history, and nothing else', async () => {
    const test = await makeItem(ev.id, { num: 117, title: 'TEST', start: 5000, inc: 500 })
    const other = await makeItem(ev.id, { num: 116, title: 'Sky Diving COS', start: 5000, inc: 500 })
    const [g] = await makeBidders(ev.id, 1)
    await placeSilentBid({ itemId: test.id, bidderId: g.id, amountCents: 5500, expectedCurrentCents: null, idempotencyKey: key() })
    await placeSilentBid({ itemId: other.id, bidderId: g.id, amountCents: 5500, expectedCurrentCents: null, idempotencyKey: key() })
    await query(`insert into announcements (event_id, kind, headline, item_id) values ($1, 'item.sold', 'x', $2)`, [ev.id, test.id])

    await pool().query(sql)

    expect(await one('select 1 from auction_items where id = $1', [test.id])).toBeFalsy()
    expect((await query('select 1 from silent_bids where item_id = $1', [test.id])).length).toBe(0)
    expect((await query('select 1 from announcements where item_id = $1', [test.id])).length).toBe(0)
    // the other item, its bid and the guest are untouched
    expect(await one('select 1 from auction_items where id = $1', [other.id])).toBeTruthy()
    expect((await query('select 1 from silent_bids where item_id = $1', [other.id])).length).toBe(1)
    expect(await one('select 1 from bidders where id = $1', [g.id])).toBeTruthy()
  })

  it('does nothing when there is no item #117 titled TEST', async () => {
    const other = await makeItem(ev.id, { num: 117, title: 'Something real' })
    await expect(pool().query(sql)).rejects.toThrow(/nothing was changed/)
    expect(await one('select 1 from auction_items where id = $1', [other.id])).toBeTruthy()
  })
})
