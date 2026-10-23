import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import {
  acceptLiveRequest, finalizeLiveItem, recordPaddleBid, rejectLiveRequest, reopenItem,
  setLiveRunState, startLiveItem, voidLastLiveBid,
} from '@/lib/bidding'
import { requireAdmin } from '@/lib/session'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), itemId: uuid }),
  z.object({ action: z.literal('pause'), itemId: uuid }),
  z.object({ action: z.literal('resume'), itemId: uuid }),
  z.object({ action: z.literal('close'), itemId: uuid, confirmed: z.boolean() }),
  z.object({ action: z.literal('finalize'), itemId: uuid, confirmed: z.boolean() }),
  z.object({ action: z.literal('paddle'), itemId: uuid, paddleNumber: z.number().int(), amountCents: z.number().int(), idempotencyKey: z.string().min(8).max(100) }),
  z.object({ action: z.literal('accept'), requestId: uuid }),
  z.object({ action: z.literal('reject'), requestId: uuid }),
  z.object({ action: z.literal('undo'), itemId: uuid, reason: z.string().max(300) }),
  z.object({ action: z.literal('reopen'), itemId: uuid, reason: z.string().max(300) }),
])

export const POST = route(async (req) => {
  let admin = await requireAdmin() // authenticate before looking at the body
  const b = await body(req, Body)
  // Reopening a finalized item is restricted to administrators; everything else is clerk-level.
  if (b.action === 'reopen') admin = await requireAdmin('admin')
  switch (b.action) {
    case 'start':
      await startLiveItem(b.itemId, admin.id)
      return { ok: true }
    case 'pause':
    case 'resume':
      await setLiveRunState(b.itemId, b.action, admin.id)
      return { ok: true }
    case 'close':
      await setLiveRunState(b.itemId, 'close', admin.id, b.confirmed)
      return { ok: true }
    case 'finalize':
      return await finalizeLiveItem(b.itemId, admin.id, b.confirmed)
    case 'paddle':
      return await recordPaddleBid({ itemId: b.itemId, paddleNumber: b.paddleNumber, amountCents: b.amountCents, adminId: admin.id, idempotencyKey: b.idempotencyKey })
    case 'accept':
      return await acceptLiveRequest(b.requestId, admin.id)
    case 'reject':
      await rejectLiveRequest(b.requestId, admin.id)
      return { ok: true }
    case 'undo':
      await voidLastLiveBid(b.itemId, admin.id, b.reason)
      return { ok: true }
    case 'reopen':
      await reopenItem(b.itemId, admin.id, b.reason)
      return { ok: true }
  }
})
