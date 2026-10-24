/**
 * Room Events — free, event-wide mechanics run by the hosts.
 *   Lightning Round   : for a short time, chosen silent items accept $1-step bids. Deadlines are untouched.
 *   Mystery Jackpot   : a free random drawing among registered attendees. The animation is cosmetic; the winner is
 *                       chosen here with a cryptographic RNG over a stored snapshot of the entries.
 *   Battle of the Room: two teams; accepted bids earn GAME POINTS (not dollars). Scoring is idempotent per bid.
 * Only one Room Event is active at a time.
 */
import type pg from 'pg'
import { randomInt } from 'node:crypto'
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { announce } from './announce'
import { notify } from './realtime'

export type RoomCode = 'lightning' | 'jackpot' | 'battle'
export type Team = 'gold' | 'black'

export const BATTLE_RULES = '10 points for every bid that is accepted, plus 1 point for every $10 that bid raises the price. Points are a game — they are not dollars raised.'

export async function activeSession(eventId: string, db?: pg.PoolClient) {
  return one<{ id: string; code: RoomCode; starts_at: Date; ends_at: Date | null; config: Record<string, any> }>(
    `select id, code, starts_at, ends_at, config from room_event_sessions where event_id = $1 and status = 'active' order by starts_at desc limit 1`,
    [eventId],
    db,
  )
}

export async function listRoomDefs() {
  return query<{ code: RoomCode; name: string; enabled: boolean; config: Record<string, any> }>('select * from room_event_defs order by code')
}

export async function updateRoomDef(code: RoomCode, p: { enabled?: boolean; config?: Record<string, unknown> }, adminId: string) {
  const d = await one<{ enabled: boolean; config: Record<string, unknown> }>('select * from room_event_defs where code = $1', [code])
  if (!d) throw new AppError('NOT_FOUND', 'Unknown Room Event.', 404)
  const config = { ...d.config, ...(p.config ?? {}) }
  await query('update room_event_defs set enabled = $2, config = $3 where code = $1', [code, p.enabled ?? d.enabled, JSON.stringify(config)])
  await audit({ actorType: 'admin', actorId: adminId, action: 'room.def_changed', entityType: 'room_event', details: { code, config, enabled: p.enabled } })
}

const clampSecs = (n: unknown, d: number) => (Number.isInteger(n) && (n as number) >= 10 && (n as number) <= 1800 ? (n as number) : d)

export async function startRoomEvent(eventId: string, code: RoomCode, adminId: string, o: { itemIds?: string[]; prize?: string; reward?: string; seconds?: number } = {}) {
  return tx(async (c) => {
    await c.query('select 1 from events where id = $1 for update', [eventId]) // serialises starts
    const def = await one<{ name: string; enabled: boolean; config: Record<string, any> }>('select * from room_event_defs where code = $1', [code], c)
    if (!def) throw new AppError('NOT_FOUND', 'Unknown Room Event.', 404)
    if (!def.enabled) throw new AppError('DISABLED', `${def.name} is switched off.`, 409)
    const ev = await one<{ game_mode: boolean }>('select game_mode from events where id = $1', [eventId], c)
    if (!ev?.game_mode) throw new AppError('GAME_OFF', 'Game mode is not switched on for this event.', 409)
    if (await activeSession(eventId, c)) throw new AppError('ALREADY_ACTIVE', 'Another Room Event is running. End it first.', 409)

    const config: Record<string, unknown> = { ...def.config }
    let endsAt: Date | null = null
    if (code === 'lightning') {
      const secs = clampSecs(o.seconds ?? def.config.seconds, 60)
      const items = await query<{ id: string; item_number: number }>(
        `select id, item_number from auction_items where event_id = $1 and kind = 'silent' and status = 'open'
            and ($2::uuid[] is null or id = any($2::uuid[]))`,
        [eventId, o.itemIds?.length ? o.itemIds : null],
        c,
      )
      if (!items.length) throw new AppError('NO_ITEMS', 'There are no open silent items for the Lightning Round.', 409)
      config.itemIds = items.map((i) => i.id)
      config.itemNumbers = items.map((i) => i.item_number)
      config.incrementCents = 100
      config.seconds = secs
      endsAt = new Date(Date.now() + secs * 1000)
    } else if (code === 'battle') {
      config.seconds = clampSecs(o.seconds ?? def.config.seconds, 180)
      if (o.reward) config.reward = o.reward.slice(0, 120)
      endsAt = new Date(Date.now() + (config.seconds as number) * 1000)
    } else {
      if (o.prize) config.prize = o.prize.slice(0, 120)
    }
    // ends_at is computed from the DATABASE clock so every screen counts to the same instant
    const s = await one<{ id: string; ends_at: Date | null }>(
      `insert into room_event_sessions (event_id, code, config, ends_at, started_by)
       values ($1,$2,$3, case when $4::int is null then null else clock_timestamp() + make_interval(secs => $4::int) end, $5) returning id, ends_at`,
      [eventId, code, JSON.stringify(config), endsAt ? (config.seconds as number) : null, adminId],
      c,
    )
    if (code === 'battle') await assignTeams(c, eventId, s!.id)
    await audit({ eventId, actorType: 'admin', actorId: adminId, action: `room.${code}.start`, entityType: 'room_event', entityId: s!.id, details: config }, c)
    await announce(c, {
      eventId,
      kind: `room.${code}`,
      headline: code === 'lightning' ? 'LIGHTNING ROUND!' : code === 'battle' ? 'BATTLE OF THE ROOM!' : 'MYSTERY JACKPOT!',
      body: code === 'lightning' ? `$1 bids on ${(config.itemIds as string[]).length} silent items for ${config.seconds} seconds` : code === 'battle' ? `Gold vs. Black — ${config.seconds} seconds` : String(config.prize),
      interrupt: true,
      payload: { sessionId: s!.id, endsAt: s!.ends_at },
    })
    await notify(c, { t: 'game' })
    await notify(c, { t: 'item' })
    return { sessionId: s!.id, endsAt: s!.ends_at }
  })
}

