/**
 * Bidding engine. Every mutation runs in ONE transaction that first takes a row lock on the
 * auction_items row (SELECT … FOR UPDATE). All bids/requests for an item are therefore serialised
 * by Postgres: two simultaneous bids can never both be validated against the same "current bid".
 * The client's idea of the current bid is only used to detect staleness — never trusted.
 */
import type pg from 'pg'
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { notify } from './realtime'
import { formatCents, MAX_BID_CENTS } from './money'
import { getEvent } from './events'
import { advance, closeToProvisional, recordWinner, resetCountdown, transition } from './lifecycle'
import { scoreBid } from './rooms'

export type ItemLock = {
  id: string
  event_id: string
  item_number: number
  kind: 'silent' | 'live'
  title: string
  status: 'draft' | 'upcoming' | 'open' | 'paused' | 'closed' | 'finalized' | 'provisional' | 'reopened' | 'cancelled'
  timed: boolean
  timer_phase: string | null
  deadline_at: Date | null
  provisional_until: Date | null
  game_mode: boolean
  auto_accept_live: boolean
  live_initial_seconds: number
  emergency_stop_at: Date | null
  lightning_increment_cents: number | null
  starting_bid_cents: number
  increment_cents: number
  current_bid_cents: number | null
  current_bidder_id: string | null
  bid_count: number
  db_now: Date
  silent_start_at: Date | null
  effective_close: Date | null
}

const LOCK_SQL = `select i.*, clock_timestamp() as db_now, e.silent_start_at, e.game_mode, e.auto_accept_live, e.live_initial_seconds, e.emergency_stop_at,
         (select (rs.config->>'incrementCents')::int from room_event_sessions rs
           where rs.event_id = i.event_id and rs.code = 'lightning' and rs.status = 'active' and rs.ends_at > clock_timestamp()
             and (rs.config->'itemIds') @> to_jsonb(i.id::text) limit 1) as lightning_increment_cents,
         case when i.status = 'reopened' then i.deadline_at else coalesce(i.closes_at, e.silent_close_at) end as effective_close
    from auction_items i join events e on e.id = i.event_id
   where i.id = $1`

/** Locks the item row, then performs any lifecycle transition that is already due, so every rule below sees current state. */
export async function lockItem(c: pg.PoolClient, itemId: string): Promise<ItemLock> {
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
  let item = await one<ItemLock>(LOCK_SQL + ' for update of i', [itemId], c)
  if (!item) throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
  if (await advance(c, itemId)) item = (await one<ItemLock>(LOCK_SQL, [itemId], c))!
  return item
}

export const biddable = (i: Pick<ItemLock, 'status'>) => i.status === 'open' || i.status === 'reopened'
export function assertRunning(i: Pick<ItemLock, 'emergency_stop_at'>) {
  if (i.emergency_stop_at) throw new AppError('HALTED', 'Bidding is paused for a moment. Please stand by.', 409)
}

export function minNextBid(i: Pick<ItemLock, 'current_bid_cents' | 'starting_bid_cents' | 'increment_cents'> & { lightning_increment_cents?: number | null }) {
  // During a Lightning Round the step is smaller; the current high bid is never lowered.
  const step = i.lightning_increment_cents ? Math.min(i.lightning_increment_cents, i.increment_cents) : i.increment_cents
  return i.current_bid_cents == null ? Math.max(i.starting_bid_cents, 100) : i.current_bid_cents + step
}

function checkAmount(amountCents: unknown): asserts amountCents is number {
  if (!Number.isInteger(amountCents) || (amountCents as number) <= 0) throw new AppError('INVALID_AMOUNT', 'Enter a valid bid amount.')
  if ((amountCents as number) > MAX_BID_CENTS) throw new AppError('AMOUNT_TOO_HIGH', `That bid is above ${formatCents(MAX_BID_CENTS)}. Please check the amount or ask a volunteer.`)
}

