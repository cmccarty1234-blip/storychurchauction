import { route } from '@/lib/api'
import { startOnlinePayment } from '@/lib/online-pay'
import { requireBidder } from '@/lib/session'

/** A signed-in guest starts paying their own balance. The amount is computed on the server, never sent by the browser. */
export const POST = route(async () => {
  const bidder = await requireBidder()
  return await startOnlinePayment(bidder.id)
})
