import { one, query } from './db'
import { minNextBid } from './bidding'
import type { EventRow } from './events'

export type ItemPhase = 'upcoming' | 'open' | 'paused' | 'closed'

export type ItemView = {
  id: string
  event_id: string
  item_number: number
  kind: 'silent' | 'live'
  title: string
  description: string
  image_path: string | null
  donor_name: string | null
  starting_bid_cents: number
  increment_cents: number
  status: 'draft' | 'upcoming' | 'open' | 'paused' | 'closed' | 'finalized'
  closes_at: Date | null
  live_order: number | null
  current_bid_cents: number | null
  current_bidder_id: string | null
  bid_count: number
  leader_number: number | null
  effective_close: Date | null
  silent_start_at: Date | null
  db_now: Date
  // derived
  phase: ItemPhase
  min_next_cents: number
  sold: boolean
}

const SELECT = `
  select i.*, b.bidder_number as leader_number,
         coalesce(i.closes_at, e.silent_close_at) as effective_close, e.silent_start_at, now() as db_now,
         exists (select 1 from winning_results w where w.item_id = i.id and w.voided_at is null) as sold
    from auction_items i
    join events e on e.id = i.event_id
    left join bidders b on b.id = i.current_bidder_id`

function derive(r: any): ItemView {
  let phase: ItemPhase
  if (r.status === 'closed' || r.status === 'finalized') phase = 'closed'
  else if (r.status === 'paused') phase = 'paused'
  else if (r.status === 'upcoming' || r.status === 'draft') phase = 'upcoming'
  else {
    phase = 'open'
    if (r.kind === 'silent') {
      if (r.silent_start_at && r.db_now < r.silent_start_at) phase = 'upcoming'
      else if (r.effective_close && r.db_now >= r.effective_close) phase = 'closed'
    }
  }
  return { ...r, phase, min_next_cents: minNextBid(r) }
}

export async function listItems(eventId: string, opts: { kind?: 'silent' | 'live'; includeDraft?: boolean } = {}): Promise<ItemView[]> {
  const rows = await query(
    `${SELECT} where i.event_id = $1 and ($2::text is null or i.kind = $2) and ($3 or i.status <> 'draft')
      order by i.kind, case when i.kind = 'live' then coalesce(i.live_order, 9999) end, i.item_number`,
    [eventId, opts.kind ?? null, !!opts.includeDraft],
  )
  return rows.map(derive)
}

export async function getItem(id: string, opts: { includeDraft?: boolean } = {}): Promise<ItemView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const r = await one(`${SELECT} where i.id = $1 and ($2 or i.status <> 'draft')`, [id, !!opts.includeDraft])
  return r ? derive(r) : null
}

export async function getItemByNumber(eventId: string, n: number) {
  const r = await one(`${SELECT} where i.event_id = $1 and i.item_number = $2`, [eventId, n])
  return r ? derive(r) : null
}

export function closesLabelNeeded(i: ItemView, ev: EventRow) {
  return i.kind === 'silent' ? i.effective_close ?? ev.silent_close_at : null
}

export type LiveBidRow = { id: string; seq: number; bidder_number: number; bidder_name: string; amount_cents: number; source: 'paddle' | 'mobile'; created_at: Date; voided: boolean; void_reason: string | null }

export async function liveBidHistory(itemId: string): Promise<LiveBidRow[]> {
  return query<LiveBidRow>(
    `select b.id, b.seq, bd.bidder_number, bd.name as bidder_name, b.amount_cents, b.source, b.created_at,
            v.accepted_bid_id is not null as voided, v.reason as void_reason
       from live_accepted_bids b join bidders bd on bd.id = b.bidder_id
       left join live_bid_voids v on v.accepted_bid_id = b.id
      where b.item_id = $1 order by b.seq desc`,
    [itemId],
  )
}

export type PendingRequest = { id: string; bidder_number: number; bidder_name: string; amount_cents: number; created_at: Date }

export async function pendingRequests(itemId: string): Promise<PendingRequest[]> {
  return query<PendingRequest>(
    `select r.id, bd.bidder_number, bd.name as bidder_name, r.amount_cents, r.created_at
       from live_bid_requests r join bidders bd on bd.id = r.bidder_id
      where r.item_id = $1 and r.status = 'pending' order by r.amount_cents desc, r.created_at`,
    [itemId],
  )
}

export async function currentLiveItem(eventId: string): Promise<ItemView | null> {
  const r = await one(`${SELECT} where i.event_id = $1 and i.kind = 'live' and i.status in ('open','paused')`, [eventId])
  return r ? derive(r) : null
}

export type DashboardStats = {
  bidders: number
  items: number
  silentItems: number
  liveItems: number
  noBidItems: number
  leadingCents: number
  finalizedCents: number
  collectedCents: number
  outstandingCents: number
  unfinalizedLeadingCents: number
  itemsSold: number
}

export async function dashboardStats(eventId: string): Promise<DashboardStats> {
  const r = await one<any>(
    `select
       (select count(*) from bidders where event_id = $1)::int as bidders,
       (select count(*) from auction_items where event_id = $1 and status <> 'draft')::int as items,
       (select count(*) from auction_items where event_id = $1 and kind = 'silent' and status <> 'draft')::int as "silentItems",
       (select count(*) from auction_items where event_id = $1 and kind = 'live' and status <> 'draft')::int as "liveItems",
       (select count(*) from auction_items where event_id = $1 and status <> 'draft' and bid_count = 0 and (status in ('closed','finalized') or kind = 'silent'))::int as "noBidItems",
       (select coalesce(sum(current_bid_cents),0) from auction_items where event_id = $1 and status in ('open','paused','closed'))::int as "unfinalizedLeadingCents",
       (select coalesce(sum(w.amount_cents),0) from winning_results w join auction_items i on i.id = w.item_id where i.event_id = $1 and w.voided_at is null)::int as "finalizedCents",
       (select count(*) from winning_results w join auction_items i on i.id = w.item_id where i.event_id = $1 and w.voided_at is null)::int as "itemsSold",
       (select coalesce(sum(a.amount_cents),0) from payment_allocations a join payments p on p.id = a.payment_id
          where p.event_id = $1 and p.voided_at is null)::int as "collectedCents"`,
    [eventId],
  )
  return { ...r, leadingCents: r.unfinalizedLeadingCents, outstandingCents: r.finalizedCents - r.collectedCents }
}

export function publicItem(i: ItemView) {
  return {
    id: i.id,
    itemNumber: i.item_number,
    kind: i.kind,
    title: i.title,
    imagePath: i.image_path,
    phase: i.phase,
    currentBidCents: i.current_bid_cents,
    bidCount: i.bid_count,
    leaderNumber: i.leader_number,
    minNextCents: i.min_next_cents,
    closesAt: i.kind === 'silent' ? i.effective_close : null,
  }
}
