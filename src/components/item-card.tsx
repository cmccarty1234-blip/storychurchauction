import Link from 'next/link'
import { Gavel, Radio } from 'lucide-react'
import type { ItemView } from '@/lib/queries'
import { formatCents } from '@/lib/money'
import { Countdown } from './countdown'

export function ItemImage({ path, title, className = '' }: { path: string | null; title: string; className?: string }) {
  return path ? (
    // eslint-disable-next-line @next/next/no-img-element -- served from our own /api/uploads route
    <img src={`/api/uploads/${path}`} alt={title} loading="lazy" className={`size-full object-cover ${className}`} />
  ) : (
    <div className={`flex size-full items-center justify-center bg-secondary text-ink ${className}`} aria-label="No photo yet">
      <Gavel className="size-10 opacity-50" />
    </div>
  )
}

/** Status is always spelled out in words — never color alone. */
export function PhaseBadge({ item }: { item: Pick<ItemView, 'phase' | 'kind' | 'sold' | 'status'> }) {
  const base = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold'
  if (item.phase === 'open') {
    return item.kind === 'live' ? (
      <span className={`${base} border-ink bg-ink text-brand-yellow`}><Radio className="size-3" aria-hidden /> On the block now</span>
    ) : (
      <span className={`${base} border-ink bg-brand-yellow text-ink`}><span className="size-1.5 rounded-full bg-ink" aria-hidden /> Bidding open</span>
    )
  }
  if (item.phase === 'paused') return <span className={`${base} border-amber-700 bg-amber-100 text-amber-950`}>Paused</span>
  if (item.phase === 'upcoming') return <span className={`${base} border-ink/30 bg-white text-ink`}>{item.kind === 'live' ? 'Coming up live' : 'Opens soon'}</span>
  return <span className={`${base} border-transparent bg-muted text-muted-foreground`}>{item.sold ? 'Sold' : 'Closed'}</span>
}

export function ItemCard({ item, myState }: { item: ItemView; myState?: 'leading' | 'outbid' | 'won' | null }) {
  const hasBid = item.current_bid_cents != null
  const action = item.phase === 'open' ? 'Bid now' : item.phase === 'closed' ? 'View result' : 'View item'
  return (
    <Link href={`/auction/${item.id}`} className="group flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md">
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
        <ItemImage path={item.image_path} title={item.title} className="transition duration-300 group-hover:scale-[1.03]" />
        <span className="absolute left-3 top-3 rounded-md bg-white px-2.5 py-1 text-xs font-bold text-ink shadow-sm">#{item.item_number}</span>
        {myState ? (
          <span
            className={`absolute right-3 top-3 rounded-md px-2.5 py-1 text-xs font-bold shadow-sm ${
              myState === 'outbid' ? 'bg-danger text-white' : 'bg-ink text-brand-yellow'
            }`}
          >
            {myState === 'leading' ? 'You’re winning' : myState === 'won' ? 'You won!' : 'Outbid'}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.kind === 'live' ? 'Live auction' : 'Silent auction'}</p>
          <h3 className="mt-1 line-clamp-2 text-lg leading-snug">{item.title}</h3>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">{hasBid ? (item.phase === 'closed' ? 'Final bid' : 'Current bid') : 'Starting bid'}</p>
            <p className="tnum text-2xl font-bold text-ink">{formatCents(hasBid ? item.current_bid_cents : item.starting_bid_cents)}</p>
          </div>
          <div className="space-y-1 text-right">
            <PhaseBadge item={item} />
            {item.kind === 'silent' && item.phase === 'open' && item.effective_close ? (
              <p className="text-xs text-muted-foreground"><Countdown closesAt={item.effective_close} /></p>
            ) : null}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Bid increment {formatCents(item.increment_cents)}</p>
        <span className="mt-auto inline-flex h-11 items-center justify-center rounded-lg bg-brand-yellow text-sm font-bold text-ink group-hover:bg-brand-yellow-hover">
          {action}
        </span>
      </div>
    </Link>
  )
}
