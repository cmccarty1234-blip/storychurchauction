import { beforeEach, describe, expect, it } from 'vitest'
import { query } from '@/lib/db'
import { placeSilentBid } from '@/lib/bidding'
import { setItemsComingSoon, setItemsPublished } from '@/lib/items'
import { recordPurchase } from '@/lib/powerups'
import { wheelbarrow } from '@/lib/wheelbarrow'
import { expectError, itemRow, key, makeAdmin, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

let ev: { id: string }
let admin: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  admin = await makeAdmin()
})
const bid = (b: string, item: string, amt: number, exp: number | null) => placeSilentBid({ bidderId: b, itemId: item, amountCents: amt, expectedCurrentCents: exp, idempotencyKey: key() })

describe('"Opens soon" silent items (visible now, bidding later)', () => {
  it('guests can see the item but cannot bid until staff open it', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const it = await makeItem(ev.id, { num: 1, status: 'draft' })
    const r = await setItemsComingSoon(ev.id, [it.id], admin.id)
    expect(r.changed).toBe(1)
    expect((await itemRow(it.id)).status).toBe('upcoming')
    await expectError(bid(a.id, it.id, 5000, null), 'NOT_STARTED')
    const opened = await setItemsPublished(ev.id, [it.id], true, admin.id) // the "Show to guests" button
    expect(opened.changed).toBe(1)
    expect((await itemRow(it.id)).status).toBe('open')
    await bid(a.id, it.id, 5000, null)
    expect((await itemRow(it.id)).current_bid_cents).toBe(5000)
  })

  it('skips items that already have bids, and live items', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const hasBid = await makeItem(ev.id, { num: 1 })
    await bid(a.id, hasBid.id, 5000, null)
    const live = await makeItem(ev.id, { kind: 'live' })
    const r = await setItemsComingSoon(ev.id, [hasBid.id, live.id], admin.id)
    expect(r.changed).toBe(0)
    expect(r.skipped).toHaveLength(2)
    expect((await itemRow(hasBid.id)).status).toBe('open')
  })
})

describe('wheelbarrow (the minimum we can count on)', () => {
  it('counts each visible item at its current bid or its starting bid, plus Power-Up and pie sales; ignores hidden items', async () => {
    const [a] = await makeBidders(ev.id, 1)
    const i1 = await makeItem(ev.id, { num: 1, start: 5000 })
    await makeItem(ev.id, { num: 2, start: 3000 }) // no bids: counts at $30
    await makeItem(ev.id, { num: 3, start: 9900, status: 'draft' }) // hidden: not counted
    await bid(a.id, i1.id, 8000, null) // $80 beats the $50 start
    await recordPurchase({ bidderId: a.id, code: 'final_call', quantity: 2, method: 'cash', adminId: admin.id, idempotencyKey: key() })
    await query(`update powerup_defs set enabled = true where code = 'pie_small'`)
    await recordPurchase({ bidderId: a.id, code: 'pie_small', quantity: 1, method: 'cash', adminId: admin.id, idempotencyKey: key() })
    const w = await wheelbarrow(ev.id)
    expect(w).toMatchObject({ items: 2, noBidItems: 1, startingCents: 8000, floorCents: 11000, raisedAboveStartCents: 3000, powerupCents: 3000, pieCents: 10000, totalCents: 24000 })
  })
})
