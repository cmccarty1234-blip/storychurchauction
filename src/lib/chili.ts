/**
 * Chili Cook-Off. $1 = 1 vote; the chili with the most dollars wins and every dollar goes to the fundraiser.
 * Votes are owed at checkout: a guest taps Vote on their phone, and a volunteer records the money at the desk
 * (kept separate from the item balance, so the item-payment code is untouched).
 */
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { notify } from './realtime'
import { formatCents } from './money'

export type ChiliState = 'off' | 'open' | 'closed'
export type ChiliEntry = { id: string; number: number; name: string; cook: string | null; cents: number; votes: number; voters: number; hearts: number }
export type ChiliBoard = { state: ChiliState; entries: ChiliEntry[]; totalCents: number }

const EMPTY: ChiliBoard = { state: 'off', entries: [], totalCents: 0 }

/** Entries with their totals, highest first. Safe to call before migration 0010 has been run. */
export async function chiliBoard(eventId: string): Promise<ChiliBoard> {
  try {
    const ev = await one<{ chili_voting: ChiliState }>('select chili_voting from events where id = $1', [eventId])
    if (!ev) return EMPTY
    const rows = await query<{ id: string; entry_number: number; name: string; cook: string | null; cents: number; voters: number }>(
      `select e.id, e.entry_number, e.name, e.cook,
              coalesce(sum(v.amount_cents) filter (where v.voided_at is null), 0)::int as cents,
              count(distinct v.bidder_id) filter (where v.voided_at is null)::int as voters
         from chili_entries e left join chili_votes v on v.entry_id = e.id
        where e.event_id = $1 and e.enabled group by e.id order by cents desc, e.entry_number`,
      [eventId],
    )
    // Hearts are free and separate from votes; if their table isn't there yet, everything else still works.
    const hearts = await query<{ entry_id: string; n: number }>('select entry_id, count(*)::int n from chili_hearts group by entry_id').catch(() => [])
    const heartsBy = new Map(hearts.map((h) => [h.entry_id, h.n]))
    const entries = rows.map((r) => ({ id: r.id, number: r.entry_number, name: r.name, cook: r.cook, cents: r.cents, votes: r.cents / 100, voters: r.voters, hearts: heartsBy.get(r.id) ?? 0 }))
    return { state: ev.chili_voting, entries, totalCents: entries.reduce((s, e) => s + e.cents, 0) }
  } catch {
    return EMPTY
  }
}

/** What this guest has put on each chili, and what they still owe the desk for it. */
export async function myChili(bidderId: string) {
  const rows = await query<{ entry_id: string; cents: number; owed: number; paid: number }>(
    `select entry_id, sum(amount_cents)::int as cents,
            coalesce(sum(amount_cents) filter (where paid_at is null), 0)::int as owed,
            coalesce(sum(amount_cents) filter (where paid_at is not null), 0)::int as paid
       from chili_votes where bidder_id = $1 and voided_at is null group by entry_id`,
    [bidderId],
  ).catch(() => [])
  const hearted = await query<{ entry_id: string }>('select entry_id from chili_hearts where bidder_id = $1', [bidderId]).catch(() => [])
  return {
    hearts: hearted.map((h) => h.entry_id),
    byEntry: Object.fromEntries(rows.map((r) => [r.entry_id, r.cents])) as Record<string, number>,
    owedCents: rows.reduce((s, r) => s + r.owed, 0),
    paidCents: rows.reduce((s, r) => s + r.paid, 0),
  }
}

export async function castChiliVote(p: { bidderId: string; entryId: string; votes: number; idempotencyKey: string }) {
  if (!Number.isInteger(p.votes) || p.votes < 1 || p.votes > 1000) throw new AppError('INVALID_AMOUNT', 'Choose between $1 and $1,000 at a time. You can vote again for more.')
  if (!p.idempotencyKey) throw new AppError('INVALID_REQUEST', 'Missing request id.')
  return tx(async (c) => {
    const b = await one<{ id: string; event_id: string; bidder_number: number }>('select id, event_id, bidder_number from bidders where id = $1', [p.bidderId], c)
    if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
    const prior = await one<{ id: string }>('select id from chili_votes where idempotency_key = $1', [p.idempotencyKey], c)
    if (prior) return { replay: true }
    const ev = await one<{ chili_voting: ChiliState }>('select chili_voting from events where id = $1 for share', [b.event_id], c)
    if (ev?.chili_voting !== 'open') throw new AppError('CHILI_CLOSED', 'Chili voting isn’t open right now.', 409)
    const entry = await one<{ id: string; name: string }>('select id, name from chili_entries where id = $1 and event_id = $2 and enabled', [p.entryId, b.event_id], c)
    if (!entry) throw new AppError('NOT_FOUND', 'That chili isn’t in the cook-off.', 404)
    await c.query('insert into chili_votes (event_id, entry_id, bidder_id, amount_cents, idempotency_key) values ($1,$2,$3,$4,$5)', [b.event_id, entry.id, b.id, p.votes * 100, p.idempotencyKey])
    await audit({ eventId: b.event_id, actorType: 'bidder', actorId: b.id, action: 'chili.vote', entityType: 'chili_entry', entityId: entry.id, details: { bidderNumber: b.bidder_number, votes: p.votes, entry: entry.name } }, c)
    await notify(c, { t: 'game' })
    return { replay: false, entry: entry.name, cents: p.votes * 100 }
  })
}

