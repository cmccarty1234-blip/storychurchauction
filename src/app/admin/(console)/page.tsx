import Link from 'next/link'
import { getEvent } from '@/lib/events'
import { dashboardStats } from '@/lib/queries'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { query } from '@/lib/db'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { LiveRefresh } from '@/components/live-refresh'
import { buttonVariants } from '@/components/ui/button'

export const metadata = { title: 'Dashboard' }

function Stat({ label, value, sub, tone = 'default' }: { label: string; value: string | number; sub?: string; tone?: 'default' | 'money' | 'cash' }) {
  const ring = tone === 'cash' ? 'border-success/40 bg-[#eef6f0]' : tone === 'money' ? 'border-ink/25 bg-white' : 'bg-white'
  return (
    <div className={`rounded-xl border p-4 shadow-sm ${ring}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="tnum mt-1 text-3xl font-extrabold text-ink">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

export default async function AdminDashboard() {
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const s = await dashboardStats(ev.id)
  const recent = await query<{ id: number; action: string; created_at: Date; details: any; actor: string | null }>(
    `select l.id, l.action, l.created_at, l.details, a.name as actor from audit_logs l left join admin_users a on a.id = l.actor_id
      where l.event_id = $1 or l.event_id is null order by l.id desc limit 8`,
    [ev.id],
  )

  return (
    <div className="space-y-8">
      <LiveRefresh showStatus />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">{ev.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Silent auction closes {formatInTz(ev.silent_close_at, ev.timezone)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/live" className={buttonVariants({ variant: 'bid' })}>Live console</Link>
          <Link href="/admin/checkout" className={buttonVariants({ variant: 'outline' })}>Checkout</Link>
        </div>
      </div>

      <section aria-labelledby="part">
        <h2 id="part" className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Participation</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Registered bidders" value={s.bidders} />
          <Stat label="Auction items" value={s.items} />
          <Stat label="Silent items" value={s.silentItems} />
          <Stat label="Live items" value={s.liveItems} />
          <Stat label="Items with no bids" value={s.noBidItems} sub="Silent items and finished live items" />
        </div>
      </section>

      <section aria-labelledby="commit">
        <h2 id="commit" className="mb-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">Bids & commitments — not collected money</h2>
        <p className="mb-3 text-sm text-muted-foreground">These are what guests have promised to pay. Nothing here has been received yet.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat tone="money" label="Current leading bids" value={formatCents(s.leadingCents)} sub="Open and just-closed items; will change until bidding ends" />
          <Stat tone="money" label="Finalized winning bids" value={formatCents(s.finalizedCents)} sub={`${s.itemsSold} ${s.itemsSold === 1 ? 'item' : 'items'} sold — committed, awaiting payment`} />
          <Stat tone="money" label="Outstanding balances" value={formatCents(s.outstandingCents)} sub="Finalized wins minus payments received" />
        </div>
      </section>

      <section aria-labelledby="cash">
        <h2 id="cash" className="mb-1 text-sm font-bold uppercase tracking-wider text-muted-foreground">Payments actually received</h2>
        <p className="mb-3 text-sm text-muted-foreground">Cash, checks and card-terminal payments a volunteer has recorded as received (voided payments excluded).</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Stat tone="cash" label="Payments collected" value={formatCents(s.collectedCents)} />
          <Stat tone="cash" label="Collected so far" value={s.finalizedCents ? `${Math.round((s.collectedCents / s.finalizedCents) * 100)}%` : '—'} sub="Share of finalized winning bids paid" />
        </div>
      </section>

      <section aria-labelledby="act">
        <h2 id="act" className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">Recent activity</h2>
        <ul className="divide-y overflow-hidden rounded-xl border bg-card text-sm shadow-sm">
          {recent.length === 0 ? <li className="p-4 text-muted-foreground">Nothing yet.</li> : null}
          {recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span><span className="font-mono text-xs">{r.action}</span>{r.actor ? <span className="text-muted-foreground"> · {r.actor}</span> : null}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatInTz(r.created_at, ev.timezone, { weekday: undefined })}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
