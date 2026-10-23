import { getEvent } from '@/lib/events'
import { liveBidHistory, pendingRequests } from '@/lib/queries'
import { requireAdminPage } from '@/lib/session'
import { query } from '@/lib/db'
import { minNextBid } from '@/lib/bidding'
import { LiveRefresh } from '@/components/live-refresh'
import { LiveConsole, type ConsoleItem, type DoneItem, type QueueItem } from '@/components/live-console'

export const metadata = { title: 'Live console' }

export default async function LiveConsolePage() {
  const admin = await requireAdminPage()
  const ev = await getEvent()

  // On the block first; otherwise a closed item still waiting to be finalized.
  const rows = await query<any>(
    `select i.*, b.bidder_number as leader_number, b.name as leader_name
       from auction_items i left join bidders b on b.id = i.current_bidder_id
      where i.event_id = $1 and i.kind = 'live' and i.status in ('open','paused','closed')
      order by (i.status = 'closed'), i.updated_at desc limit 1`,
    [ev.id],
  )
  const r = rows[0]
  const active: ConsoleItem | null = r
    ? { id: r.id, item_number: r.item_number, title: r.title, status: r.status, current_bid_cents: r.current_bid_cents, leader_number: r.leader_number, leader_name: r.leader_name, bid_count: r.bid_count, min_next_cents: minNextBid(r), increment_cents: r.increment_cents, starting_bid_cents: r.starting_bid_cents }
    : null

  const [requests, bids] = r ? await Promise.all([pendingRequests(r.id), liveBidHistory(r.id)]) : [[], []]
  const queue = await query<QueueItem>(`select id, item_number, title, starting_bid_cents from auction_items where event_id = $1 and kind = 'live' and status = 'upcoming' order by coalesce(live_order, 9999), item_number`, [ev.id])
  const done = await query<DoneItem>(
    `select i.id, i.item_number, i.title, b.name as winner, w.amount_cents
       from auction_items i left join winning_results w on w.item_id = i.id and w.voided_at is null left join bidders b on b.id = w.bidder_id
      where i.event_id = $1 and i.kind = 'live' and i.status = 'finalized' order by i.item_number`,
    [ev.id],
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Live auction console</h1>
        <LiveRefresh fallbackMs={3000} showStatus />
      </div>
      <LiveConsole
        active={active}
        requests={requests.map((q) => ({ id: q.id, bidder_number: q.bidder_number, bidder_name: q.bidder_name, amount_cents: q.amount_cents, at: q.created_at.toISOString() }))}
        bids={bids.map((b) => ({ id: b.id, seq: b.seq, bidder_number: b.bidder_number, bidder_name: b.bidder_name, amount_cents: b.amount_cents, source: b.source, at: b.created_at.toISOString(), voided: b.voided, void_reason: b.void_reason }))}
        queue={queue}
        done={done}
        isAdmin={admin.role === 'admin'}
      />
    </div>
  )
}
