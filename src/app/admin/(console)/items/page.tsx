import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { listItems } from '@/lib/queries'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { buttonVariants } from '@/components/ui/button'
import { LiveRefresh } from '@/components/live-refresh'
import { ItemsTable, type ItemRow } from '@/components/items-table'

export const metadata = { title: 'Items' }

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Hidden', cls: 'bg-muted text-muted-foreground' },
  upcoming: { label: 'Upcoming', cls: 'bg-secondary text-ink' },
  open: { label: 'Open', cls: 'bg-brand-yellow text-ink' },
  paused: { label: 'Paused', cls: 'bg-amber-100 text-amber-900' },
  closed: { label: 'Closed', cls: 'bg-muted text-foreground' },
  provisional: { label: 'Last chance', cls: 'bg-amber-100 text-amber-900' },
  reopened: { label: 'Reopened', cls: 'bg-brand-yellow text-ink' },
  finalized: { label: 'Finalized', cls: 'bg-ink text-white' },
  cancelled: { label: 'Cancelled', cls: 'bg-muted text-muted-foreground' },
}

export default async function AdminItems({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const t = (await searchParams).type
  const kind = t === 'silent' || t === 'live' ? t : undefined
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const items = await listItems(ev.id, { kind, includeDraft: true, openFirst: true })

  const rows: ItemRow[] = items.map((i) => {
    const key = i.phase === 'closed' && i.status === 'open' ? 'closed' : i.status
    const st = STATUS[key] ?? { label: key, cls: 'bg-muted text-foreground' } // never let an unfamiliar status take the whole page down
    return {
      id: i.id,
      number: i.item_number,
      title: i.title,
      kind: i.kind,
      statusLabel: st.label,
      statusCls: st.cls,
      hidden: i.status === 'draft',
      canToggle: i.kind === 'silent' ? ['draft', 'open'].includes(i.status) && i.phase !== 'closed' : ['draft', 'upcoming'].includes(i.status),
      hasPhoto: !!i.image_path,
      imagePath: i.image_path,
      bids: i.bid_count,
      money: formatCents(i.current_bid_cents ?? i.starting_bid_cents),
      moneyIsStart: i.current_bid_cents == null,
      closes: i.kind === 'silent' ? formatInTz(i.effective_close, ev.timezone, { weekday: undefined }) : '—',
    }
  })
  const hidden = rows.filter((r) => r.hidden).length

  const tab = (k: string | undefined, label: string) => (
    <Link href={k ? `/admin/items?type=${k}` : '/admin/items'} className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${kind === k ? 'bg-brand-yellow text-ink' : 'bg-white ring-1 ring-border hover:bg-secondary'}`}>{label}</Link>
  )

  return (
    <div className="space-y-5">
      <LiveRefresh />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Items</h1>
          <p className="mt-1 text-sm text-muted-foreground">{rows.length} shown · {hidden} hidden from guests</p>
        </div>
        <Link href="/admin/items/new" className={buttonVariants({ variant: 'bid' })}><Plus className="size-4" /> New item</Link>
      </div>
      <div className="flex gap-2">{tab(undefined, 'All')}{tab('silent', 'Silent')}{tab('live', 'Live')}</div>
      <ItemsTable rows={rows} />
    </div>
  )
}
