/**
 * Auction lifecycle: one validated transition table, server-clock deadlines, and an idempotent `advance()` that
 * performs whatever transitions are DUE. There is no background worker — `advance()` runs under the item's row lock
 * at the start of every bid / power-up / tick, and the projector + host console call /api/tick every couple of
 * seconds. Transitions are stamped with the DEADLINE that caused them, not the moment someone noticed, so late
 * noticing never moves a deadline.
 */
import type pg from 'pg'
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { notify } from './realtime'
import { announce } from './announce'
import { formatCents } from './money'

export type Status = 'draft' | 'upcoming' | 'open' | 'paused' | 'closed' | 'finalized' | 'provisional' | 'reopened' | 'cancelled'

/** The only legal status changes. Anything else is a bug and throws. */
export const ALLOWED: Record<Status, Status[]> = {
  draft: ['upcoming', 'open', 'cancelled'],
  upcoming: ['draft', 'open', 'cancelled'],
  open: ['paused', 'provisional', 'closed', 'cancelled'],
  paused: ['open', 'provisional', 'closed', 'cancelled'],
  provisional: ['reopened', 'finalized', 'cancelled'],
  reopened: ['provisional', 'finalized', 'cancelled'],
  closed: ['finalized', 'open', 'paused'],
  finalized: ['open', 'paused'], // administrator reopen (voids the result)
  cancelled: ['draft'],
}

type Cols = Partial<{
  timer_phase: string | null
  deadline_at: Date | null
  provisional_until: Date | null
  pause_remaining_ms: number | null
  halt_kind: string | null
  reopened_at: Date | null
  closes_at: Date | null
  started_at: Date | null
}>

export type Actor = { type: 'admin' | 'bidder' | 'system'; id?: string | null }

/** Changes an item's status through the transition table and logs it. The item row must already be locked. */
export async function transition(
  c: pg.PoolClient,
  item: { id: string; event_id: string; status: string },
  to: Status,
  o: { reason: string; actor?: Actor; details?: Record<string, unknown>; set?: Cols },
) {
  const from = item.status as Status
  if (!ALLOWED[from]?.includes(to)) throw new AppError('BAD_TRANSITION', `An item cannot go from ${from} to ${to}.`, 409)
  const sets = ['status = $2', 'updated_at = now()']
  const params: unknown[] = [item.id, to]
  for (const [k, v] of Object.entries(o.set ?? {})) {
    params.push(v)
    sets.push(`${k} = $${params.length}`)
  }
  await c.query(`update auction_items set ${sets.join(', ')} where id = $1`, params)
  const actor = o.actor ?? { type: 'system' as const }
  await c.query(
    'insert into item_transitions (item_id, from_status, to_status, reason, actor_type, actor_id, details) values ($1,$2,$3,$4,$5,$6,$7)',
    [item.id, from, to, o.reason, actor.type, actor.id ?? null, JSON.stringify(o.details ?? {})],
  )
  item.status = to
}

type Row = {
  id: string
  event_id: string
  kind: 'silent' | 'live'
  title: string
  item_number: number
  status: Status
  timed: boolean
  timer_phase: string | null
  deadline_at: Date | null
  provisional_until: Date | null
  started_at: Date | null
  closes_at: Date | null
  silent_close_at: Date | null
  current_bid_cents: number | null
  provisional_silent: boolean
  provisional_seconds: number
  live_inactivity_seconds: number
  live_max_seconds: number | null
  emergency_stop_at: Date | null
  db_now: Date
}

const ROW_SQL = `select i.id, i.event_id, i.kind, i.title, i.item_number, i.status, i.timed, i.timer_phase, i.deadline_at, i.provisional_until,
         i.started_at, i.closes_at, i.current_bid_cents, e.silent_close_at, e.provisional_silent, e.provisional_seconds,
         e.live_inactivity_seconds, e.live_max_seconds, e.emergency_stop_at, clock_timestamp() as db_now
    from auction_items i join events e on e.id = i.event_id where i.id = $1`

const plus = (d: Date, secs: number) => new Date(d.getTime() + secs * 1000)

