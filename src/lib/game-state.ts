/**
 * The single, server-built snapshot that the projector, host console and customer portal all render.
 * Public-safe: bidder NUMBERS only (never names or contact details). All times are the database clock; clients
 * compute "seconds left" from `serverNow` so a wrong device clock cannot change what anyone sees.
 */
import { one, query } from './db'
import { advanceDue } from './lifecycle'
import { activeSession, advanceRooms, battleScore } from './rooms'
import { minNextBid } from './bidding'
import { pieLine, pieSummary, type PieSummary } from './pies'
import { commercialByKey } from './commercials'

export type StageItem = {
  id: string
  number: number
  kind: 'silent' | 'live'
  title: string
  imagePath: string | null
  status: string
  timerPhase: string | null
  deadlineAt: string | null
  pauseRemainingMs: number | null
  haltKind: string | null
  provisionalUntil: string | null
  currentBidCents: number | null
  leaderNumber: number | null
  minNextCents: number
  bidCount: number
  reopenUsed: boolean
}

export type GameState = {
  serverNow: string
  event: {
    id: string
    name: string
    gameMode: boolean
    timezone: string
    emergency: { reason: string | null; since: string } | null
    displayMode: string
    displayMessage: string | null
    warningSeconds: number
    goalCents: number | null
    silentCloseAt: string | null
    pickup: string
  }
  stage: StageItem | null // the live item on the block
  reopened: StageItem[]
  lastChance: StageItem[]
  nextLive: { id: string; number: number; title: string; imagePath: string | null; startingBidCents: number } | null
  hot: { id: string; number: number; title: string; imagePath: string | null; currentBidCents: number | null; bidCount: number; leaderNumber: number | null; closesAt: string | null }[]
  closingSoon: { id: string; number: number; title: string; currentBidCents: number | null; closesAt: string }[]
  recentBids: { itemNumber: number; title: string; bidderNumber: number; amountCents: number; at: string }[]
  bidsTonight: number
  pies: PieSummary & { next: { bidderNumber: number; size: 'small' | 'large' }[] }
  totals: { leadingCents: number; finalizedCents: number; powerupCents: number; pieCents: number; paymentsCents: number; outstandingCents: number; itemsSold: number }
  announcements: { id: string; kind: string; headline: string; body: string | null; interrupt: boolean; at: string; itemId: string | null; payload: Record<string, unknown> }[]
  commercial: null | {
    key: string
    title: string
    youtubeId: string
    tagline: string
    startedAt: string
    endsAt: string
    item: { id: string; number: number; title: string; imagePath: string | null; currentBidCents: number | null } | null
  }
  room: null | {
    id: string
    code: string
    endsAt: string | null
    config: Record<string, unknown>
    battle?: Awaited<ReturnType<typeof battleScore>>
    lightningItems?: number[]
  }
}

/** Advances every due timer and Room Event. Cheap when nothing is due (one query). */
export async function gameTick(eventId: string) {
  const a = await advanceDue(eventId)
  const b = await advanceRooms(eventId)
  return a + b
}

const ITEM_COLS = `i.id, i.item_number, i.kind, i.title, i.image_path, i.status, i.timer_phase, i.deadline_at, i.pause_remaining_ms, i.halt_kind,
       i.provisional_until, i.current_bid_cents, i.bid_count, i.starting_bid_cents, i.increment_cents, i.reopened_at, b.bidder_number as leader_number,
       (select (rs.config->>'incrementCents')::int from room_event_sessions rs where rs.event_id = i.event_id and rs.code = 'lightning' and rs.status = 'active'
           and rs.ends_at > clock_timestamp() and (rs.config->'itemIds') @> to_jsonb(i.id::text) limit 1) as lightning_increment_cents`

const iso = (d: Date | null) => (d ? d.toISOString() : null)
function stage(r: any): StageItem {
  return {
    id: r.id,
    number: r.item_number,
    kind: r.kind,
    title: r.title,
    imagePath: r.image_path,
    status: r.status,
    timerPhase: r.timer_phase,
    deadlineAt: iso(r.deadline_at),
    pauseRemainingMs: r.pause_remaining_ms,
    haltKind: r.halt_kind,
    provisionalUntil: iso(r.provisional_until),
    currentBidCents: r.current_bid_cents,
    leaderNumber: r.leader_number,
    minNextCents: minNextBid(r),
    bidCount: r.bid_count,
    reopenUsed: !!r.reopened_at,
  }
}