async function bidderInEvent(c: pg.PoolClient, bidderId: string, eventId: string) {
  const b = await one<{ id: string; bidder_number: number; name: string }>(
    'select id, bidder_number, name from bidders where id = $1 and event_id = $2',
    [bidderId, eventId],
    c,
  )
  if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
  return b
}

/** A bidder under an active Block (Power-Up) cannot bid on that item until it ends or they use Back-In. */
export async function assertNotBlocked(c: pg.PoolClient, itemId: string, bidderId: string) {
  const b = await one<{ ends_at: Date; blocker: number }>(
    `select k.ends_at, r.bidder_number as blocker from item_blocks k join bidders r on r.id = k.blocker_id
      where k.item_id = $1 and k.blocked_id = $2 and k.cleared_at is null and k.ends_at > clock_timestamp()`,
    [itemId, bidderId],
    c,
  )
  if (b) throw new AppError('BLOCKED', `Bidder #${b.blocker} used a Block on you for this item. You can bid again at ${b.ends_at.toISOString()}, or use a Back-In to bid right now.`, 409, { until: b.ends_at.toISOString() })
}

// ═════════════════════════ SILENT AUCTION ═════════════════════════

export type SilentBidInput = {
  bidderId: string
  itemId: string
  amountCents: number
  /** What the bidder's screen showed as the current high bid (null = no bids yet). Used only to detect staleness. */
  expectedCurrentCents: number | null
  idempotencyKey: string
  /** Set when a volunteer places the bid on a guest's behalf. */
  adminId?: string
}

export async function placeSilentBid(i: SilentBidInput) {
  checkAmount(i.amountCents)
  if (!i.idempotencyKey || i.idempotencyKey.length > 100) throw new AppError('INVALID_REQUEST', 'Missing request id.')

  return tx(async (c) => {
    const item = await lockItem(c, i.itemId)

    // Idempotent replay: the same submission (double tap, retry) returns the original result.
    const prior = await one<{ amount_cents: number }>(
      'select amount_cents from silent_bids where bidder_id = $1 and idempotency_key = $2',
      [i.bidderId, i.idempotencyKey],
      c,
    )
    if (prior) return { replay: true, amountCents: prior.amount_cents, currentCents: item.current_bid_cents, minNextCents: minNextBid(item) }

    if (item.kind !== 'silent') throw new AppError('WRONG_KIND', 'This is a live auction item — bid requests go to the clerk.')
    if (item.status === 'draft') throw new AppError('ITEM_NOT_FOUND', 'Item not found.', 404)
    assertRunning(item)
    if (item.status === 'upcoming') throw new AppError('NOT_STARTED', 'Bidding on this item hasn’t opened yet — it opens the night of the event.', 409)
    if (!biddable(item)) throw new AppError('CLOSED', 'Bidding on this item is closed.', 409)
    if (item.silent_start_at && item.db_now < item.silent_start_at) throw new AppError('NOT_STARTED', 'Bidding has not opened yet.', 409)
    if (item.effective_close && item.db_now >= item.effective_close) throw new AppError('CLOSED', 'Bidding on this item has closed.', 409)

    const bidder = await bidderInEvent(c, i.bidderId, item.event_id)

    if (item.current_bidder_id === bidder.id) throw new AppError('ALREADY_LEADING', 'You already have the highest bid on this item.', 409, { currentCents: item.current_bid_cents })

    const minNext = minNextBid(item)
    if ((i.expectedCurrentCents ?? null) !== item.current_bid_cents) {
      throw new AppError(
        'STALE',
        `The bid just changed to ${formatCents(item.current_bid_cents)}. The new minimum is ${formatCents(minNext)}.`,
        409,
        { currentCents: item.current_bid_cents, minNextCents: minNext },
      )
    }
    if (i.amountCents < minNext) {
      throw new AppError('TOO_LOW', `The minimum bid is ${formatCents(minNext)}.`, 422, { currentCents: item.current_bid_cents, minNextCents: minNext })
    }

    const sb = await one<{ id: string }>(
      'insert into silent_bids (item_id, bidder_id, amount_cents, placed_by_admin_id, idempotency_key) values ($1,$2,$3,$4,$5) returning id',
      [item.id, bidder.id, i.amountCents, i.adminId ?? null, i.idempotencyKey],
      c,
    )
    await scoreBid(c, { eventId: item.event_id, kind: 'silent', bidId: sb!.id, bidderId: bidder.id, amountCents: i.amountCents, previousCents: item.current_bid_cents, startingCents: item.starting_bid_cents })
    const upd = await one<ItemLock>(
      `update auction_items set current_bid_cents = $2, current_bidder_id = $3, bid_count = bid_count + 1, updated_at = now()
        where id = $1 returning *`,
      [item.id, i.amountCents, bidder.id],
      c,
    )
    if (i.adminId) {
      await audit({ eventId: item.event_id, actorType: 'admin', actorId: i.adminId, action: 'bid.assisted', entityType: 'auction_item', entityId: item.id, details: { bidderNumber: bidder.bidder_number, amountCents: i.amountCents } }, c)
    }
    await notify(c, { t: 'item', id: item.id })
    return { replay: false, amountCents: i.amountCents, currentCents: i.amountCents, minNextCents: minNextBid(upd!), bidderNumber: bidder.bidder_number }
  })
}