/** Teams: bidders sorted by number and dealt alternately gold/black. Deterministic, balanced, and fixed for the event. */
async function assignTeams(c: pg.PoolClient, eventId: string, sessionId: string) {
  await c.query(
    `insert into room_teams (session_id, bidder_id, team)
     select $2, id, case when (row_number() over (order by bidder_number)) % 2 = 1 then 'gold' else 'black' end
       from bidders where event_id = $1 and not assisted`,
    [eventId, sessionId],
  )
}

/** Called inside every accepted-bid transaction. Idempotent per bid; a late registrant joins the smaller team. */
export async function scoreBid(c: pg.PoolClient, o: { eventId: string; kind: 'silent' | 'live'; bidId: string; bidderId: string; amountCents: number; previousCents: number | null; startingCents: number }) {
  const s = await one<{ id: string }>(`select id from room_event_sessions where event_id = $1 and code = 'battle' and status = 'active' and ends_at > clock_timestamp()`, [o.eventId], c)
  if (!s) return
  let t = await one<{ team: Team }>('select team from room_teams where session_id = $1 and bidder_id = $2', [s.id, o.bidderId], c)
  if (!t) {
    t = await one<{ team: Team }>(
      `insert into room_teams (session_id, bidder_id, team)
       select $1, $2, case when (select count(*) from room_teams where session_id = $1 and team = 'gold') <= (select count(*) from room_teams where session_id = $1 and team = 'black') then 'gold' else 'black' end
       on conflict do nothing returning team`,
      [s.id, o.bidderId],
      c,
    )
    t ??= await one<{ team: Team }>('select team from room_teams where session_id = $1 and bidder_id = $2', [s.id, o.bidderId], c)
  }
  const raise = Math.max(0, o.amountCents - (o.previousCents ?? o.startingCents))
  const points = 10 + Math.floor(raise / 1000)
  await c.query('insert into room_event_scores (session_id, bid_kind, bid_id, bidder_id, team, points) values ($1,$2,$3,$4,$5,$6) on conflict do nothing', [s.id, o.kind, o.bidId, o.bidderId, t!.team, points])
}

export async function battleScore(sessionId: string) {
  const r = await query<{ team: Team; points: number; bids: number }>(
    `select team, coalesce(sum(points), 0)::int points, count(*)::int bids from room_event_scores where session_id = $1 group by team`,
    [sessionId],
  )
  const teams = await query<{ team: Team; players: number }>('select team, count(*)::int players from room_teams where session_id = $1 group by team', [sessionId])
  const get = (t: Team) => ({ points: r.find((x) => x.team === t)?.points ?? 0, bids: r.find((x) => x.team === t)?.bids ?? 0, players: teams.find((x) => x.team === t)?.players ?? 0 })
  return { gold: get('gold'), black: get('black') }
}

// ───────────────────────── Mystery Jackpot ─────────────────────────

