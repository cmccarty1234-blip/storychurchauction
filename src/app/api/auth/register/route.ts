import { z } from 'zod'
import { body, route } from '@/lib/api'
import { registerBidder } from '@/lib/auth-core'
import { setSessionCookie } from '@/lib/session'

export const POST = route(async (req) => {
  const b = await body(req, z.object({ name: z.string().max(100), contact: z.string().max(200) }))
  const { bidder, token, pin } = await registerBidder(b.contact, b.name)
  await setSessionCookie('bidder', token)
  // The PIN is returned exactly once, here. Only a hash is stored.
  return { bidderNumber: bidder.bidder_number, name: bidder.name, pin }
})