/** Silent items whose closing time passed (or that an admin closed) get their winner recorded. Idempotent. */
export async function finalizeDueSilentItems(adminId: string | null = null) {
  const ev = await getEvent()
  const due = await query<{ id: string }>(
    `select i.id from auction_items i join events e on e.id = i.event_id
      where i.event_id = $1 and i.kind = 'silent' and i.status in ('open', 'closed', 'provisional', 'reopened')
        and (i.status in ('closed', 'provisional', 'reopened') or coalesce(i.closes_at, e.silent_close_at) <= now())`,
    [ev.id],
  )
  let finalized = 0
  for (const { id } of due) {
    const done = await tx(async (c) => {
      const item = await lockItem(c, id)
      if (item.status === 'finalized') return false
      if (item.status !== 'open' && item.status !== 'closed') return false // still inside its last-chance window
      const stillDue = item.status === 'closed' || (item.effective_close != null && item.db_now >= item.effective_close)
      if (!stillDue) return false
      const top = await one<{ id: string; bidder_id: string; amount_cents: number }>(
        'select id, bidder_id, amount_cents from silent_bids where item_id = $1 order by amount_cents desc limit 1',
        [item.id],
        c,
      )
      if (top) await recordWinner(c, item, top.bidder_id, top.amount_cents, 'silent_bid', top.id, adminId)
      await c.query(`update auction_items set status = 'finalized', updated_at = now() where id = $1`, [item.id])
      await notify(c, { t: 'item', id: item.id })
      return true
    })
    if (done) finalized++
  }
  return finalized
}

/** Admin manually ends bidding on a silent item early. Winner is recorded immediately. */
export async function closeSilentItem(itemId: string, adminId: string) {
  await tx(async (c) => {
    const item = await lockItem(c, itemId)
    if (item.kind !== 'silent') throw new AppError('WRONG_KIND', 'Not a silent item.')
    if (item.status !== 'open') throw new AppError('NOT_OPEN', 'Bidding is not open on this item.', 409)
    await c.query(`update auction_items set status = 'closed', updated_at = now() where id = $1`, [item.id])
    await audit({ eventId: item.event_id, actorType: 'admin', actorId: adminId, action: 'item.closed', entityType: 'auction_item', entityId: item.id }, c)
    await notify(c, { t: 'item', id: item.id })
  })
  await finalizeDueSilentItems(adminId)
}

// ═════════════════════════ LIVE AUCTION ═════════════════════════

