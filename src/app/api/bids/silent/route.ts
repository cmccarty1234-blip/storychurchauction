import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { placeSilentBid } from '@/lib/bidding'
import { requireBidder } from '@/lib/session'

export const POST = route(async (req) => {
  const b = await body(
    req,
    z.object({
      itemId: uuid,
      amountCents: z.number().int(),
      expectedCurrentCents: z.number().int().nullable(),
      idempotencyKey: z.string().min(8).max(100),
    }),
  )
  // Identity comes from the signed-in session — never from the request body.
  const bidder = await requireBidder()
  const r = await placeSilentBid({ ...b, bidderId: bidder.id })
  return { ok: true, replay: r.replay, currentCents: r.currentCents, minNextCents: r.minNextCents }
})
