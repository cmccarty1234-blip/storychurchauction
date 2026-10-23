import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { one, query, tx } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { getEvent } from '@/lib/events'
import { closeSilentItem, finalizeDueSilentItems, reopenItem } from '@/lib/bidding'
import { notify } from '@/lib/realtime'
import { pool } from '@/lib/db'
import { localInputToUtc } from '@/lib/time'
import { requireAdmin } from '@/lib/session'

const fields = z.object({
  kind: z.enum(['silent', 'live']),
  itemNumber: z.number().int().min(1).max(9999).optional(),
  title: z.string().trim().min(1, 'Enter a title').max(120),
  description: z.string().max(4000).default(''),
  donorName: z.string().max(120).nullish(),
  imagePath: z.string().max(100).nullish(),
  startingBidCents: z.number().int().min(100, 'Starting bid must be at least $1').max(5_000_000),
  incrementCents: z.number().int().min(100, 'Increment must be at least $1').max(5_000_000),
  published: z.boolean().default(true),
})

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create') }).merge(fields),
  z.object({ action: z.literal('update'), id: uuid }).merge(fields.omit({ kind: true })),
  z.object({ action: z.literal('delete'), id: uuid }),
  z.object({ action: z.literal('close'), id: uuid }),
  z.object({ action: z.literal('reopen'), id: uuid, reason: z.string(), newCloseAt: z.string().optional() }),
  z.object({ action: z.literal('publish'), id: uuid, published: z.boolean() }),
  z.object({ action: z.literal('reorder'), id: uuid, direction: z.enum(['up', 'down']) }),
  z.object({ action: z.literal('finalize-due') }),
])

export const POST = route(async (req) => {
  const admin = await requireAdmin()
  const b = await body(req, Body)
  const ev = await getEvent()

  switch (b.action) {
    case 'create': {
      const num =
        b.itemNumber ??
        (
          await one<{ n: number }>(
            b.kind === 'live'
              ? `select coalesce(max(item_number), 100) + 1 as n from auction_items where event_id = $1 and kind = 'live'`
              : `select coalesce(max(item_number), 0) + 1 as n from auction_items where event_id = $1 and kind = 'silent'`,
            [ev.id],
          )
        )!.n
      try {
        const row = await one<{ id: string }>(
          `insert into auction_items (event_id, item_number, kind, title, description, donor_name, image_path,
                                      starting_bid_cents, increment_cents, status, live_order)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [ev.id, num, b.kind, b.title, b.description, b.donorName || null, b.imagePath || null, b.startingBidCents, b.incrementCents,
           b.published ? (b.kind === 'live' ? 'upcoming' : 'open') : 'draft', b.kind === 'live' ? num : null],
        )
        await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'item.created', entityType: 'auction_item', entityId: row!.id, details: { itemNumber: num, title: b.title } })
        return { id: row!.id, itemNumber: num }
      } catch (e: any) {
        if (e.code === '23505') throw new AppError('DUPLICATE_NUMBER', `Item number ${num} is already in use.`, 409)
        throw e
      }
    }
    case 'update': {
      const item = await one<{ bid_count: number; kind: string; starting_bid_cents: number; increment_cents: number }>('select * from auction_items where id = $1 and event_id = $2', [b.id, ev.id])
      if (!item) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
      if (item.bid_count > 0 && (item.starting_bid_cents !== b.startingBidCents || item.increment_cents !== b.incrementCents)) {
        throw new AppError('HAS_BIDS', 'Prices can’t be changed after bidding has started.', 409)
      }
      try {
        await one(
          `update auction_items set title=$2, description=$3, donor_name=$4, image_path=coalesce($5, image_path),
                  starting_bid_cents=$6, increment_cents=$7, item_number=coalesce($8, item_number),
                  live_order = case when kind = 'live' then coalesce($8, live_order) else live_order end, updated_at=now()
            where id=$1`,
          [b.id, b.title, b.description, b.donorName || null, b.imagePath || null, b.startingBidCents, b.incrementCents, b.itemNumber ?? null],
        )
      } catch (e: any) {
        if (e.code === '23505') throw new AppError('DUPLICATE_NUMBER', `Item number ${b.itemNumber} is already in use.`, 409)
        throw e
      }
      await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'item.updated', entityType: 'auction_item', entityId: b.id, details: { title: b.title } })
      await notify(pool(), { t: 'item', id: b.id })
      return { ok: true }
    }
    case 'delete': {
      // Bid history is never deleted: an item with any bid, request, or result cannot be removed.
      const used = await one<{ n: number }>(
        `select (select count(*) from silent_bids where item_id = $1) + (select count(*) from live_accepted_bids where item_id = $1)
              + (select count(*) from live_bid_requests where item_id = $1) + (select count(*) from winning_results where item_id = $1) as n`,
        [b.id],
      )
      if (Number(used!.n) > 0) throw new AppError('HAS_BIDS', 'This item has bid history and can’t be deleted. Hide it instead (unpublish).', 409)
      await one('delete from auction_items where id = $1 and event_id = $2', [b.id, ev.id])
      await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'item.deleted', entityType: 'auction_item', entityId: b.id })
      return { ok: true }
    }
    case 'close':
      await closeSilentItem(b.id, admin.id)
      return { ok: true }
    case 'reopen': {
      await requireAdmin('admin')
      await finalizeDueSilentItems(admin.id) // settle anything already past its closing time first
      const when = b.newCloseAt ? localInputToUtc(b.newCloseAt, ev.timezone) : null
      await reopenItem(b.id, admin.id, b.reason, when)
      return { ok: true }
    }
    case 'publish': {
      const item = await one<{ kind: string; status: string }>('select kind, status from auction_items where id = $1', [b.id])
      if (!item) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
      if (!['draft', 'open', 'upcoming'].includes(item.status)) throw new AppError('BAD_STATE', 'Only an item that hasn’t closed can be hidden or shown.', 409)
      await one('update auction_items set status = $2, updated_at = now() where id = $1', [b.id, b.published ? (item.kind === 'live' ? 'upcoming' : 'open') : 'draft'])
      await notify(pool(), { t: 'item', id: b.id })
      return { ok: true }
    }
    case 'reorder': {
      // Live program order: renumber the not-yet-run live items 10,20,30… in their current order, then swap with the neighbour.
      await tx(async (c) => {
        const rows = await query<{ id: string }>(
          `select id from auction_items where event_id = $1 and kind = 'live' and status = 'upcoming'
            order by coalesce(live_order, 9999), item_number for update`,
          [ev.id],
          c,
        )
        const ids = rows.map((r) => r.id)
        const i = ids.indexOf(b.id)
        if (i < 0) throw new AppError('BAD_STATE', 'Only upcoming live items can be reordered.', 409)
        const j = b.direction === 'up' ? i - 1 : i + 1
        if (j < 0 || j >= ids.length) return
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        for (const [pos, id] of ids.entries()) await c.query('update auction_items set live_order = $2 where id = $1', [id, (pos + 1) * 10])
      })
      await notify(pool(), { t: 'live' })
      return { ok: true }
    }
    case 'finalize-due':
      return { finalized: await finalizeDueSilentItems(admin.id) }
  }
})
