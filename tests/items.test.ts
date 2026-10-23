import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import { changeItemKind } from '@/lib/items'
import { placeSilentBid, requestLiveBid, setLiveRunState, startLiveItem } from '@/lib/bidding'
import { expectError, itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = (await makeAdmin('admin'))!
})

describe('switching an item between silent and live', () => {
  it('silent (visible) → live: moves into the live number range as "upcoming"; live → silent returns to "open"', async () => {
    await makeItem(ev.id, { num: 5 })
    await makeItem(ev.id, { kind: 'live', num: 103 })
    const it = await makeItem(ev.id, { num: 6 }) // open silent
    const r = await changeItemKind(it.id, 'live', admin.id)
    expect(r).toEqual({ changed: true, itemNumber: 104 }) // next after the highest live number
    let row = await itemRow(it.id)
    expect([row.kind, row.status, row.item_number, row.live_order, row.closes_at]).toEqual(['live', 'upcoming', 104, 104, null])
    const back = await changeItemKind(it.id, 'silent', admin.id)
    expect(back.itemNumber).toBe(6) // silent numbers: max(5) + 1 once this item left the silent range
    row = await itemRow(it.id)
    expect([row.kind, row.status, row.live_order]).toEqual(['silent', 'open', null])
  })

  it('a hidden draft stays hidden, and switching to the type it already is does nothing', async () => {
    const it = await makeItem(ev.id, { status: 'draft' })
    expect(await changeItemKind(it.id, 'silent', admin.id)).toMatchObject({ changed: false })
    await changeItemKind(it.id, 'live', admin.id)
    expect((await itemRow(it.id)).status).toBe('draft')
  })

  it('is blocked once there is any bid, live request or winner', async () => {
    const [b] = await makeBidders(ev.id, 1)
    const s = await makeItem(ev.id)
    await placeSilentBid({ bidderId: b.id, itemId: s.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    await expectError(changeItemKind(s.id, 'live', admin.id), 'HAS_BIDS')

    const l = await makeItem(ev.id, { kind: 'live', start: 10000 })
    await startLiveItem(l.id, admin.id)
    await requestLiveBid({ bidderId: b.id, itemId: l.id, amountCents: 10000, idempotencyKey: key() })
    await setLiveRunState(l.id, 'close', admin.id, true)
    await query(`update auction_items set status = 'upcoming' where id = $1`, [l.id]) // pretend it went back to the queue; the request still counts
    await expectError(changeItemKind(l.id, 'silent', admin.id), 'HAS_BIDS')
  })

  it('is blocked while a live item is on the block or after it closed', async () => {
    const l = await makeItem(ev.id, { kind: 'live' })
    await startLiveItem(l.id, admin.id)
    await expectError(changeItemKind(l.id, 'silent', admin.id), 'BAD_STATE')
    await setLiveRunState(l.id, 'close', admin.id, true)
    await expectError(changeItemKind(l.id, 'silent', admin.id), 'BAD_STATE')
  })

  it('records who changed it and keeps numbers unique across a batch of switches', async () => {
    const items = []
    for (let i = 0; i < 5; i++) items.push(await makeItem(ev.id, { status: 'draft' }))
    for (const it of items) await changeItemKind(it.id, 'live', admin.id)
    const nums = (await query<{ item_number: number }>(`select item_number from auction_items where kind = 'live' order by 1`)).map((r) => r.item_number)
    expect(nums).toEqual([101, 102, 103, 104, 105])
    expect((await one<{ n: number }>(`select count(*)::int n from audit_logs where action = 'item.type_changed'`))!.n).toBe(5)
  })
})
