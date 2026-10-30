import { z } from 'zod'
import { body, route } from '@/lib/api'
import { startPowerUpPayment } from '@/lib/online-powerups'
import { requireBidder } from '@/lib/session'

const Body = z.object({ code: z.string().max(40), quantity: z.number().int() })

/** A signed-in guest starts buying Power-Ups online. Returns the Square page to pay on; nothing is credited until Square confirms. */
export const POST = route(async (req) => {
  const bidder = await requireBidder()
  const b = await body(req, Body)
  return await startPowerUpPayment({ bidderId: bidder.id, code: b.code, quantity: b.quantity })
})
