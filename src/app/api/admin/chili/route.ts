import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { markChiliPaid, voidChiliVotes } from '@/lib/chili'
import { requireAdmin } from '@/lib/session'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('paid'), bidderId: uuid, method: z.enum(['cash', 'check', 'card_terminal']) }),
  z.object({ action: z.literal('void'), bidderId: uuid, entryId: uuid, reason: z.string().min(1).max(200) }),
])

/** Desk volunteers: record that a guest paid for their chili votes, or remove a mistaken (unpaid) vote. */
export const POST = route(async (req) => {
  const admin = await requireAdmin()
  const b = await body(req, Body)
  if (b.action === 'paid') return await markChiliPaid({ bidderId: b.bidderId, method: b.method, adminId: admin.id })
  return await voidChiliVotes({ bidderId: b.bidderId, entryId: b.entryId, adminId: admin.id, reason: b.reason })
})
