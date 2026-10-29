import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { one, pool, query } from '@/lib/db'
import { finalizeDueSilentItems, placeSilentBid } from '@/lib/bidding'
import { handleSquareEvent, startOnlinePayment } from '@/lib/online-pay'
import { key, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

const sql = readFileSync('scripts/sql/cleanup-square-test.sql', 'utf8')

beforeEach(async () => {
  await resetDb()
})

async function counts() {
  const t = ['auction_items', 'bidders', 'silent_bids', 'winning_results', 'item_collections', 'payments', 'payment_allocations', 'online_payments']
  const out: Record<string, number> = {}
  for (const x of t) out[x] = (await one<{ n: number }>(`select count(*)::int n from ${x}`))!.n
  return out
}

describe('Square test cleanup SQL', () => {
  it('removes the test item, test guest and everything attached, and leaves real data alone', async () => {
    process.env.SQUARE_ACCESS_TOKEN = 't'; process.env.SQUARE_LOCATION_ID = 'L'
    const ev = await makeEvent()
    await query('update events set online_payments = true where id = $1', [ev.id])
    // real data that must survive
    const [real] = await makeBidders(ev.id, 1)
    const realItem = await makeItem(ev.id, { num: 1, start: 5000, title: 'Real Item' })
    await placeSilentBid({ bidderId: real.id, itemId: realItem.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    const before = await counts()

    // the test flow
    const [t] = await makeBidders(ev.id, 1)
    await query(`update bidders set name = 'Square Test' where id = $1`, [t.id])
    const testItem = await makeItem(ev.id, { num: 2, start: 100, title: 'TEST - delete me' })
    await placeSilentBid({ bidderId: t.id, itemId: testItem.id, amountCents: 100, expectedCurrentCents: null, idempotencyKey: key() })
    await query(`update auction_items set closes_at = now() - interval '1 second' where id = $1`, [testItem.id])
    await finalizeDueSilentItems()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ payment_link: { id: 'pl', url: 'https://x.test', order_id: 'ordT' } }), { status: 200 })))
    await startOnlinePayment(t.id)
    await handleSquareEvent({ type: 'payment.updated', data: { object: { payment: { id: 'payT', status: 'COMPLETED', order_id: 'ordT', amount_money: { amount: 100, currency: 'USD' } } } } })
    vi.unstubAllGlobals()
    expect((await counts()).payments).toBe(1)

    await pool().query(sql)
    expect(await counts()).toEqual(before)
    expect((await one<{ title: string }>('select title from auction_items'))!.title).toBe('Real Item')
  })

  it('refuses to run when there is nothing to clean', async () => {
    await makeEvent()
    await expect(pool().query(sql)).rejects.toThrow(/nothing was changed/)
  })
})
