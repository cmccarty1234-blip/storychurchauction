import { route } from '@/lib/api'
import { AppError } from '@/lib/errors'
import { deskGuest, deskItem } from '@/lib/bid-desk'
import { getEvent } from '@/lib/events'
import { requireAdmin } from '@/lib/session'

/** Staff-only lookups for the Bid Desk screen: ?paddle=1048 or ?item=12. Placing the bid itself uses /api/admin/bids. */
export const GET = route(async (req) => {
  await requireAdmin()
  const url = new URL(req.url)
  const ev = await getEvent()
  const paddle = url.searchParams.get('paddle')
  const item = url.searchParams.get('item')
  if (paddle !== null) {
    if (!/^\d{1,6}$/.test(paddle)) throw new AppError('INVALID_REQUEST', 'Enter the guest’s paddle number.')
    return await deskGuest(ev.id, parseInt(paddle, 10))
  }
  if (item !== null) {
    if (!/^\d{1,5}$/.test(item)) throw new AppError('INVALID_REQUEST', 'Enter the item number from the item card.')
    return await deskItem(ev.id, parseInt(item, 10))
  }
  throw new AppError('INVALID_REQUEST', 'Pass ?paddle= or ?item=.')
})
