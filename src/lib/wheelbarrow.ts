/**
 * "What's in the wheelbarrow": the least we can expect to raise if every item sells for at least its minimum.
 *   auction floor  = for every visible item, its current bid (or its starting bid if nobody has bid yet)
 *   + Power-Up sales + Pie sign-ups already paid for at the Bid Desk
 * It is a FLOOR, not a forecast: an item nobody bids on raises nothing, and nothing here is money collected yet.
 */
import { one } from './db'
import { powerupRevenue } from './powerups'
import { pieSummary } from './pies'

export type Wheelbarrow = {
  items: number
  noBidItems: number
  startingCents: number // sum of starting bids
  floorCents: number // sum of max(current bid, starting bid)
  raisedAboveStartCents: number
  powerupCents: number
  pieCents: number
  totalCents: number
}

export async function wheelbarrow(eventId: string): Promise<Wheelbarrow> {
  const r = await one<{ items: number; no_bid: number; starting: number; floor: number }>(
    `select count(*)::int as items,
            count(*) filter (where bid_count = 0)::int as no_bid,
            coalesce(sum(starting_bid_cents), 0)::int as starting,
            coalesce(sum(coalesce(current_bid_cents, starting_bid_cents)), 0)::int as floor
       from auction_items
      where event_id = $1 and status not in ('draft', 'cancelled')`,
    [eventId],
  )
  const [pu, pie] = await Promise.all([powerupRevenue(eventId), pieSummary(eventId)])
  return {
    items: r!.items,
    noBidItems: r!.no_bid,
    startingCents: r!.starting,
    floorCents: r!.floor,
    raisedAboveStartCents: r!.floor - r!.starting,
    powerupCents: pu.totalCents,
    pieCents: pie.cents,
    totalCents: r!.floor + pu.totalCents + pie.cents,
  }
}
