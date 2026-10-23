import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { recordPayment, releaseItem, unreleaseItem, voidPayment } from '@/lib/checkout'
import { requireAdmin } from '@/lib/session'

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('pay'),
    bidderId: uuid,
    method: z.enum(['cash', 'check', 'card_terminal']),
    amountCents: z.number().int(),
    reference: z.string().max(100).optional(),
    note: z.string().max(300).optional(),
    idempotencyKey: z.string().min(8).max(100),
  }),
  z.object({ action: z.literal('void'), paymentId: uuid, reason: z.string().max(300) }),
  z.object({ action: z.literal('release'), winningResultId: uuid, exceptionReason: z.string().max(300).optional() }),
  z.object({ action: z.literal('unrelease'), winningResultId: uuid, reason: z.string().max(300) }),
])

export const POST = route(async (req) => {
  let admin = await requireAdmin() // authenticate before looking at the body
  const b = await body(req, Body)
  // Corrections (void / unrelease) are administrator-only; recording money and handing over paid items is volunteer-level.
  if (b.action === 'void' || b.action === 'unrelease') admin = await requireAdmin('admin')
  switch (b.action) {
    case 'pay':
      return await recordPayment({ ...b, adminId: admin.id })
    case 'void':
      return await voidPayment(b.paymentId, admin.id, b.reason)
    case 'release':
      await releaseItem({ winningResultId: b.winningResultId, adminId: admin.id, isAdmin: admin.role === 'admin', exceptionReason: b.exceptionReason })
      return { ok: true }
    case 'unrelease':
      await unreleaseItem(b.winningResultId, admin.id, b.reason)
      return { ok: true }
  }
})
