import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { activatePowerUp, previewPowerUp } from '@/lib/powerups'
import { requireBidder } from '@/lib/session'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), itemId: uuid, code: z.string().max(40), targetNumber: z.number().int().optional(), amountCents: z.number().int().optional() }),
  z.object({ action: z.literal('activate'), itemId: uuid, code: z.string().max(40), idempotencyKey: z.string().min(8).max(100), targetNumber: z.number().int().optional(), amountCents: z.number().int().optional() }),
])

/** A guest previews or uses a Power-Up they own. Every rule is enforced on the server; the screen only displays the result. */
export const POST = route(async (req) => {
  const bidder = await requireBidder()
  const b = await body(req, Body)
  if (b.action === 'preview') return await previewPowerUp({ bidderId: bidder.id, itemId: b.itemId, code: b.code, targetNumber: b.targetNumber, amountCents: b.amountCents })
  return await activatePowerUp({ bidderId: bidder.id, itemId: b.itemId, code: b.code, idempotencyKey: b.idempotencyKey, targetNumber: b.targetNumber, amountCents: b.amountCents })
})