export async function gameState(eventId: string): Promise<GameState> {
  const ev = await one<any>(
    `select id, name, game_mode, emergency_stop_at, emergency_reason, display_mode, display_message, timezone, live_warning_seconds, goal_cents, silent_close_at, pickup_instructions, clock_timestamp() as now from events where id = $1`,
    [eventId],
  )
  const from = `from auction_items i left join bidders b on b.id = i.current_bidder_id where i.event_id = $1`
  const [onBlock, reopened, lastChance, next, hot, closing, bids, totals, ann, room] = await Promise.all([
    query<any>(`select ${ITEM_COLS} ${from} and i.kind = 'live' and i.status in ('open','paused') limit 1`, [eventId]),
    query<any>(`select ${ITEM_COLS} ${from} and i.status = 'reopened' order by i.deadline_at`, [eventId]),
    query<any>(`select ${ITEM_COLS} ${from} and i.status = 'provisional' order by i.provisional_until`, [eventId]),
    query<any>(`select id, item_number, title, image_path, starting_bid_cents from auction_items where event_id = $1 and kind = 'live' and status = 'upcoming' order by coalesce(live_order, 9999), item_number limit 1`, [eventId]),
    query<any>(
      `select i.id, i.item_number, i.title, i.image_path, i.current_bid_cents, i.bid_count, b.bidder_number as leader_number, coalesce(i.closes_at, e.silent_close_at) as closes_at
         from auction_items i join events e on e.id = i.event_id left join bidders b on b.id = i.current_bidder_id
        where i.event_id = $1 and i.kind = 'silent' and i.status = 'open' and i.bid_count > 0 order by i.bid_count desc, i.current_bid_cents desc limit 8`,
      [eventId],
    ),
    query<any>(
      `select i.id, i.item_number, i.title, i.current_bid_cents, coalesce(i.closes_at, e.silent_close_at) as closes_at
         from auction_items i join events e on e.id = i.event_id
        where i.event_id = $1 and i.kind = 'silent' and i.status = 'open' and coalesce(i.closes_at, e.silent_close_at) between clock_timestamp() and clock_timestamp() + interval '20 minutes'
        order by 5 limit 5`,
      [eventId],
    ).catch(() => []),
    query<any>(
      `(select i.item_number, i.title, b.bidder_number, s.amount_cents, s.created_at from silent_bids s join auction_items i on i.id = s.item_id join bidders b on b.id = s.bidder_id where i.event_id = $1 order by s.created_at desc limit 8)
       union all
       (select i.item_number, i.title, b.bidder_number, a.amount_cents, a.created_at from live_accepted_bids a join auction_items i on i.id = a.item_id join bidders b on b.id = a.bidder_id
         where i.event_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = a.id) order by a.created_at desc limit 8)
       order by created_at desc limit 8`,
      [eventId],
    ),
    one<any>(
      `select
         (select coalesce(sum(current_bid_cents), 0) from auction_items where event_id = $1 and status in ('open','paused','closed','provisional','reopened'))::int as leading,
         (select coalesce(sum(w.amount_cents), 0) from winning_results w join auction_items i on i.id = w.item_id where i.event_id = $1 and w.voided_at is null)::int as finalized,
         (select count(*) from winning_results w join auction_items i on i.id = w.item_id where i.event_id = $1 and w.voided_at is null)::int as sold,
         (select coalesce(sum(p.total_cents), 0) from powerup_purchases p join powerup_defs d on d.code = p.powerup_code and d.category = 'powerup' where p.event_id = $1 and p.voided_at is null)::int as powerups,
         (select coalesce(sum(p.total_cents), 0) from powerup_purchases p join powerup_defs d on d.code = p.powerup_code and d.category = 'pie' where p.event_id = $1 and p.voided_at is null)::int as pies,
         (select coalesce(sum(a.amount_cents), 0) from payment_allocations a join payments p on p.id = a.payment_id where p.event_id = $1 and p.voided_at is null)::int as paid,
         ((select count(*) from silent_bids s join auction_items i on i.id = s.item_id where i.event_id = $1)
          + (select count(*) from live_accepted_bids a join auction_items i on i.id = a.item_id where i.event_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = a.id)))::int as bids`,
      [eventId],
    ),
    query<any>(`select id, kind, headline, body, interrupt, created_at, item_id, payload from announcements where event_id = $1 order by created_at desc limit 15`, [eventId]),
    activeSession(eventId),
  ])

  let roomOut: GameState['room'] = null
  if (room) {
    roomOut = { id: room.id, code: room.code, endsAt: iso(room.ends_at), config: room.config }
    if (room.code === 'battle') roomOut.battle = await battleScore(room.id)
    if (room.code === 'lightning') roomOut.lightningItems = room.config.itemNumbers ?? []
  }

  // A commercial break the host started; only reported while it is still on screen. Safe if migration 0008 hasn't been run.
  let commercial: GameState['commercial'] = null
  try {
    const c = await one<any>(
      `select e.commercial_key, e.commercial_started_at, i.id, i.item_number, i.title, i.image_path, i.current_bid_cents
         from events e left join auction_items i on i.id = e.commercial_item_id where e.id = $1 and e.commercial_started_at is not null`,
      [eventId],
    )
    const clip = commercialByKey(c?.commercial_key)
    if (c && clip) {
      const endsAt = new Date(c.commercial_started_at.getTime() + clip.seconds * 1000)
      if (endsAt.getTime() > ev.now.getTime()) {
        commercial = {
          key: clip.key,
          title: clip.title,
          youtubeId: clip.youtubeId,
          tagline: clip.tagline,
          startedAt: c.commercial_started_at.toISOString(),
          endsAt: endsAt.toISOString(),
          item: c.id ? { id: c.id, number: c.item_number, title: c.title, imagePath: c.image_path, currentBidCents: c.current_bid_cents } : null,
        }
      }
    }
  } catch {}

  return {
    serverNow: ev.now.toISOString(),
    event: {
      id: ev.id,
      name: ev.name,
      gameMode: ev.game_mode,
      timezone: ev.timezone,
      emergency: ev.emergency_stop_at ? { reason: ev.emergency_reason, since: ev.emergency_stop_at.toISOString() } : null,
      displayMode: ev.display_mode,
      displayMessage: ev.display_message,
      warningSeconds: ev.live_warning_seconds,
      goalCents: ev.goal_cents,
      silentCloseAt: iso(ev.silent_close_at),
      pickup: ev.pickup_instructions ?? '',
    },
    stage: onBlock[0] ? stage(onBlock[0]) : null,
    reopened: reopened.map(stage),
    lastChance: lastChance.map(stage),
    nextLive: next[0] ? { id: next[0].id, number: next[0].item_number, title: next[0].title, imagePath: next[0].image_path, startingBidCents: next[0].starting_bid_cents } : null,
    hot: hot.map((h: any) => ({ id: h.id, number: h.item_number, title: h.title, imagePath: h.image_path, currentBidCents: h.current_bid_cents, bidCount: h.bid_count, leaderNumber: h.leader_number, closesAt: iso(h.closes_at) })),
    closingSoon: closing.map((h: any) => ({ id: h.id, number: h.item_number, title: h.title, currentBidCents: h.current_bid_cents, closesAt: h.closes_at.toISOString() })),
    recentBids: bids.map((b: any) => ({ itemNumber: b.item_number, title: b.title, bidderNumber: b.bidder_number, amountCents: b.amount_cents, at: b.created_at.toISOString() })),
    bidsTonight: totals.bids,
    pies: { ...(await pieSummary(eventId)), next: (await pieLine(eventId)).slice(0, 4).map((p) => ({ bidderNumber: p.bidderNumber, size: p.size })) },
    totals: { leadingCents: totals.leading, finalizedCents: totals.finalized, powerupCents: totals.powerups, pieCents: totals.pies, paymentsCents: totals.paid, outstandingCents: totals.finalized - totals.paid, itemsSold: totals.sold },
    announcements: ann.map((a: any) => ({ id: a.id, kind: a.kind, headline: a.headline, body: a.body, interrupt: a.interrupt, at: a.created_at.toISOString(), itemId: a.item_id, payload: a.payload })),
    commercial,
    room: roomOut,
  }
}