async function requireLive(item: ItemLock) {
  if (item.kind !== 'live') throw new AppError('WRONG_KIND', 'This is not a live auction item.')
}

export async function startLiveItem(itemId: string, adminId: string) {
  await tx(async (c) => {
    const item = await lockItem(c, itemId)
    await requireLive(item)
    if (item.status !== 'upcoming') throw new AppError('NOT_UPCOMING', 'Only an upcoming item can be brought to the block.', 409)
    assertRunning(item)
    try {
      // In game mode the item runs on the automated timer: an initial bidding period, then the inactivity countdown.
      const set = item.game_mode
        ? { timed: true, timer_phase: 'initial', deadline_at: new Date(item.db_now.getTime() + item.live_initial_seconds * 1000), started_at: item.db_now, halt_kind: null, pause_remaining_ms: null }
        : {}
      await transition(c, item, 'open', { reason: 'host started the item', actor: { type: 'admin', id: adminId }, set: set as never })
      if (item.game_mode) await c.query('update auction_items set timed = true where id = $1', [item.id])
    } catch (e: any) {
      if (e.code === '23505') throw new AppError('LIVE_ITEM_ACTIVE', 'Another live item is still on the block. Close it first.', 409)
      throw e
    }
    await audit({ eventId: item.event_id, actorType: 'admin', actorId: adminId, action: 'live.start', entityType: 'auction_item', entityId: item.id }, c)
    await notify(c, { t: 'live', id: item.id })
  })
}

export async function setLiveRunState(itemId: string, action: 'pause' | 'resume' | 'close', adminId: string, confirmed = false) {
  await tx(async (c) => {
    const item = await lockItem(c, itemId)
    await requireLive(item)
    if (action === 'pause') {
      if (item.status !== 'open') throw new AppError('BAD_STATE', 'Only an open item can be paused.', 409)
      // A routine pause freezes the effective countdown: the time left is stored and restored on resume.
      const remaining = item.timed && item.deadline_at ? Math.max(0, item.deadline_at.getTime() - item.db_now.getTime()) : null
      await transition(c, item, 'paused', { reason: 'host paused', actor: { type: 'admin', id: adminId }, set: { halt_kind: 'pause', pause_remaining_ms: remaining } })
    } else if (action === 'resume') {
      if (item.status !== 'paused') throw new AppError('BAD_STATE', 'Only a paused item can be resumed.', 409)
      assertRunning(item)
      const row = await one<{ pause_remaining_ms: number | null }>('select pause_remaining_ms from auction_items where id = $1', [item.id], c)
      const set = item.timed && row?.pause_remaining_ms != null ? { deadline_at: new Date(item.db_now.getTime() + row.pause_remaining_ms), pause_remaining_ms: null, halt_kind: null } : { halt_kind: null }
      await transition(c, item, 'open', { reason: 'host resumed', actor: { type: 'admin', id: adminId }, set })
    } else {
      if (!confirmed) throw new AppError('CONFIRM_REQUIRED', 'Closing an item requires confirmation.')
      if (item.status !== 'open' && item.status !== 'paused') throw new AppError('BAD_STATE', 'This item is not on the block.', 409)
      if (item.timed) {
        await closeToProvisional(c, item.id, 'host ended bidding', { type: 'admin', id: adminId })
      } else {
        await transition(c, item, 'closed', { reason: 'host closed the item', actor: { type: 'admin', id: adminId } })
        await c.query(
          `update live_bid_requests set status = 'expired', resolved_at = now(), resolution_note = 'item closed' where item_id = $1 and status = 'pending'`,
          [item.id],
        )
      }
    }
    await audit({ eventId: item.event_id, actorType: 'admin', actorId: adminId, action: `live.${action}`, entityType: 'auction_item', entityId: item.id }, c)
    await notify(c, { t: 'live', id: item.id })
  })
}

