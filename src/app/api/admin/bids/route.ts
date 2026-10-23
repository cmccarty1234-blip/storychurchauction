import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { one } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { placeSilentBid } from '@/lib/bidding'
import { getEvent } from '@/lib/events'
import { requireAdmin } from '@/lib/session'

/** A volunteer places a silent-auction bid on behalf of a registered guest (e.g. no smartphone). */
export const POST = route(async (req) => {
  const admin = await requireAdmin()
  const b = await body(
    req,
    z.object({
      itemId: uuid,
      bidderNumber: z.number().int(),
      amountCents: z.number().int(),
      expectedCurrentCents: z.number().int().nullable(),
      idempotencyKey: z.string().min(8).max(100),
    }),
  )
  const ev = await getEvent()
  const bidder = await one<{ id: string }>('select id from bidders where event_id = $1 and bidder_number = $2', [ev.id, b.bidderNumber])
  if (!bidder) throw new AppError('BIDDER_NOT_FOUND', `No bidder with number ${b.bidderNumber}.`, 404)
  const r = await placeSilentBid({ bidderId: bidder.id, itemId: b.itemId, amountCents: b.amountCents, expectedCurrentCents: b.expectedCurrentCents, idempotencyKey: b.idempotencyKey, adminId: admin.id })
  return { ok: true, currentCents: r.currentCents, minNextCents: r.minNextCents }
})
