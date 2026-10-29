import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { one, pool, query } from '@/lib/db'
import { placeSilentBid } from '@/lib/bidding'
import { key, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

const eyeSql = readFileSync('scripts/sql/eye-exams-2x2.sql', 'utf8')
const chiliSql = readFileSync('scripts/sql/chili-opens-soon.sql', 'utf8')

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})

describe('eye exams 2 x 2 SQL', () => {
  async function eyes() {
    return [
      await makeItem(ev.id, { num: 14, title: 'Eye Exam (1 of 4)', start: 5000, inc: 1000 }),
      await makeItem(ev.id, { num: 58, title: 'Eye Exam (2 of 4)', start: 5000, inc: 1000 }),
      await makeItem(ev.id, { num: 59, title: 'Eye Exam (3 of 4)', start: 5000, inc: 1000 }),
      await makeItem(ev.id, { num: 60, title: 'Eye Exam (4 of 4)', start: 5000, inc: 1000 }),
    ]
  }

  it('leaves two items of two exams at $75 and removes the other two', async () => {
    await eyes()
    await makeItem(ev.id, { num: 1, title: 'Something Else' })
    await pool().query(eyeSql)
    const rows = await query<{ item_number: number; title: string; starting_bid_cents: number }>(`select item_number, title, starting_bid_cents from auction_items where title ilike 'Eye Exam%' order by item_number`)
    expect(rows).toEqual([
      { item_number: 14, title: 'Eye Exams for Two (1 of 2)', starting_bid_cents: 7500 },
      { item_number: 58, title: 'Eye Exams for Two (2 of 2)', starting_bid_cents: 7500 },
    ])
    expect((await one<{ n: number }>('select count(*)::int n from auction_items'))!.n).toBe(3)
  })

  it('changes nothing if a bid already exists, or an item is missing', async () => {
    const [a] = await eyes()
    const [b] = await makeBidders(ev.id, 1)
    await placeSilentBid({ bidderId: b.id, itemId: a.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    await expect(pool().query(eyeSql)).rejects.toThrow(/already has bids/)
    expect((await one<{ n: number }>(`select count(*)::int n from auction_items where title like 'Eye Exam (%'`))!.n).toBe(4)

    await resetDb()
    ev = await makeEvent()
    await makeItem(ev.id, { num: 14, title: 'Eye Exam (1 of 4)' })
    await expect(pool().query(eyeSql)).rejects.toThrow(/not all found/)
  })
})

describe('chili SQL', () => {
  it('adds the six entries as "opens soon", after the last silent number, and does nothing the second time', async () => {
    await makeItem(ev.id, { num: 58, title: 'Last Silent' })
    await pool().query(chiliSql)
    const rows = await query<{ item_number: number; title: string; status: string }>(`select item_number, title, status from auction_items where title ilike '%chili%' or title ilike '%pozole%' order by item_number`)
    expect(rows.map((r) => r.item_number)).toEqual([59, 60, 61, 62, 63, 64])
    expect(new Set(rows.map((r) => r.status))).toEqual(new Set(['upcoming']))
    await pool().query(chiliSql)
    expect((await one<{ n: number }>(`select count(*)::int n from auction_items where title ilike '%chili%' or title ilike '%pozole%'`))!.n).toBe(6)
  })
})