/** Guest asks (from their phone) for a bid to be taken. NOT an accepted bid. */
export async function requestLiveBid(i: { bidderId: string; itemId: string; amountCents: number; idempotencyKey: string }) {
  checkAmount(i.amountCents)
  if (!i.idempotencyKey || i.idempotencyKey.length > 100) throw new AppError('INVALID_REQUEST', 'Missing request id.')
  return tx(async (c) => {
    const item = await lockItem(c, i.itemId)
    const prior = await one<{ id: string; status: string }>(
      'select id, status from live_bid_requests where bidder_id = $1 and idempotency_key = $2',
      [i.bidderId, i.idempotencyKey],
      c,
    )
    if (prior) return { replay: true, requestId: prior.id, minNextCents: minNextBid(item) }

    await requireLive(item)
    if (item.status === 'paused') throw new AppError('PAUSED', 'The auctioneer has paused bidding for a moment.', 409)
    assertRunning(item)
    if (!biddable(item)) throw new AppError('NOT_OPEN', 'This item is not currently on the block.', 409)
    const bidder = await bidderInEvent(c, i.bidderId, item.event_id)
    if (item.current_bidder_id === bidder.id) throw new AppError('ALREADY_LEADING', 'You already have the highest bid.', 409)
    await assertNotBlocked(c, item.id, bidder.id)
    const minNext = minNextBid(item)
    if (i.amountCents < minNext) throw new AppError('TOO_LOW', `The next bid must be at least ${formatCents(minNext)}.`, 422, { currentCents: item.current_bid_cents, minNextCents: minNext })

    // A new request replaces this guest's older pending request for the same item.
    await c.query(
      `update live_bid_requests set status = 'superseded', resolved_at = now() where item_id = $1 and bidder_id = $2 and status = 'pending'`,
      [item.id, bidder.id],
    )
    const r = await one<{ id: string }>(
      'insert into live_bid_requests (item_id, bidder_id, amount_cents, idempotency_key) values ($1,$2,$3,$4) returning id',
      [item.id, bidder.id, i.amountCents, i.idempotencyKey],
      c,
    )
    if (item.auto_accept_live) {
      // Same acceptance engine as the clerk's paddle entry — just without a human in the loop.
      const bid = await appendAcceptedBid(c, item, { bidderId: bidder.id, amountCents: i.amountCents, source: 'mobile', requestId: r!.id, adminId: null })
      await c.query(`update live_bid_requests set status = 'accepted', resolved_at = now(), resolution_note = 'accepted automatically' where id = $1`, [r!.id])
      return { replay: false, requestId: r!.id, accepted: true, seq: bid.seq, minNextCents: i.amountCents + item.increment_cents }
    }
    await notify(c, { t: 'live', id: item.id })
    return { replay: false, requestId: r!.id, minNextCents: minNext }
  })
}

export async function appendAcceptedBid(
  c: pg.PoolClient,
  item: ItemLock,
  p: { bidderId: string; amountCents: number; source: 'paddle' | 'mobile'; requestId?: string; adminId: string | null },
) {
  await assertNotBlocked(c, item.id, p.bidderId)
  const seq = await one<{ n: number }>('select coalesce(max(seq), 0) + 1 as n from live_accepted_bids where item_id = $1', [item.id], c)
  const bid = await one<{ id: string; seq: number }>(
    `insert into live_accepted_bids (item_id, seq, bidder_id, amount_cents, source, request_id, entered_by_admin_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning id, seq`,
    [item.id, seq!.n, p.bidderId, p.amountCents, p.source, p.requestId ?? null, p.adminId],
    c,
  )
  await c.query(
    `update auction_items set current_bid_cents = $2, current_bidder_id = $3, bid_count = bid_count + 1, updated_at = now() where id = $1`,
    [item.id, p.amountCents, p.bidderId],
  )
  await scoreBid(c, { eventId: item.event_id, kind: 'live', bidId: bid!.id, bidderId: p.bidderId, amountCents: p.amountCents, previousCents: item.current_bid_cents, startingCents: item.starting_bid_cents })
  await resetCountdown(c, item.id) // a bid during the inactivity countdown restarts it
  // Any other pending request that is now at or below the accepted bid can no longer win.
  await c.query(
    `update live_bid_requests set status = 'expired', resolved_at = now(), resolution_note = 'outbid'
      where item_id = $1 and status = 'pending' and amount_cents <= $2 and id is distinct from $3`,
    [item.id, p.amountCents, p.requestId ?? null],
  )
  await notify(c, { t: 'live', id: item.id })
  return bid!
}

