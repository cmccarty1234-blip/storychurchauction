import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { listItems } from '@/lib/queries'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { buttonVariants } from '@/components/ui/button'
import { LiveRefresh } from '@/components/live-refresh'
import { ItemImage } from '@/components/item-card'

export const metadata = { title: 'Items' }

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Hidden', cls: 'bg-muted text-muted-foreground' },
  upcoming: { label: 'Upcoming', cls: 'bg-secondary text-ink' },
  open: { label: 'Open', cls: 'bg-brand-yellow text-ink' },
  paused: { label: 'Paused', cls: 'bg-amber-100 text-amber-900' },
  closed: { label: 'Closed', cls: 'bg-muted text-foreground' },
  finalized: { label: 'Finalized', cls: 'bg-ink text-white' },
}

export default async function AdminItems({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const t = (await searchParams).type
  const kind = t === 'silent' || t === 'live' ? t : undefined
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const items = await listItems(ev.id, { kind, includeDraft: true })

  const tab = (k: string | undefined, label: string) => (
    <Link href={k ? `/admin/items?type=${k}` : '/admin/items'} className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${kind === k ? 'bg-brand-yellow text-ink' : 'bg-white ring-1 ring-border hover:bg-secondary'}`}>{label}</Link>
  )

  return (
    <div className="space-y-5">
      <LiveRefresh />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Items</h1>
        <Link href="/admin/items/new" className={buttonVariants({ variant: 'bid' })}><Plus className="size-4" /> New item</Link>
      </div>
      <div className="flex gap-2">{tab(undefined, 'All')}{tab('silent', 'Silent')}{tab('live', 'Live')}</div>
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3">#</th><th className="p-3">Item</th><th className="p-3">Type</th><th className="p-3">Status</th>
              <th className="p-3 text-right">Bids</th><th className="p-3 text-right">Current / start</th><th className="p-3">Closes</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((i) => {
              const st = STATUS[i.phase === 'closed' && i.status === 'open' ? 'closed' : i.status]
              return (
                <tr key={i.id} className="hover:bg-secondary/40">
                  <td className="p-3 font-bold">{i.item_number}</td>
                  <td className="p-3">
                    <Link href={`/admin/items/${i.id}`} className="flex items-center gap-3 font-semibold text-ink hover:underline">
                      <span className="block size-10 shrink-0 overflow-hidden rounded-lg"><ItemImage path={i.image_path} title="" /></span>
                      {i.title}
                    </Link>
                  </td>
                  <td className="p-3 capitalize">{i.kind}</td>
                  <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span></td>
                  <td className="tnum p-3 text-right">{i.bid_count}</td>
                  <td className="tnum p-3 text-right font-semibold">{formatCents(i.current_bid_cents ?? i.starting_bid_cents)}{i.current_bid_cents == null ? <span className="font-normal text-muted-foreground"> start</span> : null}</td>
                  <td className="p-3 text-xs text-muted-foreground">{i.kind === 'silent' ? formatInTz(i.effective_close, ev.timezone, { weekday: undefined }) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
