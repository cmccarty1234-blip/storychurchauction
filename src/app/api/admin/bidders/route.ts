import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { one, pool, tx } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { createBidder, resetBidderPin } from '@/lib/auth-core'
import { normalizeEmail, normalizePhone } from '@/lib/contact'
import { getEvent } from '@/lib/events'
import { requireAdmin } from '@/lib/session'

function phone(v?: string | null) {
  if (!v?.trim()) return null
  const p = normalizePhone(v)
  if (!p) throw new AppError('INVALID_CONTACT', 'That phone number doesn’t look right (use 10 digits).')
  return p
}
function email(v?: string | null) {
  if (!v?.trim()) return null
  const e = normalizeEmail(v)
  if (!e) throw new AppError('INVALID_CONTACT', 'That email address doesn’t look right.')
  return e
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), name: z.string().trim().min(2, 'Enter the guest’s full name').max(80), phone: z.string().nullish(), email: z.string().nullish() }),
  z.object({ action: z.literal('reset-pin'), id: uuid }),
  z.object({ action: z.literal('update'), id: uuid, name: z.string().trim().min(2).max(80), phone: z.string().nullish(), email: z.string().nullish() }),
])

export const POST = route(async (req) => {
  const admin = await requireAdmin()
  const b = await body(req, Body)
  const ev = await getEvent()

  if (b.action === 'register') {
    // Assisted bidder: contact info is optional; a volunteer vouches for the guest and issues the paddle.
    const bidder = await tx((c) =>
      createBidder(c, { eventId: ev.id, name: b.name, phone: phone(b.phone), email: email(b.email), assisted: true, adminId: admin.id }),
    )
    await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'bidder.assisted_registered', entityType: 'bidder', entityId: bidder.id, details: { bidderNumber: bidder.bidder_number } })
    return { id: bidder.id, bidderNumber: bidder.bidder_number }
  }

  if (b.action === 'reset-pin') return await resetBidderPin(b.id, admin.id)

  const before = await one<any>('select name, phone, email from bidders where id = $1 and event_id = $2', [b.id, ev.id])
  if (!before) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
  const next = { name: b.name, phone: phone(b.phone), email: email(b.email) }
  const bidderRow = await one<{ assisted: boolean }>('select assisted from bidders where id = $1', [b.id])
  if (!next.phone && !next.email && !bidderRow!.assisted) throw new AppError('INVALID_CONTACT', 'A phone number or email is required.')
  try {
    await pool().query('update bidders set name=$2, phone=$3, email=$4, updated_at=now() where id=$1', [b.id, next.name, next.phone, next.email])
  } catch (e: any) {
    if (e.code === '23505') throw new AppError('DUPLICATE_CONTACT', 'Another bidder already uses that phone or email.', 409)
    throw e
  }
  await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'bidder.updated', entityType: 'bidder', entityId: b.id, details: { before, after: next } })
  return { ok: true }
})
