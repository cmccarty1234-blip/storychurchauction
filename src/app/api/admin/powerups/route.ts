import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { one, query } from '@/lib/db'
import { audit } from '@/lib/audit'
import { getEvent } from '@/lib/events'
import { AppError } from '@/lib/errors'
import { recordPurchase, updateDef, voidPurchase } from '@/lib/powerups'
import { updateRoomDef } from '@/lib/rooms'
import { requireAdmin } from '@/lib/session'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('purchase'), bidderNumber: z.number().int(), code: z.string().max(40), quantity: z.number().int(), method: z.string().max(20), reference: z.string().max(100).optional(), idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal('void'), purchaseId: uuid, reason: z.string().max(300) }),
  z.object({
    action: z.literal('update-def'),
    code: z.string().max(40),
    priceCents: z.number().int().optional(),
    enabled: z.boolean().optional(),
    kinds: z.array(z.string()).optional(),
    maxPerBidderItem: z.number().int().positive().nullable().optional(),
    maxPerItem: z.number().int().positive().nullable().optional(),
    maxPerBidder: z.number().int().positive().nullable().optional(),
    seconds: z.number().int().min(5).max(600).optional(),
  }),
  z.object({ action: z.literal('set-knockout'), itemId: uuid, cents: z.number().int().min(100).max(5_000_000).nullable() }),
  z.object({ action: z.literal('update-room'), code: z.enum(['lightning', 'jackpot', 'battle']), enabled: z.boolean().optional(), prize: z.string().max(120).optional(), reward: z.string().max(120).optional(), seconds: z.number().int().min(10).max(1800).optional() }),
])

export const POST = route(async (req) => {
  const admin = await requireAdmin() // desk volunteers may record sales; configuration is administrator-only
  const b = await body(req, Body)
  switch (b.action) {
    case 'purchase': {
      const ev = await getEvent()
      const bidder = await one<{ id: string; name: string }>('select id, name from bidders where event_id = $1 and bidder_number = $2', [ev.id, b.bidderNumber])
      if (!bidder) throw new AppError('BIDDER_NOT_FOUND', `No guest with paddle number ${b.bidderNumber}.`, 404)
      const r = await recordPurchase({ bidderId: bidder.id, code: b.code, quantity: b.quantity, method: b.method, reference: b.reference, adminId: admin.id, idempotencyKey: b.idempotencyKey })
      return { ...r, bidderName: bidder.name }
    }
    case 'void':
      await requireAdmin('admin')
      await voidPurchase(b.purchaseId, admin.id, b.reason)
      return { ok: true }
    case 'update-def':
      await requireAdmin('admin')
      await updateDef(b.code, { price_cents: b.priceCents, enabled: b.enabled, kinds: b.kinds, max_per_bidder_item: b.maxPerBidderItem, max_per_item: b.maxPerItem, max_per_bidder: b.maxPerBidder, seconds: b.seconds }, admin.id)
      return { ok: true }
    case 'set-knockout':
      await requireAdmin('admin')
      await query('update auction_items set min_qualifying_bid_cents = $2, updated_at = now() where id = $1', [b.itemId, b.cents])
      await audit({ actorType: 'admin', actorId: admin.id, action: 'item.knockout_min', entityType: 'auction_item', entityId: b.itemId, details: { cents: b.cents } })
      return { ok: true }
    case 'update-room':
      await requireAdmin('admin')
      await updateRoomDef(b.code, { enabled: b.enabled, config: { ...(b.prize != null ? { prize: b.prize } : {}), ...(b.reward != null ? { reward: b.reward } : {}), ...(b.seconds != null ? { seconds: b.seconds } : {}) } }, admin.id)
      return { ok: true }
  }
})
