/**
 * Power-Ups. Purchases (cash taken at the desk) and activations (use on an item) are separate records.
 * Inventory is never stored as a counter: it is  purchased (not voided)  −  activations,  so it cannot drift.
 * An activation runs in ONE transaction that holds the item lock and the bidder's row lock, validates every rule
 * on the server clock, applies the effect, and records the use. If anything fails nothing is consumed.
 */
import type pg from 'pg'
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { notify } from './realtime'
import { announce } from './announce'
import { formatCents } from './money'
import { appendAcceptedBid, assertRunning, lockItem, minNextBid, type ItemLock } from './bidding'
import { closeToProvisional, transition } from './lifecycle'

export type PowerUpDef = {
  code: string
  name: string
  description: string
  icon: string
  price_cents: number
  enabled: boolean
  kinds: ('silent' | 'live')[]
  max_per_bidder_item: number | null
  max_per_item: number | null
  max_per_bidder: number | null
  config: Record<string, number>
  sort: number
  category: 'powerup' | 'pie'
}

export const PAY_METHODS = ['cash', 'check', 'card_terminal', 'comp'] as const

export async function listDefs(): Promise<PowerUpDef[]> {
  return query<PowerUpDef>('select * from powerup_defs order by sort')
}

async function getDef(c: pg.PoolClient | undefined, code: string) {
  const d = await one<PowerUpDef>('select * from powerup_defs where code = $1', [code], c)
  if (!d) throw new AppError('POWERUP_NOT_FOUND', 'Unknown Power-Up.', 404)
  return d
}

// ───────────────────────── admin: definitions ─────────────────────────

export async function updateDef(code: string, p: Partial<{ price_cents: number; enabled: boolean; kinds: string[]; max_per_bidder_item: number | null; max_per_item: number | null; max_per_bidder: number | null; seconds: number }>, adminId: string) {
  return tx(async (c) => {
    const d = await getDef(c, code)
    if (p.price_cents != null && (!Number.isInteger(p.price_cents) || p.price_cents < 0 || p.price_cents > 100_000)) throw new AppError('INVALID_REQUEST', 'Price must be between $0 and $1,000.')
    const next = {
      price_cents: p.price_cents ?? d.price_cents,
      enabled: p.enabled ?? d.enabled,
      kinds: p.kinds ?? d.kinds,
      max_per_bidder_item: p.max_per_bidder_item === undefined ? d.max_per_bidder_item : p.max_per_bidder_item,
      max_per_item: p.max_per_item === undefined ? d.max_per_item : p.max_per_item,
      max_per_bidder: p.max_per_bidder === undefined ? d.max_per_bidder : p.max_per_bidder,
      config: p.seconds != null ? { ...d.config, seconds: p.seconds } : d.config,
    }
    if (d.category === 'powerup' && (!next.kinds.length || next.kinds.some((k) => k !== 'silent' && k !== 'live'))) throw new AppError('INVALID_REQUEST', 'Choose silent, live, or both.')
    await c.query(
      `update powerup_defs set price_cents=$2, enabled=$3, kinds=$4, max_per_bidder_item=$5, max_per_item=$6, max_per_bidder=$7, config=$8 where code=$1`,
      [code, next.price_cents, next.enabled, next.kinds, next.max_per_bidder_item, next.max_per_item, next.max_per_bidder, JSON.stringify(next.config)],
    )
    await audit({ actorType: 'admin', actorId: adminId, action: 'powerup.def_changed', entityType: 'powerup', details: { code, before: d, after: next } }, c)
    await notify(c, { t: 'game' })
  })
}

// ───────────────────────── inventory & purchases ─────────────────────────

export type InvRow = { code: string; name: string; icon: string; purchased: number; used: number; available: number }

export async function inventory(bidderId: string, db?: pg.PoolClient): Promise<InvRow[]> {
  return query<InvRow>(
    `select d.code, d.name, d.icon,
            coalesce((select sum(p.quantity) from powerup_purchases p where p.bidder_id = $1 and p.powerup_code = d.code and p.voided_at is null), 0)::int as purchased,
            ((select count(*) from powerup_activations a where a.bidder_id = $1 and a.powerup_code = d.code) + (select count(*) from pie_throws t where t.bidder_id = $1 and t.powerup_code = d.code))::int as used,
            (coalesce((select sum(p.quantity) from powerup_purchases p where p.bidder_id = $1 and p.powerup_code = d.code and p.voided_at is null), 0)
              - (select count(*) from powerup_activations a where a.bidder_id = $1 and a.powerup_code = d.code)
              - (select count(*) from pie_throws t where t.bidder_id = $1 and t.powerup_code = d.code))::int as available
       from powerup_defs d order by d.sort`,
    [bidderId],
    db,
  )
}

