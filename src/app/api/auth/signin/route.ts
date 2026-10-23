import { z } from 'zod'
import { body, route } from '@/lib/api'
import { signInBidder } from '@/lib/auth-core'
import { setSessionCookie } from '@/lib/session'

export const POST = route(async (req) => {
  const b = await body(req, z.object({ bidderNumber: z.number().int(), pin: z.string().max(8) }))
  const { bidder, token } = await signInBidder(b.bidderNumber, b.pin)
  await setSessionCookie('bidder', token)
  return { bidderNumber: bidder.bidder_number, name: bidder.name }
})