/** Moves a locked item through every transition that is due. Idempotent; returns true if anything changed. */
export async function advance(c: pg.PoolClient, itemId: string): Promise<boolean> {
  let moved = false
  for (let guard = 0; guard < 8; guard++) {
    const r = await one<Row>(ROW_SQL, [itemId], c)
    if (!r || r.emergency_stop_at) break // an emergency stop freezes every clock
    const now = r.db_now
    const cap = r.live_max_seconds != null && r.started_at ? plus(r.started_at, r.live_max_seconds) : null

    if (r.status === 'open' && r.timed && r.deadline_at && r.deadline_at <= now) {
      if (r.timer_phase === 'initial' && !(cap && r.deadline_at >= cap)) {
        const next = plus(r.deadline_at, r.live_inactivity_seconds)
        await c.query(`update auction_items set timer_phase = 'countdown', deadline_at = $2, updated_at = now() where id = $1`, [r.id, cap && cap < next ? cap : next])
      } else {
        await toProvisional(c, r, r.deadline_at, cap && r.deadline_at >= cap ? 'maximum duration reached' : 'bidding timer ended')
      }
    } else if (r.status === 'open' && !r.timed && r.kind === 'silent' && r.provisional_silent && (r.closes_at ?? r.silent_close_at) && (r.closes_at ?? r.silent_close_at)! <= now) {
      await toProvisional(c, r, (r.closes_at ?? r.silent_close_at)!, 'silent closing time reached')
    } else if (r.status === 'reopened' && r.deadline_at && r.deadline_at <= now) {
      await transition(c, r, 'provisional', { reason: 'reopened window ended', set: { timer_phase: null, deadline_at: null } })
      await c.query(`update live_bid_requests set status = 'expired', resolved_at = now(), resolution_note = 'window ended' where item_id = $1 and status = 'pending'`, [r.id])
      await announce(c, { eventId: r.event_id, kind: 'item.provisional', itemId: r.id, headline: `${r.title} — last chance window`, payload: { until: r.provisional_until } })
    } else if ((r.status === 'provisional' || r.status === 'reopened') && r.provisional_until && r.provisional_until <= now && !(r.status === 'reopened' && r.deadline_at && r.deadline_at > now)) {
      await finalizeLocked(c, r, { type: 'system' }, 'last-chance window ended')
    } else break
    moved = true
  }
  if (moved) await notify(c, { t: 'item', id: itemId })
  return moved
}

async function toProvisional(c: pg.PoolClient, r: Row, at: Date, reason: string, actor?: Actor) {
  const until = plus(at, r.provisional_seconds)
  await transition(c, r, 'provisional', { reason, actor, set: { provisional_until: until, timer_phase: null, deadline_at: null, pause_remaining_ms: null, halt_kind: null } })
  await c.query(`update live_bid_requests set status = 'expired', resolved_at = now(), resolution_note = 'bidding closed' where item_id = $1 and status = 'pending'`, [r.id])
  const lead = await one<{ number: number; amount: number | null }>(
    `select b.bidder_number as number, i.current_bid_cents as amount from auction_items i left join bidders b on b.id = i.current_bidder_id where i.id = $1`,
    [r.id],
    c,
  )
  await announce(c, {
    eventId: r.event_id,
    kind: 'item.provisional',
    itemId: r.id,
    headline: lead?.number ? `${r.title}: bidder #${lead.number} leads at ${formatCents(lead.amount)}` : `${r.title}: bidding closed`,
    payload: { until, leaderNumber: lead?.number ?? null, amountCents: lead?.amount ?? null },
  })
}

/** Provisional close, used by Knockout and the host's "end active bidding". */
export async function closeToProvisional(c: pg.PoolClient, itemId: string, reason: string, actor: Actor) {
  const r = await one<Row>(ROW_SQL, [itemId], c)
  if (!r) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
  if (r.status !== 'open' && r.status !== 'paused') throw new AppError('BAD_STATE', 'Bidding is not open on this item.', 409)
  await toProvisional(c, r, r.db_now, reason, actor)
  await notify(c, { t: 'item', id: itemId })
}