/** A free heart on a chili: tap once to add it, tap again to take it back. Has nothing to do with votes or money. */
export async function toggleChiliHeart(p: { bidderId: string; entryId: string }) {
  return tx(async (c) => {
    const b = await one<{ id: string; event_id: string }>('select id, event_id from bidders where id = $1', [p.bidderId], c)
    if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
    const ev = await one<{ chili_voting: ChiliState }>('select chili_voting from events where id = $1', [b.event_id], c)
    if (!ev || ev.chili_voting === 'off') throw new AppError('CHILI_CLOSED', 'The chili cook-off isn’t open right now.', 409)
    const entry = await one<{ id: string }>('select id from chili_entries where id = $1 and event_id = $2 and enabled', [p.entryId, b.event_id], c)
    if (!entry) throw new AppError('NOT_FOUND', 'That chili isn’t in the cook-off.', 404)
    const removed = await one('delete from chili_hearts where entry_id = $1 and bidder_id = $2 returning entry_id', [entry.id, b.id], c)
    if (!removed) await c.query('insert into chili_hearts (entry_id, bidder_id) values ($1, $2) on conflict do nothing', [entry.id, b.id])
    await notify(c, { t: 'game' })
    return { hearted: !removed }
  })
}

export async function setChiliState(eventId: string, state: ChiliState, adminId: string) {
  await tx(async (c) => {
    await c.query('update events set chili_voting = $2 where id = $1', [eventId, state])
    await audit({ eventId, actorType: 'admin', actorId: adminId, action: 'chili.state', details: { state } }, c)
    await notify(c, { t: 'game' })
  })
}

/** What a volunteer sees at checkout: this guest's chili votes by entry. */
export async function chiliForCheckout(bidderId: string) {
  return query<{ entry_id: string; entry_number: number; name: string; cents: number; owed: number; paid: number }>(
    `select v.entry_id, e.entry_number, e.name, sum(v.amount_cents)::int as cents,
            coalesce(sum(v.amount_cents) filter (where v.paid_at is null), 0)::int as owed,
            coalesce(sum(v.amount_cents) filter (where v.paid_at is not null), 0)::int as paid
       from chili_votes v join chili_entries e on e.id = v.entry_id
      where v.bidder_id = $1 and v.voided_at is null group by v.entry_id, e.entry_number, e.name order by e.entry_number`,
    [bidderId],
  ).catch(() => [])
}

/** The guest handed over the money for their chili votes. */
export async function markChiliPaid(p: { bidderId: string; method: 'cash' | 'check' | 'card_terminal'; adminId: string }) {
  if (!['cash', 'check', 'card_terminal'].includes(p.method)) throw new AppError('INVALID_METHOD', 'Choose cash, check, or card terminal.')
  return tx(async (c) => {
    const b = await one<{ id: string; event_id: string; bidder_number: number }>('select id, event_id, bidder_number from bidders where id = $1 for update', [p.bidderId], c)
    if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
    const rows = await query<{ amount_cents: number }>(
      'update chili_votes set paid_at = now(), paid_method = $2, paid_by_admin_id = $3 where bidder_id = $1 and paid_at is null and voided_at is null returning amount_cents',
      [b.id, p.method, p.adminId],
      c,
    )
    const cents = rows.reduce((s, r) => s + r.amount_cents, 0)
    if (cents === 0) throw new AppError('NOTHING_DUE', 'There are no unpaid chili votes for this guest.', 409)
    await audit({ eventId: b.event_id, actorType: 'admin', actorId: p.adminId, action: 'chili.paid', entityType: 'bidder', entityId: b.id, details: { bidderNumber: b.bidder_number, method: p.method, amount: formatCents(cents) } }, c)
    await notify(c, { t: 'bidder', id: b.id })
    return { cents }
  })
}

/** Removes a guest's UNPAID votes for one chili (a mistaken tap). Paid votes can't be removed here. */
export async function voidChiliVotes(p: { bidderId: string; entryId: string; adminId: string; reason: string }) {
  if (!p.reason.trim()) throw new AppError('REASON_REQUIRED', 'A reason is required.')
  return tx(async (c) => {
    const b = await one<{ id: string; event_id: string }>('select id, event_id from bidders where id = $1 for update', [p.bidderId], c)
    if (!b) throw new AppError('BIDDER_NOT_FOUND', 'Bidder not found.', 404)
    const rows = await query<{ amount_cents: number }>(
      'update chili_votes set voided_at = now(), void_reason = $4, voided_by_admin_id = $3 where bidder_id = $1 and entry_id = $2 and paid_at is null and voided_at is null returning amount_cents',
      [b.id, p.entryId, p.adminId, p.reason.trim()],
      c,
    )
    if (!rows.length) throw new AppError('NOTHING_TO_REMOVE', 'There are no unpaid votes for that chili.', 409)
    const cents = rows.reduce((s, r) => s + r.amount_cents, 0)
    await audit({ eventId: b.event_id, actorType: 'admin', actorId: p.adminId, action: 'chili.voided', entityType: 'chili_entry', entityId: p.entryId, details: { amount: formatCents(cents), reason: p.reason } }, c)
    await notify(c, { t: 'game' })
    return { cents }
  })
}
