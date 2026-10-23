import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { notify } from './realtime'

/**
 * Switch an item between silent and live.
 * Allowed only while the item has NO bids, requests or winner and is not on the block / closed — so no history can
 * ever be reinterpreted. The item moves into the other numbering range (silent 1…, live 101…) and its status is
 * translated (visible silent "open" ⇄ visible live "upcoming"; hidden stays hidden).
 * Note: the item number changes, so reprint its QR label if one was already printed.
 */
export async function changeItemKind(itemId: string, to: 'silent' | 'live', adminId: string) {
  return tx(async (c) => {
    const item = await one<{ id: string; event_id: string; kind: 'silent' | 'live'; status: string; item_number: number; title: string }>(
      'select id, event_id, kind, status, item_number, title from auction_items where id = $1 for update',
      [itemId],
      c,
    )
    if (!item) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
    if (item.kind === to) return { changed: false as const, itemNumber: item.item_number }

    // Silent: hidden (draft) or visible (open). Live: hidden (draft) or waiting in the queue (upcoming) — a live "open" item is on the block.
    const switchable = item.kind === 'silent' ? ['draft', 'open'] : ['draft', 'upcoming']
    if (!switchable.includes(item.status)) {
      throw new AppError('BAD_STATE', 'This item is on the block or already closed, so its type can’t be changed.', 409)
    }
    const hist = await one<{ n: number }>(
      `select (select count(*) from silent_bids where item_id = $1)
            + (select count(*) from live_accepted_bids where item_id = $1)
            + (select count(*) from live_bid_requests where item_id = $1)
            + (select count(*) from winning_results where item_id = $1) as n`,
      [itemId],
      c,
    )
    if (Number(hist!.n) > 0) throw new AppError('HAS_BIDS', 'This item already has bid history, so its type can’t be changed.', 409)

    const next = await one<{ n: number }>(
      to === 'live'
        ? `select coalesce(max(item_number), 100) + 1 as n from auction_items where event_id = $1 and kind = 'live'`
        : `select coalesce(max(item_number), 0) + 1 as n from auction_items where event_id = $1 and kind = 'silent'`,
      [item.event_id],
      c,
    )
    const status = item.status === 'draft' ? 'draft' : to === 'live' ? 'upcoming' : 'open'
    await c.query(
      `update auction_items set kind = $2, item_number = $3, status = $4, live_order = $5, closes_at = null,
              current_bid_cents = null, current_bidder_id = null, bid_count = 0, updated_at = now()
        where id = $1`,
      [itemId, to, next!.n, status, to === 'live' ? next!.n : null],
    )
    await audit({ eventId: item.event_id, actorType: 'admin', actorId: adminId, action: 'item.type_changed', entityType: 'auction_item', entityId: itemId, details: { title: item.title, from: item.kind, to, oldNumber: item.item_number, newNumber: next!.n } }, c)
    await notify(c, { t: 'item', id: itemId })
    return { changed: true as const, itemNumber: next!.n }
  })
}

/**
 * Show several items to guests at once (or hide them again).
 * Showing: silent → "open" (bidding opens immediately, subject to the event's start/close times), live → "upcoming".
 * Only hidden/visible items can change: items on the block or closed are left alone, and items that already have bids
 * can't be hidden. Returns how many changed and why others were skipped.
 */
export async function setItemsPublished(eventId: string, ids: string[], published: boolean, adminId: string) {
  return tx(async (c) => {
    const rows = await query<{ id: string; kind: 'silent' | 'live'; status: string; bid_count: number; title: string }>(
      'select id, kind, status, bid_count, title from auction_items where event_id = $1 and id = any($2::uuid[]) order by item_number for update',
      [eventId, ids],
      c,
    )
    let changed = 0
    const skipped: { title: string; why: string }[] = []
    for (const r of rows) {
      const changeable = r.kind === 'silent' ? ['draft', 'open'] : ['draft', 'upcoming']
      if (!changeable.includes(r.status)) {
        skipped.push({ title: r.title, why: 'on the block or already closed' })
        continue
      }
      const target = published ? (r.kind === 'live' ? 'upcoming' : 'open') : 'draft'
      if (target === r.status) continue
      if (!published && r.bid_count > 0) {
        skipped.push({ title: r.title, why: 'it already has bids' })
        continue
      }
      await c.query('update auction_items set status = $2, updated_at = now() where id = $1', [r.id, target])
      await audit({ eventId, actorType: 'admin', actorId: adminId, action: published ? 'item.shown' : 'item.hidden', entityType: 'auction_item', entityId: r.id, details: { title: r.title, bulk: true } }, c)
      changed++
    }
    if (changed) await notify(c, { t: 'item' })
    return { changed, skipped }
  })
}