export function assertAcceptable(item: ItemLock, amountCents: number) {
  assertRunning(item)
  if (!biddable(item)) {
    throw new AppError(item.status === 'paused' ? 'PAUSED' : 'NOT_OPEN', item.status === 'paused' ? 'Bidding is paused — resume before taking bids.' : 'This item is not open for bids.', 409)
  }
  if (item.current_bid_cents == null) {
    if (amountCents < Math.max(item.starting_bid_cents, 100)) throw new AppError('TOO_LOW', `Opening bid must be at least ${formatCents(Math.max(item.starting_bid_cents, 100))}.`, 422, { currentCents: null, minNextCents: minNextBid(item) })
  } else if (amountCents <= item.current_bid_cents) {
    throw new AppError('OUT_OF_ORDER', `Current bid is already ${formatCents(item.current_bid_cents)}. A new bid must be higher.`, 409, { currentCents: item.current_bid_cents, minNextCents: minNextBid(item) })
  }
}

export async function recordPaddleBid(i: { itemId: string; paddleNumber: number; amountCents: number; adminId: string; idempotencyKey: string }) {
  checkAmount(i.amountCents)
  if (!Number.isInteger(i.paddleNumber)) throw new AppError('INVALID_PADDLE', 'Enter a paddle number.')
  return tx(async (c) => {
    const item = await lockItem(c, i.itemId)
    await requireLive(item)
    // Idempotency for paddle entry: an identical key means a double-tap, not a second bid.
    const dupe = await one<{ id: string }>(
      `select id from audit_logs where action = 'live.paddle_bid' and entity_id = $1 and details->>'key' = $2`,
      [item.id, i.idempotencyKey],
      c,
    )
    if (dupe) return { replay: true, currentCents: item.current_bid_cents, minNextCents: minNextBid(item) }
    assertAcceptable(item, i.amountCents)
    const bidder = await one<{ id: string; bidder_number: number; name: string }>(
      'select id, bidder_number, name from bidders where event_id = $1 and bidder_number = $2',
      [item.event_id, i.paddleNumber],
      c,
    )
    if (!bidder) throw new AppError('BIDDER_NOT_FOUND', `No bidder with paddle #${i.paddleNumber}.`, 404)
    const bid = await appendAcceptedBid(c, item, { bidderId: bidder.id, amountCents: i.amountCents, source: 'paddle', adminId: i.adminId })
    await audit({ eventId: item.event_id, actorType: 'admin', actorId: i.adminId, action: 'live.paddle_bid', entityType: 'auction_item', entityId: item.id, details: { key: i.idempotencyKey, seq: bid.seq, paddle: i.paddleNumber, amountCents: i.amountCents } }, c)
    return { replay: false, currentCents: i.amountCents, minNextCents: i.amountCents + item.increment_cents, bidderNumber: bidder.bidder_number, bidderName: bidder.name }
  })
}

