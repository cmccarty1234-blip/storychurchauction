import { z } from 'zod'
import { body, route } from '@/lib/api'
import { tx } from '@/lib/db'
import { getEvent } from '@/lib/events'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/realtime'
import { requireAdmin } from '@/lib/session'

const Body = z.object({
  gameMode: z.boolean(),
  autoAcceptLive: z.boolean(),
  provisionalSilent: z.boolean(),
  provisionalSeconds: z.number().int().min(30).max(3600),
  liveInitialSeconds: z.number().int().min(10).max(600),
  liveInactivitySeconds: z.number().int().min(5).max(120),
  liveWarningSeconds: z.number().int().min(3).max(60),
  liveMaxSeconds: z.number().int().min(30).max(3600).nullable(),
  minReopenSeconds: z.number().int().min(3).max(120),
  goalCents: z.number().int().min(100).max(100_000_000).nullable(),
})

export const POST = route(async (req) => {
  const admin = await requireAdmin('admin')
  const b = await body(req, Body)
  const ev = await getEvent()
  await tx(async (c) => {
    await c.query(
      `update events set game_mode=$2, auto_accept_live=$3, provisional_silent=$4, provisional_seconds=$5, live_initial_seconds=$6,
              live_inactivity_seconds=$7, live_warning_seconds=$8, live_max_seconds=$9, min_reopen_seconds=$10, goal_cents=$11 where id = $1`,
      [ev.id, b.gameMode, b.autoAcceptLive, b.provisionalSilent, b.provisionalSeconds, b.liveInitialSeconds, b.liveInactivitySeconds, b.liveWarningSeconds, b.liveMaxSeconds, b.minReopenSeconds, b.goalCents],
    )
    await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'event.game_settings', details: b }, c)
    await notify(c, { t: 'game' })
    await notify(c, { t: 'item' })
  })
  return { ok: true }
})
