/**
 * "Pie Brandon in the Face". Guests sign up (pay at the Bid Desk) for a small or large pie any time during the night.
 * The sign-ups are Power-Up-style purchases (category 'pie'); at the finale the host calls people up in sign-up order
 * and records each throw. A throw consumes one unit, so nobody can throw more pies than they paid for.
 */
import type pg from 'pg'
import { one, query, tx } from './db'
import { AppError } from './errors'
import { audit } from './audit'
import { announce } from './announce'
import { notify } from './realtime'

export const PIE_CODES = ['pie_small', 'pie_large'] as const
const label = (code: string) => (code === 'pie_large' ? 'LARGE' : 'small')

export type PieSummary = {
  enabled: boolean
  smallPriceCents: number
  largePriceCents: number
  smallSold: number
  largeSold: number
  smallLeft: number
  largeLeft: number
  thrown: number
  cents: number
}

const EMPTY: PieSummary = { enabled: false, smallPriceCents: 10000, largePriceCents: 20000, smallSold: 0, largeSold: 0, smallLeft: 0, largeLeft: 0, thrown: 0, cents: 0 }

/** Safe to call from any page: if the pie tables have not been created yet it just reports "no pies". */
export async function pieSummary(eventId: string): Promise<PieSummary> {
  try {
    return await pieSummaryUnsafe(eventId)
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === '42P01' || code === '42703') return EMPTY // table / column does not exist yet
    throw e
  }
}

async function pieSummaryUnsafe(eventId: string): Promise<PieSummary> {
  const r = await one<any>(
    `select
       coalesce(sum(p.quantity) filter (where p.powerup_code = 'pie_small'), 0)::int as small_sold,
       coalesce(sum(p.quantity) filter (where p.powerup_code = 'pie_large'), 0)::int as large_sold,
       coalesce(sum(p.total_cents), 0)::int as cents,
       (select count(*) from pie_throws t where t.event_id = $1 and t.powerup_code = 'pie_small')::int as small_thrown,
       (select count(*) from pie_throws t where t.event_id = $1 and t.powerup_code = 'pie_large')::int as large_thrown,
       coalesce((select bool_or(enabled) from powerup_defs where category = 'pie'), false) as enabled,
       coalesce((select price_cents from powerup_defs where code = 'pie_small'), 10000)::int as small_price,
       coalesce((select price_cents from powerup_defs where code = 'pie_large'), 20000)::int as large_price
     from powerup_purchases p join powerup_defs d on d.code = p.powerup_code
    where p.event_id = $1 and p.voided_at is null and d.category = 'pie'`,
    [eventId],
  )
  return {
    enabled: r.enabled,
    smallPriceCents: r.small_price,
    largePriceCents: r.large_price,
    smallSold: r.small_sold,
    largeSold: r.large_sold,
    smallLeft: r.small_sold - r.small_thrown,
    largeLeft: r.large_sold - r.large_thrown,
    thrown: r.small_thrown + r.large_thrown,
    cents: r.cents,
  }
}

export type PieLine = { bidderId: string; bidderNumber: number; name: string; code: string; size: 'small' | 'large'; signedUpAt: Date }

/** Pies still to be thrown, in sign-up order (earliest sign-up first). Each unit is one row. */
export async function pieLine(eventId: string): Promise<PieLine[]> {
  try {
    return await pieLineUnsafe(eventId)
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === '42P01' || code === '42703') return []
    throw e
  }
}

async function pieLineUnsafe(eventId: string): Promise<PieLine[]> {
  const rows = await query<{ bidder_id: string; bidder_number: number; name: string; code: string; at: Date; rn: number; thrown: number }>(
    `with units as (
       select p.bidder_id, p.powerup_code as code, p.created_at as at,
              row_number() over (partition by p.bidder_id, p.powerup_code order by p.created_at, g) as rn
         from powerup_purchases p
         join powerup_defs d on d.code = p.powerup_code and d.category = 'pie'
         cross join lateral generate_series(1, p.quantity) g
        where p.event_id = $1 and p.voided_at is null
     )
     select u.bidder_id, b.bidder_number, b.name, u.code, u.at, u.rn::int,
            (select count(*) from pie_throws t where t.bidder_id = u.bidder_id and t.powerup_code = u.code)::int as thrown
       from units u join bidders b on b.id = u.bidder_id
      order by u.at, b.bidder_number`,
    [eventId],
  )
  return rows
    .filter((r) => r.rn > r.thrown)
    .map((r) => ({ bidderId: r.bidder_id, bidderNumber: r.bidder_number, name: r.name, code: r.code, size: r.code === 'pie_large' ? ('large' as const) : ('small' as const), signedUpAt: r.at }))
}

/** The host records one pie thrown by this guest. Refused if they have no unthrown pie of that size. */
export async function throwPie(i: { eventId: string; bidderNumber: number; code: string; adminId: string }) {
  if (!(PIE_CODES as readonly string[]).includes(i.code)) throw new AppError('INVALID_REQUEST', 'Choose a small or large pie.')
  return tx(async (c: pg.PoolClient) => {
    const b = await one<{ id: string; bidder_number: number; name: string }>(
      'select id, bidder_number, name from bidders where event_id = $1 and bidder_number = $2 for update',
      [i.eventId, i.bidderNumber],
      c,
    )
    if (!b) throw new AppError('BIDDER_NOT_FOUND', `No guest with paddle number ${i.bidderNumber}.`, 404)
    const left = await one<{ n: number }>(
      `select (coalesce((select sum(p.quantity) from powerup_purchases p where p.bidder_id = $1 and p.powerup_code = $2 and p.voided_at is null), 0)
              - (select count(*) from pie_throws t where t.bidder_id = $1 and t.powerup_code = $2))::int as n`,
      [b.id, i.code],
      c,
    )
    if (!left || left.n < 1) throw new AppError('NO_PIE', `Bidder #${b.bidder_number} has no ${label(i.code)} pie left to throw.`, 409)
    await c.query('insert into pie_throws (event_id, bidder_id, powerup_code, thrown_by_admin_id) values ($1,$2,$3,$4)', [i.eventId, b.id, i.code, i.adminId])
    await audit({ eventId: i.eventId, actorType: 'admin', actorId: i.adminId, action: 'pie.thrown', entityType: 'bidder', entityId: b.id, details: { code: i.code, bidderNumber: b.bidder_number } }, c)
    await announce(c, {
      eventId: i.eventId,
      kind: 'pie.thrown',
      headline: `SPLAT! Bidder #${b.bidder_number} pies Brandon with a ${label(i.code)} pie!`,
      interrupt: true,
      payload: { bidderNumber: b.bidder_number, size: i.code === 'pie_large' ? 'large' : 'small' },
    })
    await notify(c, { t: 'game' })
    return { bidderNumber: b.bidder_number, name: b.name, size: i.code === 'pie_large' ? 'large' : 'small', left: left.n - 1 }
  })
}