export async function acceptLiveRequest(requestId: string, adminId: string) {
  const first = await one<{ item_id: string }>('select item_id from live_bid_requests where id = $1', [requestId])
  if (!first) throw new AppError('REQUEST_NOT_FOUND', 'Request not found.', 404)
  return tx(async (c) => {
    const item = await lockItem(c, first.item_id)
    const r = await one<{ id: string; bidder_id: string; amount_cents: number; status: string }>(
      'select id, bidder_id, amount_cents, status from live_bid_requests where id = $1 for update',
      [requestId],
      c,
    )
    if (!r) throw new AppError('REQUEST_NOT_FOUND', 'Request not found.', 404)
    if (r.status !== 'pending') throw new AppError('ALREADY_RESOLVED', `This request was already ${r.status}.`, 409)
    if (biddable(item) && item.current_bid_cents != null && r.amount_cents <= item.current_bid_cents) {
      await c.query(`update live_bid_requests set status = 'expired', resolved_at = now(), resolved_by_admin_id = $2, resolution_note = 'outbid' where id = $1`, [r.id, adminId])
      await c.query('commit')
      await c.query('begin')
      throw new AppError('OUT_OF_ORDER', `Too late — the bid is already ${formatCents(item.current_bid_cents)}.`, 409)
    }
    assertAcceptable(item, r.amount_cents)
    const bid = await appendAcceptedBid(c, item, { bidderId: r.bidder_id, amountCents: r.amount_cents, source: 'mobile', requestId: r.id, adminId })
    await c.query(`update live_bid_requests set status = 'accepted', resolved_at = now(), resolved_by_admin_id = $2 where id = $1`, [r.id, adminId])
    return { seq: bid.seq, amountCents: r.amount_cents }
  })
}

export async function rejectLiveRequest(requestId: string, adminId: string) {
  const first = await one<{ item_id: string }>('select item_id from live_bid_requests where id = $1', [requestId])
  if (!first) throw new AppError('REQUEST_NOT_FOUND', 'Request not found.', 404)
  return tx(async (c) => {
    const item = await lockItem(c, first.item_id)
    const r = await one<{ status: string }>('select status from live_bid_requests where id = $1 for update', [requestId], c)
    if (!r || r.status !== 'pending') throw new AppError('ALREADY_RESOLVED', `This request was already ${r?.status ?? 'resolved'}.`, 409)
    await c.query(`update live_bid_requests set status = 'rejected', resolved_at = now(), resolved_by_admin_id = $2 where id = $1`, [requestId, adminId])
    await notify(c, { t: 'live', id: item.id })
  })
}

/** Undo the most recent accepted live bid (clerk mistake). The original row stays; a void row records who/why. */
export async function voidLastLiveBid(itemId: string, adminId: string, reason: string) {
  if (!reason.trim()) throw new AppError('REASON_REQUIRED', 'Please give a reason.')
  return tx(async (c) => {
    const item = await lockItem(c, itemId)
    await requireLive(item)
    if (item.status !== 'open' && item.status !== 'paused') throw new AppError('BAD_STATE', 'Bids can only be undone while the item is on the block.', 409)
    const last = await one<{ id: string; amount_cents: number; seq: number }>(
      `select b.id, b.amount_cents, b.seq from live_accepted_bids b
        where b.item_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id)
        order by b.seq desc limit 1`,
      [item.id],
      c,
    )
    if (!last) throw new AppError('NOTHING_TO_UNDO', 'There are no bids to undo.', 409)
    await c.query('insert into live_bid_voids (accepted_bid_id, voided_by, reason) values ($1,$2,$3)', [last.id, adminId, reason.trim()])
    const prev = await one<{ bidder_id: string; amount_cents: number }>(
      `select b.bidder_id, b.amount_cents from live_accepted_bids b
        where b.item_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id)
        order by b.seq desc limit 1`,
      [item.id],
      c,
    )
    await c.query(
      `update auction_items set current_bid_cents = $2, current_bidder_id = $3, bid_count = bid_count - 1, updated_at = now() where id = $1`,
      [item.id, prev?.amount_cents ?? null, prev?.bidder_id ?? null],
    )
    await audit({ eventId: item.event_id, actorType: 'admin', actorId: adminId, action: 'live.bid_voided', entityType: 'auction_item', entityId: item.id, details: { seq: last.seq, amountCents: last.amount_cents, reason } }, c)
    await notify(c, { t: 'live', id: item.id })
  })
}