export async function recordWinner(
  c: pg.PoolClient,
  item: { id: string; event_id: string },
  bidderId: string,
  amountCents: number,
  source: 'silent_bid' | 'live_bid',
  sourceBidId: string,
  adminId: string | null,
) {
  const wr = await one<{ id: string }>(
    `insert into winning_results (item_id, bidder_id, amount_cents, source, source_bid_id, finalized_by_admin_id)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [item.id, bidderId, amountCents, source, sourceBidId, adminId],
    c,
  )
  await c.query('insert into item_collections (winning_result_id) values ($1)', [wr!.id])
  await audit({ eventId: item.event_id, actorType: adminId ? 'admin' : 'system', actorId: adminId, action: 'item.finalized', entityType: 'auction_item', entityId: item.id, details: { bidderId, amountCents, source } }, c)
}

/** Records the winner and finalizes. Safe to call twice: a finalized item is skipped. */
async function finalizeLocked(c: pg.PoolClient, r: Pick<Row, 'id' | 'event_id' | 'kind' | 'title' | 'status'>, actor: Actor, reason: string) {
  if (r.status === 'finalized') return
  const top =
    r.kind === 'silent'
      ? await one<{ id: string; bidder_id: string; amount_cents: number; num: number }>(
          `select s.id, s.bidder_id, s.amount_cents, b.bidder_number as num from silent_bids s join bidders b on b.id = s.bidder_id
            where s.item_id = $1 order by s.amount_cents desc limit 1`,
          [r.id],
          c,
        )
      : await one<{ id: string; bidder_id: string; amount_cents: number; num: number }>(
          `select a.id, a.bidder_id, a.amount_cents, b.bidder_number as num from live_accepted_bids a join bidders b on b.id = a.bidder_id
            where a.item_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = a.id)
            order by a.seq desc limit 1`,
          [r.id],
          c,
        )
  if (top) await recordWinner(c, r, top.bidder_id, top.amount_cents, r.kind === 'silent' ? 'silent_bid' : 'live_bid', top.id, actor.type === 'admin' ? actor.id ?? null : null)
  await transition(c, r, 'finalized', { reason, actor, details: { sold: !!top } })
  await announce(c, {
    eventId: r.event_id,
    kind: top ? 'item.sold' : 'item.unsold',
    itemId: r.id,
    interrupt: !!top && r.kind === 'live',
    headline: top ? `SOLD! ${r.title} — bidder #${top.num} — ${formatCents(top.amount_cents)}` : `${r.title}: no bids`,
    payload: { bidderNumber: top?.num ?? null, amountCents: top?.amount_cents ?? null },
  })
}

/** Host / admin: end the last-chance window now and record the winner. */
export async function finalizeNow(itemId: string, adminId: string) {
  return tx(async (c) => {
    const r = await one<Row>(ROW_SQL + ' for update of i', [itemId], c)
    if (!r) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
    if (r.status === 'finalized') return { already: true }
    if (r.status !== 'provisional' && r.status !== 'reopened') throw new AppError('BAD_STATE', 'Only an item in its last-chance window can be finalized this way.', 409)
    await finalizeLocked(c, r, { type: 'admin', id: adminId }, 'finalized early by staff')
    await audit({ eventId: r.event_id, actorType: 'admin', actorId: adminId, action: 'item.finalize_now', entityType: 'auction_item', entityId: r.id }, c)
    await notify(c, { t: 'item', id: r.id })
    return { already: false }
  })
}

/** Called after every accepted bid: during the inactivity countdown a bid restarts it. */
export async function resetCountdown(c: pg.PoolClient, itemId: string) {
  await c.query(
    `update auction_items i set deadline_at = least(clock_timestamp() + make_interval(secs => e.live_inactivity_seconds),
                                                    coalesce(i.started_at + make_interval(secs => e.live_max_seconds), 'infinity'::timestamptz))
       from events e
      where e.id = i.event_id and i.id = $1 and i.timed and i.status = 'open' and i.timer_phase = 'countdown'`,
    [itemId],
  )
}

/** Host: add (or remove) seconds on a running live timer. */
export async function extendTimer(itemId: string, seconds: number, adminId: string) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new AppError('INVALID_REQUEST', 'Extend by 1–300 seconds.')
  await tx(async (c) => {
    const r = await one<Row>(ROW_SQL + ' for update of i', [itemId], c)
    if (!r) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
    await advance(c, itemId)
    const cur = await one<Row>(ROW_SQL, [itemId], c)
    if (!cur || cur.status !== 'open' || !cur.timed || !cur.deadline_at) throw new AppError('BAD_STATE', 'There is no running timer to extend.', 409)
    await c.query('update auction_items set deadline_at = deadline_at + make_interval(secs => $2), updated_at = now() where id = $1', [itemId, seconds])
    await audit({ eventId: r.event_id, actorType: 'admin', actorId: adminId, action: 'live.extend', entityType: 'auction_item', entityId: itemId, details: { seconds } }, c)
    await notify(c, { t: 'item', id: itemId })
  })
}

