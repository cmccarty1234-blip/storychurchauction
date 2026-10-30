/**
 * "Commercial first, then bidding opens": when the host starts a live item that has an auto-play commercial, the commercial
 * takes over the projector and the item stays UPCOMING (so nobody can bid and no timer runs). When the commercial's time is
 * up — or the host stops it — the item is started exactly as if the host had tapped Start at that moment.
 */
import { one, tx } from './db'
import { audit } from './audit'
import { notify } from './realtime'
import { startLiveItem } from './bidding'
import { AppError } from './errors'
import { COMMERCIALS, HOUSE_COMMERCIAL, commercialByKey, type Commercial } from './commercials'

/** The commercial that plays when this item is started: its own clip (linked by title), else the house spot for any live item. */
export async function autoCommercialFor(itemId: string): Promise<Commercial | null> {
  const it = await one<{ title: string; kind: string }>('select title, kind from auction_items where id = $1', [itemId])
  if (!it) return null
  const t = it.title.toLowerCase()
  return COMMERCIALS.find((c) => c.autoOnStart && c.promote && t.includes(c.promote.toLowerCase())) ?? (it.kind === 'live' ? HOUSE_COMMERCIAL : null)
}

/** Host tapped Start (`withVideo` false = "Start without video": straight to bidding). Returns whether a commercial is now playing first (otherwise the item was started straight away). */
export async function startItemWithCommercial(itemId: string, adminId: string, withVideo = true) {
  const clip = withVideo ? await autoCommercialFor(itemId) : null
  if (clip) {
    // Only when the start would succeed anyway — otherwise let startLiveItem report the real problem (busy block, emergency…).
    const ok = await tx(async (c) => {
      const row = await one<{ status: string; kind: string; event_id: string; busy: boolean; emergency: boolean; playing: boolean; pending: boolean }>(
        `select i.status, i.kind, i.event_id,
                exists (select 1 from auction_items x where x.event_id = i.event_id and x.kind = 'live' and x.status in ('open','paused')) as busy,
                e.emergency_stop_at is not null as emergency,
                (e.commercial_started_at is not null and e.commercial_started_at + make_interval(secs => 120) > clock_timestamp()) as playing,
                e.commercial_start_item_id is not null as pending
           from auction_items i join events e on e.id = i.event_id where i.id = $1 for update of e`,
        [itemId],
        c,
      )
      // Another item is already waiting out its commercial: don't let a second Start jump the queue.
      if (row?.pending && row.playing) throw new AppError('COMMERCIAL_ACTIVE', 'An item is about to open after its commercial. Wait for it, or tap Skip it & open bidding.', 409)
      if (!row || row.status !== 'upcoming' || row.kind !== 'live' || row.busy || row.emergency || row.playing) return false
      await c.query(
        'update events set commercial_key = $2, commercial_item_id = $3, commercial_started_at = now(), commercial_start_item_id = $3, commercial_admin_id = $4 where id = $1',
        [row.event_id, clip.key, itemId, adminId],
      )
      await audit({ eventId: row.event_id, actorType: 'admin', actorId: adminId, action: 'host.commercial', entityType: 'auction_item', entityId: itemId, details: { key: clip.key, opensItem: true } }, c)
      await notify(c, { t: 'game' })
      return true
    })
    if (ok) return { commercial: true as const }
  }
  await startLiveItem(itemId, adminId)
  return { commercial: false as const }
}

/** Opens a pending item once its commercial has finished (or was stopped). Cheap when nothing is pending. */
export async function advanceCommercialStart(eventId: string) {
  const e = await one<{ key: string | null; started: Date | null; item: string | null; admin: string | null; emergency: boolean; now: Date }>(
    `select commercial_key as key, commercial_started_at as started, commercial_start_item_id as item, commercial_admin_id as admin,
            emergency_stop_at is not null as emergency, clock_timestamp() as now from events where id = $1`,
    [eventId],
  )
  if (!e?.item || !e.admin || e.emergency) return 0
  const clip = commercialByKey(e.key)
  const done = !e.started || !clip || e.now.getTime() >= e.started.getTime() + clip.seconds * 1000
  if (!done) return 0
  // Claim it once, even if several screens ask at the same moment.
  const claimed = await one('update events set commercial_start_item_id = null where id = $1 and commercial_start_item_id = $2 returning id', [eventId, e.item])
  if (!claimed) return 0
  try {
    await startLiveItem(e.item, e.admin)
  } catch (err) {
    await audit({ eventId, actorType: 'system', action: 'commercial.start_failed', entityType: 'auction_item', entityId: e.item, details: { message: String((err as Error)?.message ?? err).slice(0, 200) } }).catch(() => {})
  }
  return 1
}