export async function drawJackpot(sessionId: string, adminId: string, redrawReason?: string) {
  return tx(async (c) => {
    const s = await one<{ id: string; event_id: string; code: string; status: string; config: Record<string, any> }>('select * from room_event_sessions where id = $1 for update', [sessionId], c)
    if (!s || s.code !== 'jackpot') throw new AppError('NOT_FOUND', 'No such jackpot.', 404)
    if (s.status !== 'active') throw new AppError('NOT_ACTIVE', 'This jackpot is over.', 409)
    const prev = await one<{ id: string }>('select id from jackpot_draws where session_id = $1 order by created_at desc limit 1', [s.id], c)
    if (prev && !redrawReason?.trim()) throw new AppError('REASON_REQUIRED', 'A redraw needs a reason (for example “winner not present”).')
    // One entry per registered attendee; earlier winners of this jackpot are excluded from a redraw.
    const entries = await query<{ id: string; bidder_number: number }>(
      `select id, bidder_number from bidders b where event_id = $1
          and not exists (select 1 from jackpot_draws d where d.session_id = $2 and d.winner_bidder_id = b.id)
        order by bidder_number`,
      [s.event_id, s.id],
      c,
    )
    if (!entries.length) throw new AppError('NO_ENTRIES', 'There is nobody left to draw.', 409)
    const idx = randomInt(0, entries.length) // unbiased (rejection sampling inside randomInt)
    const w = entries[idx]
    const d = await one<{ id: string }>(
      `insert into jackpot_draws (session_id, prize, entries, entry_count, winner_bidder_id, winner_index, redraw_of, reason, drawn_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [s.id, String(s.config.prize ?? 'Mystery prize'), JSON.stringify(entries.map((e) => e.bidder_number)), entries.length, w.id, idx, prev?.id ?? null, redrawReason?.trim() || null, adminId],
      c,
    )
    await audit({ eventId: s.event_id, actorType: 'admin', actorId: adminId, action: prev ? 'room.jackpot.redraw' : 'room.jackpot.draw', entityType: 'room_event', entityId: s.id, details: { drawId: d!.id, winnerNumber: w.bidder_number, entries: entries.length, reason: redrawReason ?? null } }, c)
    await announce(c, { eventId: s.event_id, kind: 'room.jackpot.winner', headline: `MYSTERY JACKPOT! Bidder #${w.bidder_number} wins ${s.config.prize ?? 'the prize'}!`, interrupt: true, payload: { drawId: d!.id, winnerNumber: w.bidder_number, entries: entries.length, prize: s.config.prize ?? null } })
    return { drawId: d!.id, winnerNumber: w.bidder_number, entries: entries.length }
  })
}

// ───────────────────────── ending ─────────────────────────

export async function endRoomEvent(sessionId: string, adminId: string | null, why: 'time' | 'manual' | 'cancelled' = 'manual') {
  return tx(async (c) => {
    const s = await one<{ id: string; event_id: string; code: RoomCode; status: string; config: Record<string, any> }>('select * from room_event_sessions where id = $1 for update', [sessionId], c)
    if (!s || s.status !== 'active') return false
    let result: Record<string, unknown> = {}
    let headline = ''
    if (s.code === 'battle') {
      const sc = await battleScore(s.id)
      const winner = sc.gold.points === sc.black.points ? 'tie' : sc.gold.points > sc.black.points ? 'gold' : 'black'
      result = { ...sc, winner, reward: s.config.reward ?? null }
      headline = winner === 'tie' ? `BATTLE OVER — a TIE! ${sc.gold.points} to ${sc.black.points}` : `BATTLE OVER — Team ${winner === 'gold' ? 'GOLD' : 'BLACK'} wins ${Math.max(sc.gold.points, sc.black.points)} to ${Math.min(sc.gold.points, sc.black.points)}!`
    } else if (s.code === 'lightning') {
      const n = await one<{ n: number }>(
        `select count(*)::int n from silent_bids b where b.item_id = any($1::uuid[]) and b.created_at >= (select starts_at from room_event_sessions where id = $2)`,
        [s.config.itemIds ?? [], s.id],
        c,
      )
      result = { bids: n!.n }
      headline = `LIGHTNING ROUND OVER — ${n!.n} bids in ${s.config.seconds} seconds!`
    } else {
      const d = await one<{ winner_number: number }>('select b.bidder_number as winner_number from jackpot_draws d join bidders b on b.id = d.winner_bidder_id where d.session_id = $1 order by d.created_at desc limit 1', [s.id], c)
      result = { winnerNumber: d?.winner_number ?? null }
      headline = 'MYSTERY JACKPOT COMPLETE'
    }
    await c.query(`update room_event_sessions set status = $2, result = $3, ends_at = coalesce(least(ends_at, clock_timestamp()), clock_timestamp()) where id = $1`, [s.id, why === 'cancelled' ? 'cancelled' : 'ended', JSON.stringify(result)])
    await audit({ eventId: s.event_id, actorType: adminId ? 'admin' : 'system', actorId: adminId, action: `room.${s.code}.end`, entityType: 'room_event', entityId: s.id, details: { why, ...result } }, c)
    if (why !== 'cancelled') await announce(c, { eventId: s.event_id, kind: `room.${s.code}.end`, headline, interrupt: true, payload: { sessionId: s.id, ...result } })
    await notify(c, { t: 'game' })
    await notify(c, { t: 'item' })
    return true
  })
}

/** Ends any timed Room Event whose time is up. Called from the tick. */
export async function advanceRooms(eventId: string) {
  const due = await query<{ id: string }>(`select id from room_event_sessions where event_id = $1 and status = 'active' and ends_at is not null and ends_at <= clock_timestamp()`, [eventId])
  for (const d of due) await endRoomEvent(d.id, null, 'time')
  return due.length
}