// ───────────────────────── emergency stop ─────────────────────────

/** Freezes bidding and every clock event-wide. Distinct from a routine pause of one item. */
export async function emergencyStop(eventId: string, adminId: string, reason: string) {
  if (!reason.trim()) throw new AppError('REASON_REQUIRED', 'Say why you are stopping the auction.')
  await tx(async (c) => {
    const e = await one<{ emergency_stop_at: Date | null }>('select emergency_stop_at from events where id = $1 for update', [eventId], c)
    if (e?.emergency_stop_at) throw new AppError('ALREADY_STOPPED', 'The auction is already stopped.', 409)
    // Settle anything already due first so the freeze is exact.
    for (const i of await query<{ id: string }>(`select id from auction_items where event_id = $1 and status in ('open','reopened','provisional')`, [eventId], c)) await advance(c, i.id)
    await c.query('update events set emergency_stop_at = clock_timestamp(), emergency_reason = $2 where id = $1', [eventId, reason.trim()])
    await audit({ eventId, actorType: 'admin', actorId: adminId, action: 'event.emergency_stop', details: { reason } }, c)
    await announce(c, { eventId, kind: 'event.emergency_stop', headline: 'PLEASE STAND BY — bidding is paused', body: reason.trim(), interrupt: true })
    await notify(c, { t: 'live' })
    await notify(c, { t: 'item' })
  })
}

/** Resumes after an emergency stop, pushing every running deadline back by the length of the stop. */
export async function emergencyRelease(eventId: string, adminId: string) {
  await tx(async (c) => {
    const e = await one<{ emergency_stop_at: Date | null; stopped_ms: number }>(
      `select emergency_stop_at, (extract(epoch from clock_timestamp() - emergency_stop_at) * 1000)::bigint as stopped_ms from events where id = $1 for update`,
      [eventId],
      c,
    )
    if (!e?.emergency_stop_at) throw new AppError('NOT_STOPPED', 'The auction is not stopped.', 409)
    const ms = Number(e.stopped_ms)
    await c.query(
      `update auction_items set deadline_at = deadline_at + make_interval(secs => $2 / 1000.0),
                                provisional_until = provisional_until + make_interval(secs => $2 / 1000.0)
        where event_id = $1 and status in ('open','reopened','provisional') and (deadline_at is not null or provisional_until is not null)`,
      [eventId, ms],
    )
    // Silent closing times are fixed clock times: move them by the same amount so nobody loses bidding time.
    await c.query(`update auction_items set closes_at = closes_at + make_interval(secs => $2 / 1000.0) where event_id = $1 and kind = 'silent' and closes_at is not null and status in ('open','reopened')`, [eventId, ms])
    await c.query(`update events set silent_close_at = silent_close_at + make_interval(secs => $2 / 1000.0), emergency_stop_at = null, emergency_reason = null where id = $1`, [eventId, ms])
    await audit({ eventId, actorType: 'admin', actorId: adminId, action: 'event.emergency_release', details: { stoppedMs: ms } }, c)
    await announce(c, { eventId, kind: 'event.resumed', headline: 'BIDDING RESUMES', interrupt: true })
    await notify(c, { t: 'live' })
    await notify(c, { t: 'item' })
  })
}

/** Everything the tick endpoint needs: advance every item that has a clock running. */
export async function advanceDue(eventId: string): Promise<number> {
  const ids = await query<{ id: string }>(
    `select i.id from auction_items i join events e on e.id = i.event_id
      where i.event_id = $1 and e.emergency_stop_at is null
        and ( (i.status = 'open' and ((i.timed and i.deadline_at <= clock_timestamp())
                                   or (e.provisional_silent and i.kind = 'silent' and coalesce(i.closes_at, e.silent_close_at) <= clock_timestamp())))
           or (i.status = 'reopened' and i.deadline_at <= clock_timestamp())
           or (i.status in ('provisional','reopened') and i.provisional_until <= clock_timestamp()) )`,
    [eventId],
  )
  let n = 0
  for (const { id } of ids) {
    const moved = await tx(async (c) => {
      await c.query('select 1 from auction_items where id = $1 for update', [id])
      return advance(c, id)
    })
    if (moved) n++
  }
  return n
}
