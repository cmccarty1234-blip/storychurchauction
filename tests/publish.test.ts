import { beforeEach, describe, expect, it } from 'vitest'
import { one, query } from '@/lib/db'
import { setItemsPublished } from '@/lib/items'
import { placeSilentBid, startLiveItem } from '@/lib/bidding'
import { itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = (await makeAdmin('admin'))!
})

describe('showing / hiding many items at once', () => {
  it('shows hidden silent items as open and hidden live items as upcoming, and audits each', async () => {
    const s1 = await makeItem(ev.id, { status: 'draft' })
    const s2 = await makeItem(ev.id, { status: 'draft' })
    const l1 = await makeItem(ev.id, { kind: 'live', status: 'draft' })
    const r = await setItemsPublished(ev.id, [s1.id, s2.id, l1.id], true, admin.id)
    expect(r).toEqual({ changed: 3, skipped: [] })
    expect((await itemRow(s1.id)).status).toBe('open')
    expect((await itemRow(l1.id)).status).toBe('upcoming')
    expect((await one<{ n: number }>(`select count(*)::int n from audit_logs where action = 'item.shown'`))!.n).toBe(3)
  })

  it('is idempotent and hides items again', async () => {
    const s = await makeItem(ev.id, { status: 'draft' })
    await setItemsPublished(ev.id, [s.id], true, admin.id)
    expect((await setItemsPublished(ev.id, [s.id], true, admin.id)).changed).toBe(0)
    expect((await setItemsPublished(ev.id, [s.id], false, admin.id)).changed).toBe(1)
    expect((await itemRow(s.id)).status).toBe('draft')
  })

  it('refuses to hide an item that already has bids, and leaves closed / on-the-block items alone', async () => {
    const [b] = await makeBidders(ev.id, 1)
    const withBid = await makeItem(ev.id)
    await placeSilentBid({ bidderId: b.id, itemId: withBid.id, amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() })
    const closed = await makeItem(ev.id, { status: 'closed' })
    const live = await makeItem(ev.id, { kind: 'live' })
    await startLiveItem(live.id, admin.id) // on the block
    const r = await setItemsPublished(ev.id, [withBid.id, closed.id, live.id], false, admin.id)
    expect(r.changed).toBe(0)
    expect(r.skipped).toHaveLength(3)
    expect((await itemRow(withBid.id)).status).toBe('open')
    expect((await itemRow(closed.id)).status).toBe('closed')
    expect((await itemRow(live.id)).status).toBe('open')
  })

  it('ignores ids from another event and unknown ids', async () => {
    const other = await one<{ id: string }>(`insert into events (name) values ('Other') returning id`)
    const foreign = await one<{ id: string }>(
      `insert into auction_items (event_id, item_number, kind, title, status) values ($1, 1, 'silent', 'Foreign', 'draft') returning id`,
      [other!.id],
    )
    const r = await setItemsPublished(ev.id, [foreign!.id, '00000000-0000-0000-0000-000000000000'], true, admin.id)
    expect(r.changed).toBe(0)
    expect((await query<{ status: string }>('select status from auction_items where id = $1', [foreign!.id]))[0].status).toBe('draft')
  })
})