/** Records the winner of a closed live item. Requires explicit confirmation. */
export async function finalizeLiveItem(itemId: string, adminId: string, confirmed: boolean) {
  if (!confirmed) throw new AppError('CONFIRM_REQUIRED', 'Finalizing requires confirmation.')
  return tx(async (c) => {
    const item = await lockItem(c, itemId)
    await requireLive(item)
    if (item.status === 'finalized') throw new AppError('ALREADY_FINALIZED', 'This item is already finalized.', 409)
    if (item.status !== 'closed') throw new AppError('BAD_STATE', 'Close bidding on the item before finalizing it.', 409)
    const top = await one<{ id: string; bidder_id: string; amount_cents: number }>(
      `select b.id, b.bidder_id, b.amount_cents from live_accepted_bids b
        where b.item_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id)
        order by b.seq desc limit 1`,
      [item.id],
      c,
    )
    if (top) await recordWinner(c, item, top.bidder_id, top.amount_cents, 'live_bid', top.id, adminId)
    await c.query(`update auction_items set status = 'finalized', updated_at = now() where id = $1`, [item.id])
    await notify(c, { t: 'live', id: item.id })
    return top ? { sold: true, amountCents: top.amount_cents, bidderId: top.bidder_id } : { sold: false }
  })
}

/**
 * Admin-only. Reopens a closed/finalized item (either kind). The previous winning result is voided
 * (kept for history) and the reason is audited. Blocked if payments were already applied to that result.
 * Silent items reopen until `newCloseAt`; live items come back as paused.
 */
export async function reopenItem(itemId: string, adminId: string, reason: string, newCloseAt?: Date | null) {
  if (!reason.trim()) throw new AppError('REASON_REQUIRED', 'A reason is required to reopen an item.')
  return tx(async (c) => {
    const item = await lockItem(c, itemId)
    if (item.status !== 'closed' && item.status !== 'finalized') throw new AppError('BAD_STATE', 'Only a closed or finalized item can be reopened.', 409)
    const wr = await one<{ id: string }>('select id from winning_results where item_id = $1 and voided_at is null for update', [item.id], c)
    if (wr) {
      const paid = await one<{ n: number }>(
        `select count(*)::int n from payment_allocations a join payments p on p.id = a.payment_id
          where a.winning_result_id = $1 and p.voided_at is null`,
        [wr.id],
        c,
      )
      if (paid!.n > 0) throw new AppError('HAS_PAYMENTS', 'Payments have been recorded for this win. Void those payments in Checkout first.', 409)
      await c.query(`update winning_results set voided_at = now(), voided_by_admin_id = $2, void_reason = $3 where id = $1`, [wr.id, adminId, reason.trim()])
    }
    if (item.kind === 'silent') {
      if (!newCloseAt || newCloseAt.getTime() <= Date.now()) throw new AppError('INVALID_TIME', 'Choose a new closing time in the future.')
      await c.query(`update auction_items set status = 'open', closes_at = $2, updated_at = now() where id = $1`, [item.id, newCloseAt])
    } else {
      try {
        await c.query(`update auction_items set status = 'paused', updated_at = now() where id = $1`, [item.id])
      } catch (e: any) {
        if (e.code === '23505') throw new AppError('LIVE_ITEM_ACTIVE', 'Another live item is on the block. Close it first.', 409)
        throw e
      }
    }
    await audit({ eventId: item.event_id, actorType: 'admin', actorId: adminId, action: 'item.reopened', entityType: 'auction_item', entityId: item.id, details: { reason, voidedResult: wr?.id ?? null } }, c)
    await notify(c, { t: 'item', id: item.id })
    await notify(c, { t: 'live', id: item.id })
  })
}
