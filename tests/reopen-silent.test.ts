import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { one, pool, query } from '@/lib/db'
import { placeSilentBid } from '@/lib/bidding'
import { key, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

// the script's time is tonight's 9 PM; tests need one that is still in the future
const sql = readFileSync('scripts/sql/reopen-unbid-silent-items.sql', 'utf8').replace("'2026-10-30 21:00:00-06'", "now() + interval '2 hours'")

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
})
const state = (id: string) => one<{ status: string; closes_at: Date | null }>('select status, closes_at from auction_items where id = $1', [id])

describe('reopen silent items with no bids', () => {
  it('reopens only silent items that ended with no bids, and leaves everything else alone', async () => {
    const empty1 = await makeItem(ev.id, { num: 4, title: 'No bids, finalized', status: 'finalized' })
    const empty2 = await makeItem(ev.id, { num: 11, title: 'No bids, closed', status: 'closed' })
    const bidOn = await makeItem(ev.id, { num: 5, title: 'Had a bid' })
    const [g] = await makeBidders(ev.id, 1)
    await placeSilentBid({ itemId: bidOn.id, bidderId: g.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    await query(`update auction_items set status = 'finalized' where id = $1`, [bidOn.id])
    const stillOpen = await makeItem(ev.id, { num: 6, title: 'Still open, no bids' })
    const live = await makeItem(ev.id, { kind: 'live', num: 105, title: 'A live item', status: 'closed' })

    await pool().query(sql)

    expect((await state(empty1.id))!.status).toBe('open')
    expect((await state(empty2.id))!.status).toBe('open')
    expect((await state(empty1.id))!.closes_at!.getTime()).toBeGreaterThan(Date.now())
    expect((await state(bidOn.id))!.status).toBe('finalized') // it had a bid: untouched
    expect((await state(stillOpen.id))!.status).toBe('open')
    expect((await state(live.id))!.status).toBe('closed') // live items untouched
    expect((await query(`select 1 from audit_logs where action = 'item.reopened'`)).length).toBe(2)
  })

  it('refuses a closing time that has already passed', async () => {
    await makeItem(ev.id, { num: 4, title: 'No bids', status: 'finalized' })
    const past = readFileSync('scripts/sql/reopen-unbid-silent-items.sql', 'utf8').replace("'2026-10-30 21:00:00-06'", "now() - interval '1 hour'")
    await expect(pool().query(past)).rejects.toThrow(/already passed/)
  })
})
