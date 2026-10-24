import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { requestLiveBid } from '@/lib/bidding'
import { requireBidder } from '@/lib/session'

export const POST = route(async (req) => {
  const b = await body(req, z.object({ itemId: uuid, amountCents: z.number().int(), idempotencyKey: z.string().min(8).max(100) }))
  const bidder = await requireBidder()
  const r = await requestLiveBid({ ...b, bidderId: bidder.id })
  return { ok: true, requestId: r.requestId, replay: r.replay, accepted: 'accepted' in r ? r.accepted : false }
})
