import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { toggleChiliHeart } from '@/lib/chili'
import { requireBidder } from '@/lib/session'

export const dynamic = 'force-dynamic'

const Body = z.object({ entryId: uuid })

/** A signed-in guest hearts (or un-hearts) a chili. Free: it changes no vote totals and no balance. */
export const POST = route(async (req) => {
  const bidder = await requireBidder()
  const b = await body(req, Body)
  return await toggleChiliHeart({ bidderId: bidder.id, entryId: b.entryId })
})
