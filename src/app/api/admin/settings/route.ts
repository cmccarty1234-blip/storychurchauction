import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { one, pool } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { audit } from '@/lib/audit'
import { createAdminUser } from '@/lib/auth-core'
import { getEvent } from '@/lib/events'
import { localInputToUtc } from '@/lib/time'
import { requireAdmin } from '@/lib/session'

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('event'),
    name: z.string().trim().min(1).max(120),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    timezone: z.string().max(60),
    silentStart: z.string().nullish(),
    silentClose: z.string().nullish(),
    defaultIncrementCents: z.number().int().min(100).max(5_000_000),
    pickupInstructions: z.string().max(2000),
    contactInfo: z.string().max(1000),
  }),
  z.object({ action: z.literal('staff-create'), email: z.string().email(), name: z.string().trim().min(1).max(80), password: z.string().min(8).max(100), role: z.enum(['admin', 'volunteer']) }),
  z.object({ action: z.literal('staff-active'), id: uuid, active: z.boolean() }),
])

export const POST = route(async (req) => {
  const admin = await requireAdmin('admin')
  const b = await body(req, Body)
  const ev = await getEvent()

  if (b.action === 'event') {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: b.timezone })
    } catch {
      throw new AppError('INVALID_TIMEZONE', 'Unknown timezone (use a name like America/Denver).')
    }
    const start = b.silentStart ? localInputToUtc(b.silentStart, b.timezone) : null
    const close = b.silentClose ? localInputToUtc(b.silentClose, b.timezone) : null
    if (start && close && close <= start) throw new AppError('INVALID_TIME', 'The silent auction must close after it opens.')
    await pool().query(
      `update events set name=$2, event_date=$3, timezone=$4, silent_start_at=$5, silent_close_at=$6,
              default_increment_cents=$7, pickup_instructions=$8, contact_info=$9 where id=$1`,
      [ev.id, b.name, b.eventDate ?? null, b.timezone, start, close, b.defaultIncrementCents, b.pickupInstructions, b.contactInfo],
    )
    await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'settings.updated', entityType: 'event', entityId: ev.id, details: { silentClose: close } })
    return { ok: true }
  }
  if (b.action === 'staff-create') {
    const u = await createAdminUser(b)
    await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'staff.created', entityType: 'admin_user', entityId: u!.id, details: { role: b.role } })
    return { id: u!.id }
  }
  if (b.id === admin.id && !b.active) throw new AppError('SELF_DEACTIVATE', 'You can’t deactivate your own account.')
  await one('update admin_users set active = $2 where id = $1', [b.id, b.active])
  await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: b.active ? 'staff.activated' : 'staff.deactivated', entityType: 'admin_user', entityId: b.id })
  return { ok: true }
})
