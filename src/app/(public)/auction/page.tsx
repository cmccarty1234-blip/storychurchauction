import Link from 'next/link'
import { Radio } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { currentLiveItem, listItems } from '@/lib/queries'
import { getBidder } from '@/lib/session'
import { query } from '@/lib/db'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { ItemCard } from '@/components/item-card'
import { LiveRefresh } from '@/components/live-refresh'
import { PiePromo } from '@/components/pie-promo'
import { finalizeDueSilentItems } from '@/lib/bidding'

export const metadata = { title: 'Auction items' }

export default async function AuctionPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const type = (await searchParams).type === 'live' ? 'live' : 'silent'
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const [bidder, live, items] = await Promise.all([getBidder(), currentLiveItem(ev.id), listItems(ev.id, { kind: type })])

  // Which items has the signed-in guest bid on, and are they leading?
  const mine = new Map<string, 'leading' | 'outbid' | 'won'>()
  if (bidder) {
    const rows = await query<{ item_id: string }>(
      `select item_id from silent_bids where bidder_id = $1
       union select item_id from live_accepted_bids where bidder_id = $1`,
      [bidder.id],
    )
    const won = new Set((await query<{ item_id: string }>('select item_id from winning_results where bidder_id = $1 and voided_at is null', [bidder.id])).map((r) => r.item_id))
    const ids = new Set(rows.map((r) => r.item_id))
    for (const it of items) {
      if (won.has(it.id)) mine.set(it.id, 'won')
      else if (ids.has(it.id) && it.phase !== 'closed') mine.set(it.id, it.current_bidder_id === bidder.id ? 'leading' : 'outbid')
    }
  }

  const tab = (t: 'silent' | 'live', label: string) => (
    <Link
      href={t === 'silent' ? '/auction' : '/auction?type=live'}
      aria-current={type === t ? 'page' : undefined}
      className={`inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold transition ${type === t ? 'bg-brand-yellow text-ink' : 'bg-white text-ink ring-1 ring-border hover:bg-secondary'}`}
    >
      {label}
    </Link>
  )

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Auction items</h1>
          {type === 'silent' && ev.silent_close_at ? (
            <p className="mt-1 text-sm text-muted-foreground">Silent auction closes {formatInTz(ev.silent_close_at, ev.timezone)}</p>
          ) : null}
        </div>
        <div className="flex gap-2" role="navigation" aria-label="Auction type">
          {tab('silent', 'Silent auction')}
          {tab('live', 'Live auction')}
        </div>
      </div>

      <PiePromo eventId={ev.id} compact />

      {live ? (
        <Link href={`/auction/${live.id}`} className="flex items-center gap-4 rounded-xl border-2 border-danger bg-white p-4 shadow-sm">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger text-white"><Radio className="size-5" /></span>
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-danger">On the block now</p>
            <p className="truncate font-bold">#{live.item_number} · {live.title}</p>
          </div>
          <p className="tnum ml-auto shrink-0 text-lg font-bold text-ink">{formatCents(live.current_bid_cents ?? live.starting_bid_cents)}</p>
        </Link>
      ) : null}

      {items.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">No items to show yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.id}>
              <ItemCard item={it} myState={mine.get(it.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