/** A volunteer records a Power-Up sale at the desk. The guest sees it immediately. */
export async function recordPurchase(i: { bidderId: string; code: string; quantity: number; method: string; reference?: string; adminId: string; idempotencyKey: string }) {
  if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 20) throw new AppError('INVALID_REQUEST', 'Quantity must be 1–20.')
  if (!(PAY_METHODS as readonly string[]).includes(i.method)) throw new AppError('INVALID_REQUEST', 'Choose cash, check, card terminal, or complimentary.')
  if (!i.idempotencyKey || i.idempotencyKey.length > 100) throw new AppError('INVALID_REQUEST', 'Missing request id.')
  return tx(async (c) => {
    const prior = await one<{ id: string }>('select id from powerup_purchases where received_by_admin_id = $1 and idempotency_key = $2', [i.adminId, i.idempotencyKey], c)
    if (prior) return { replay: true, id: prior.id }
    const def = await getDef(c, i.code)
    if (!def.enabled) throw new AppError('POWERUP_DISABLED', `${def.name} is not for sale right now.`, 409)
    const b = await one<{ id: string; event_id: string; bidder_number: number }>('select id, event_id, bidder_number from bidders where id = $1 for update', [i.bidderId], c)
    if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
    if (def.max_per_bidder != null) {
      const inv = (await inventory(b.id, c)).find((r) => r.code === def.code)!
      if (inv.purchased + i.quantity > def.max_per_bidder) throw new AppError('LIMIT', `Each guest may buy at most ${def.max_per_bidder} ${def.name}.`, 409)
    }
    const total = i.method === 'comp' ? 0 : def.price_cents * i.quantity
    const row = await one<{ id: string }>(
      `insert into powerup_purchases (event_id, bidder_id, powerup_code, quantity, unit_price_cents, total_cents, method, reference, received_by_admin_id, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [b.event_id, b.id, def.code, i.quantity, def.price_cents, total, i.method, i.reference?.trim() || null, i.adminId, i.idempotencyKey],
      c,
    )
    await audit({ eventId: b.event_id, actorType: 'admin', actorId: i.adminId, action: 'powerup.purchased', entityType: 'bidder', entityId: b.id, details: { code: def.code, quantity: i.quantity, totalCents: total, method: i.method } }, c)
    await notify(c, { t: 'bidder', id: b.id })
    return { replay: false, id: row!.id, totalCents: total }
  })
}

/** Corrects an erroneous sale. Refused if the guest has already used units the sale paid for. */
export async function voidPurchase(purchaseId: string, adminId: string, reason: string) {
  if (!reason.trim()) throw new AppError('REASON_REQUIRED', 'Please give a reason.')
  return tx(async (c) => {
    const p = await one<{ id: string; bidder_id: string; event_id: string; powerup_code: string; quantity: number; voided_at: Date | null }>('select * from powerup_purchases where id = $1 for update', [purchaseId], c)
    if (!p) throw new AppError('NOT_FOUND', 'Purchase not found.', 404)
    if (p.voided_at) throw new AppError('ALREADY_VOIDED', 'This purchase was already voided.', 409)
    await c.query('select 1 from bidders where id = $1 for update', [p.bidder_id])
    const inv = (await inventory(p.bidder_id, c)).find((r) => r.code === p.powerup_code)!
    if (inv.available < p.quantity) throw new AppError('ALREADY_USED', 'The guest has already used some of these Power-Ups, so this sale can’t be voided. Record a correction instead.', 409)
    await c.query('update powerup_purchases set voided_at = now(), voided_by_admin_id = $2, void_reason = $3 where id = $1', [p.id, adminId, reason.trim()])
    await audit({ eventId: p.event_id, actorType: 'admin', actorId: adminId, action: 'powerup.purchase_voided', entityType: 'bidder', entityId: p.bidder_id, details: { purchaseId: p.id, reason } }, c)
    await notify(c, { t: 'bidder', id: p.bidder_id })
  })
}

/** Power-Up money, reported on its own so it is never mixed with winning bids. */
export async function powerupRevenue(eventId: string) {
  const r = await one<{ total: number; units: number; cash: number; check: number; card: number; comp_units: number }>(
    `select coalesce(sum(p.total_cents), 0)::int total, coalesce(sum(p.quantity), 0)::int units,
            coalesce(sum(p.total_cents) filter (where p.method = 'cash'), 0)::int cash,
            coalesce(sum(p.total_cents) filter (where p.method = 'check'), 0)::int "check",
            coalesce(sum(p.total_cents) filter (where p.method = 'card_terminal'), 0)::int card,
            coalesce(sum(p.quantity) filter (where p.method = 'comp'), 0)::int comp_units
       from powerup_purchases p join powerup_defs d on d.code = p.powerup_code and d.category = 'powerup'
      where p.event_id = $1 and p.voided_at is null`,
    [eventId],
  )
  return { totalCents: r!.total, units: r!.units, cashCents: r!.cash, checkCents: r!.check, cardCents: r!.card, complimentaryUnits: r!.comp_units }
}

// ───────────────────────── activation ─────────────────────────

export type Activation = {
  bidderId: string
  itemId: string
  code: string
  idempotencyKey: string
  /** Block target (bidder number). */
  targetNumber?: number
  /** Challenge Flag: the qualifying bid that must succeed together with the activation. */
  amountCents?: number
}

type Plan = { targetId?: string; effect: string; seconds?: number; headline: string; interrupt: string; apply: () => Promise<Record<string, unknown>> }

const secsLeft = (until: Date | null, now: Date) => (until ? Math.floor((until.getTime() - now.getTime()) / 1000) : 0)

/**
 * Validates one Power-Up against the locked item and returns what it WILL do. Used verbatim by both the preview and
 * the real activation, so the screen a guest confirms can never differ from what the server enforces.
 */
async function plan(c: pg.PoolClient, item: ItemLock, def: PowerUpDef, a: Activation, bidder: { id: string; bidder_number: number }): Promise<Plan> {
  if (def.category === 'pie') throw new AppError('NOT_ELIGIBLE', 'Pie sign-ups are used at the finale — the hosts will call you up.', 409)
  if (!item.game_mode) throw new AppError('GAME_OFF', 'Power-Ups are not switched on for this event.', 409)
  assertRunning(item)
  if (!def.enabled) throw new AppError('POWERUP_DISABLED', `${def.name} is not available right now.`, 409)
  if (!def.kinds.includes(item.kind)) throw new AppError('NOT_ELIGIBLE', `${def.name} can’t be used on ${item.kind} auction items.`, 409)
  if (item.status === 'finalized' || item.status === 'cancelled' || item.status === 'draft') throw new AppError('NOT_ELIGIBLE', 'This auction is over.', 409)

  const used = await one<{ item_total: number; mine: number }>(
    `select count(*)::int item_total, count(*) filter (where bidder_id = $3)::int mine from powerup_activations where item_id = $1 and powerup_code = $2`,
    [item.id, def.code, bidder.id],
    c,
  )
  if (def.max_per_item != null && used!.item_total >= def.max_per_item) throw new AppError('LIMIT', `${def.name} has already been used the maximum number of times on this item.`, 409)
  if (def.max_per_bidder_item != null && used!.mine >= def.max_per_bidder_item) throw new AppError('LIMIT', `You have already used ${def.name} on this item.`, 409)

  const ev = await one<{ min_reopen_seconds: number; live_warning_seconds: number }>('select min_reopen_seconds, live_warning_seconds from events where id = $1', [item.event_id], c)
  const now = item.db_now

  switch (def.code) {
    case 'resurrection': {
      if (item.status !== 'provisional') throw new AppError('NOT_ELIGIBLE', 'Resurrection works only while an item is in its last-chance window.', 409)
      const done = await one('select 1 from auction_items where id = $1 and reopened_at is not null', [item.id], c)
      if (done) throw new AppError('LIMIT', 'This item has already been reopened once.', 409)
      const remaining = secsLeft(item.provisional_until, now)
      const want = def.config.seconds ?? 60
      if (remaining < ev!.min_reopen_seconds) throw new AppError('TOO_LATE', `Only ${Math.max(remaining, 0)} seconds are left in the window — too little to reopen fairly.`, 409)
      const seconds = Math.min(want, remaining)
      return {
        seconds,
        effect: `Reopens this auction for ${seconds} seconds${seconds < want ? ` (the last-chance window only has ${remaining} seconds left, so that is all there is)` : ''}. Bidding resumes from ${formatCents(item.current_bid_cents)}. Everyone can bid — it does not make you the winner.`,
        headline: 'RESURRECTION! THIS AUCTION IS BACK!',
        interrupt: 'resurrection',
        apply: async () => {
          await transition(c, item, 'reopened', { reason: 'Resurrection', actor: { type: 'bidder', id: bidder.id }, set: { timer_phase: 'reopen', deadline_at: new Date(now.getTime() + seconds * 1000), reopened_at: now } })
          return { seconds }
        },
      }
    }
    case 'final_call': {
      if (item.status !== 'open') throw new AppError('NOT_ELIGIBLE', 'Final Call works only on an auction that is still running.', 409)
      const seconds = def.config.seconds ?? 30
      const isLive = item.kind === 'live'
      if (isLive && (!item.timed || !item.deadline_at)) throw new AppError('NOT_ELIGIBLE', 'This item has no running timer.', 409)
      return {
        seconds,
        effect: `Adds ${seconds} seconds to this auction’s timer.`,
        headline: `FINAL CALL! +${seconds} SECONDS!`,
        interrupt: 'final_call',
        apply: async () => {
          if (isLive) await c.query('update auction_items set deadline_at = deadline_at + make_interval(secs => $2), updated_at = now() where id = $1', [item.id, seconds])
          else await c.query(`update auction_items i set closes_at = coalesce(i.closes_at, e.silent_close_at) + make_interval(secs => $2), updated_at = now() from events e where e.id = i.event_id and i.id = $1`, [item.id, seconds])
          return { seconds }
        },
      }
    }
    case 'knockout': {
      if (item.status !== 'open') throw new AppError('NOT_ELIGIBLE', 'The Knockout works only while bidding is open.', 409)
      const minQ = (await one<{ m: number | null }>('select min_qualifying_bid_cents m from auction_items where id = $1', [item.id], c))!.m
      if (minQ == null) throw new AppError('NOT_ELIGIBLE', 'The Knockout isn’t enabled for this item.', 409)
      if (item.current_bid_cents == null || item.current_bid_cents < minQ) throw new AppError('NOT_ELIGIBLE', `The Knockout unlocks once the bid reaches ${formatCents(minQ)}. It is ${formatCents(item.current_bid_cents)} now.`, 409)
      const closing = item.kind === 'live' ? item.timer_phase !== 'initial' : item.effective_close != null && (item.effective_close.getTime() - now.getTime()) / 1000 <= (ev!.live_warning_seconds)
      if (closing) throw new AppError('TOO_LATE', 'It’s too late for the Knockout — the final countdown has begun.', 409)
      const leader = await one<{ n: number }>('select bidder_number n from bidders where id = $1', [item.current_bidder_id], c)
      return {
        effect: `Ends bidding right now. Bidder #${leader?.n} becomes the provisional winner at ${formatCents(item.current_bid_cents)}, and the 5-minute last-chance window begins — others can still fight back with a Resurrection.`,
        headline: 'KNOCKOUT! BIDDING CLOSED!',
        interrupt: 'knockout',
        apply: async () => {
          await closeToProvisional(c, item.id, 'Knockout', { type: 'bidder', id: bidder.id })
          return {}
        },
      }
    }
    case 'challenge_flag': {
      if (item.kind !== 'live') throw new AppError('NOT_ELIGIBLE', 'The Challenge Flag is for live auction items.', 409)
      if (item.status !== 'provisional') throw new AppError('NOT_ELIGIBLE', 'The Challenge Flag works only during the last-chance window.', 409)
      if (!Number.isInteger(a.amountCents) || (a.amountCents as number) <= 0) throw new AppError('BID_REQUIRED', 'A Challenge Flag needs your challenging bid.', 422)
      if (item.current_bidder_id === bidder.id) throw new AppError('ALREADY_LEADING', 'You already have the highest bid.', 409)
      const minNext = minNextBid(item)
      if ((a.amountCents as number) < minNext) throw new AppError('TOO_LOW', `A challenge must bid at least ${formatCents(minNext)}.`, 422, { minNextCents: minNext })
      const remaining = secsLeft(item.provisional_until, now)
      if (remaining < ev!.min_reopen_seconds) throw new AppError('TOO_LATE', `Only ${Math.max(remaining, 0)} seconds are left in the window — too little for a challenge.`, 409)
      const seconds = Math.min(def.config.seconds ?? 20, remaining)
      return {
        seconds,
        effect: `Places your bid of ${formatCents(a.amountCents)} and opens a ${seconds}-second challenge for everyone. If your bid is refused, the Flag is not used.`,
        headline: 'CHALLENGE ACCEPTED!',
        interrupt: 'challenge_flag',
        apply: async () => {
          await transition(c, item, 'reopened', { reason: 'Challenge Flag', actor: { type: 'bidder', id: bidder.id }, set: { timer_phase: 'challenge', deadline_at: new Date(now.getTime() + seconds * 1000) } })
          await appendAcceptedBid(c, item, { bidderId: bidder.id, amountCents: a.amountCents as number, source: 'mobile', adminId: null })
          return { seconds, amountCents: a.amountCents }
        },
      }
    }
    case 'block': {
      if (item.kind !== 'live' || item.status !== 'open' || !item.timed) throw new AppError('NOT_ELIGIBLE', 'A Block can only be placed on a live item that is open for bidding.', 409)
      if (item.timer_phase !== 'initial') throw new AppError('TOO_LATE', 'Too late to Block — the final countdown has begun.', 409)
      const target = await one<{ id: string; bidder_number: number; assisted: boolean }>('select id, bidder_number, assisted from bidders where event_id = $1 and bidder_number = $2', [item.event_id, a.targetNumber ?? -1], c)
      if (!target) throw new AppError('BIDDER_NOT_FOUND', 'Enter the paddle number of the bidder to block.', 404)
      if (target.id === bidder.id) throw new AppError('NOT_ELIGIBLE', 'You can’t block yourself.', 409)
      if (target.assisted) throw new AppError('NOT_ELIGIBLE', 'That bidder is being helped by a volunteer and can’t be blocked.', 409)
      const dup = await one('select 1 from item_blocks where item_id = $1 and blocked_id = $2', [item.id, target.id], c)
      if (dup) throw new AppError('LIMIT', `Bidder #${target.bidder_number} has already been blocked on this item once.`, 409)
      const seconds = def.config.seconds ?? 30
      return {
        targetId: target.id,
        seconds,
        effect: `Bidder #${target.bidder_number} can’t bid on this item for ${seconds} seconds (unless they use a Back-In). Existing bids stay. The item’s timer is held open so they always get a chance to respond.`,
        headline: `BLOCKED! Bidder #${target.bidder_number} is locked out for ${seconds} seconds`,
        interrupt: 'block',
        apply: async () => {
          const ends = new Date(now.getTime() + seconds * 1000)
          await c.query('insert into item_blocks (item_id, blocker_id, blocked_id, ends_at) values ($1,$2,$3,$4)', [item.id, bidder.id, target.id, ends])
          // Fairness: the blocked bidder must still have the full response window after the block ends.
          await c.query('update auction_items set deadline_at = greatest(deadline_at, $2) where id = $1', [item.id, ends])
          return { seconds, targetNumber: target.bidder_number }
        },
      }
    }
    case 'back_in': {
      const blk = await one('select 1 from item_blocks where item_id = $1 and blocked_id = $2 and cleared_at is null and ends_at > clock_timestamp()', [item.id, bidder.id], c)
      if (!blk) throw new AppError('NOT_ELIGIBLE', 'You aren’t blocked on this item.', 409)
      return {
        effect: 'Lifts the Block on you immediately so you can bid.',
        headline: `BACK IN! Bidder #${bidder.bidder_number} is back in the game`,
        interrupt: 'back_in',
        apply: async () => {
          await c.query('update item_blocks set cleared_at = now() where item_id = $1 and blocked_id = $2 and cleared_at is null', [item.id, bidder.id])
          return {}
        },
      }
    }
    default:
      throw new AppError('POWERUP_NOT_FOUND', 'Unknown Power-Up.', 404)
  }
}

