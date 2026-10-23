import Link from 'next/link'
import { getEvent } from '@/lib/events'
import { getBidder, requireBidderPage } from '@/lib/session'
import { query } from '@/lib/db'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { formatCents } from '@/lib/money'
import { LiveRefresh } from '@/components/live-refresh'

export const metadata = { title: 'My bids' }

type Row = {
  id: string; item_number: number; title: string; kind: 'silent' | 'live'; status: string
  current_bid_cents: number | null; current_bidder_id: string | null; my_top: number; won: boolean
}

export default async function MyBidsPage() {
  const bidder = await requireBidderPage('/my-bids')
  await getEvent()
  await finalizeDueSilentItems()
  const rows = await query<Row>(
    `select i.id, i.item_number, i.title, i.kind, i.status, i.current_bid_cents, i.current_bidder_id,
            m.top as my_top,
            exists (select 1 from winning_results w where w.item_id = i.id and w.bidder_id = $1 and w.voided_at is null) as won
       from auction_items i
       join (select item_id, max(amount_cents) top from (
               select item_id, amount_cents from silent_bids where bidder_id = $1
               union all
               select b.item_id, b.amount_cents from live_accepted_bids b
                where b.bidder_id = $1 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id)) x
             group by item_id) m on m.item_id = i.id
      order by i.kind, i.item_number`,
    [bidder.id],
  )
  void getBidder

  const state = (r: Row) => {
    const closed = r.status === 'closed' || r.status === 'finalized'
    if (r.won) return { label: 'You won', cls: 'bg-success text-white' }
    if (r.current_bidder_id === bidder.id) return closed ? { label: 'Pending win', cls: 'bg-success text-white' } : { label: 'You’re winning', cls: 'bg-[#dff3ee] text-[#0f5c4f]' }
    return closed ? { label: 'Didn’t win', cls: 'bg-muted text-muted-foreground' } : { label: 'Outbid', cls: 'bg-danger text-white' }
  }

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <div>
        <h1 className="text-3xl font-extrabold">My bids</h1>
        <p className="mt-1 text-muted-foreground">Bidder #{bidder.bidder_number} · {bidder.name}</p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="font-semibold">You haven’t bid on anything yet.</p>
          <Link href="/auction" className="mt-2 inline-block font-semibold text-ink underline underline-offset-2">Browse auction items</Link>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
          {rows.map((r) => {
            const s = state(r)
            return (
              <li key={r.id}>
                <Link href={`/auction/${r.id}`} className="flex items-center gap-4 p-4 hover:bg-secondary/50">
                  <span className="w-10 shrink-0 text-center text-sm font-bold text-muted-foreground">#{r.item_number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="tnum text-sm text-muted-foreground">Your top bid {formatCents(r.my_top)} · current {formatCents(r.current_bid_cents)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${s.cls}`}>{s.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