/** Read-only: what would happen, or why not. Nothing is consumed or changed. */
export async function previewPowerUp(a: Omit<Activation, 'idempotencyKey'>) {
  const def = await getDef(undefined, a.code)
  const c = await (await import('./db')).pool().connect()
  try {
    await c.query('begin')
    const item = await lockItem(c, a.itemId)
    const bidder = await one<{ id: string; bidder_number: number }>('select id, bidder_number from bidders where id = $1 and event_id = $2', [a.bidderId, item.event_id], c)
    if (!bidder) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
    const inv = (await inventory(bidder.id, c)).find((r) => r.code === def.code)!
    const p = await plan(c, item, def, { ...a, idempotencyKey: 'preview' }, bidder)
    return { ok: true as const, effect: p.effect, seconds: p.seconds ?? null, available: inv.available, headline: p.headline }
  } finally {
    await c.query('rollback').catch(() => {})
    c.release()
  }
}

export type ActivationResult = { replay: boolean; activationId: string; headline?: string; seconds?: number; amountCents?: number; targetNumber?: number }

export async function activatePowerUp(a: Activation): Promise<ActivationResult> {
  if (!a.idempotencyKey || a.idempotencyKey.length > 100) throw new AppError('INVALID_REQUEST', 'Missing request id.')
  return tx(async (c) => {
    const item = await lockItem(c, a.itemId) // item first, then bidder: one lock order everywhere
    const bidder = await one<{ id: string; bidder_number: number }>('select id, bidder_number from bidders where id = $1 and event_id = $2 for update', [a.bidderId, item.event_id], c)
    if (!bidder) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)

    const prior = await one<{ id: string; details: Record<string, unknown> }>('select id, details from powerup_activations where bidder_id = $1 and idempotency_key = $2', [bidder.id, a.idempotencyKey], c)
    if (prior) return { replay: true, activationId: prior.id, ...(prior.details as object) }

    const def = await getDef(c, a.code)
    const inv = (await inventory(bidder.id, c)).find((r) => r.code === def.code)!
    if (inv.available < 1) throw new AppError('NO_INVENTORY', `You don’t have a ${def.name}. Buy one at the bidding desk.`, 409)

    const p = await plan(c, item, def, a, bidder)
    const result = await p.apply()
    const act = await one<{ id: string }>(
      `insert into powerup_activations (event_id, item_id, bidder_id, powerup_code, target_bidder_id, idempotency_key, details)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [item.event_id, item.id, bidder.id, def.code, p.targetId ?? null, a.idempotencyKey, JSON.stringify({ ...result, headline: p.headline })],
      c,
    )
    await audit({ eventId: item.event_id, actorType: 'bidder', actorId: bidder.id, action: `powerup.${def.code}`, entityType: 'auction_item', entityId: item.id, details: { ...result, bidderNumber: bidder.bidder_number } }, c)
    await announce(c, { eventId: item.event_id, kind: `powerup.${def.code}`, itemId: item.id, headline: p.headline, body: `${item.title} — bidder #${bidder.bidder_number}`, payload: { code: def.code, bidderNumber: bidder.bidder_number, ...result }, interrupt: true })
    await notify(c, { t: 'item', id: item.id })
    await notify(c, { t: 'live', id: item.id })
    await notify(c, { t: 'bidder', id: bidder.id })
    return { replay: false, activationId: act!.id, headline: p.headline, ...result }
  })
}

/** Which of a guest's owned Power-Ups could be used on this item right now (for the portal's buttons). */
export async function eligibleFor(bidderId: string, itemId: string) {
  const defs = (await listDefs()).filter((d) => d.enabled && d.category === 'powerup')
  const out: { code: string; ok: boolean; reason?: string }[] = []
  for (const d of defs) {
    try {
      await previewPowerUp({ bidderId, itemId, code: d.code, targetNumber: undefined, amountCents: d.code === 'challenge_flag' ? 1_000_000 : undefined })
      out.push({ code: d.code, ok: true })
    } catch (e) {
      const err = e as { code?: string; message?: string }
      // BID_REQUIRED / target-needed errors still mean "usable, needs input"
      out.push({ code: d.code, ok: err.code === 'TOO_LOW' || err.code === 'BID_REQUIRED' || (d.code === 'block' && err.code === 'BIDDER_NOT_FOUND'), reason: err.message })
    }
  }
  return out
}
