import Link from 'next/link'
import { getEvent } from '@/lib/events'
import { requireBidderPage } from '@/lib/session'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { paymentStatus, totals, wonItems } from '@/lib/checkout'
import { formatCents } from '@/lib/money'
import { LiveRefresh } from '@/components/live-refresh'

export const metadata = { title: 'My wins' }

export default async function MyWinsPage() {
  const bidder = await requireBidderPage('/my-wins')
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const items = await wonItems(bidder.id)
  const t = totals(items)
  const status = paymentStatus(t)

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <div>
        <h1 className="text-3xl font-extrabold">My wins</h1>
        <p className="mt-1 text-muted-foreground">Bidder #{bidder.bidder_number} · {bidder.name}</p>
      </div>
      {items.length === 0 ? (
        <div className="rounded-xl border bg-card p-8 text-center">
          <p className="font-semibold">Nothing won yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Winners appear here as soon as each item closes.</p>
          <Link href="/auction" className="mt-3 inline-block font-semibold text-ink underline underline-offset-2">Keep bidding</Link>
        </div>
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
            {items.map((i) => (
              <li key={i.item_id} className="flex items-center gap-4 p-4">
                <span className="w-10 shrink-0 text-center text-sm font-bold text-muted-foreground">#{i.item_number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{i.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {i.collection_status === 'released' ? 'Picked up' : i.balance_cents === 0 ? 'Paid — ready for pickup' : i.paid_cents > 0 ? `Partly paid · ${formatCents(i.balance_cents)} due` : 'Payment due at checkout'}
                  </span>
                </span>
                <span className="tnum shrink-0 text-lg font-bold">{formatCents(i.amount_cents)}</span>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt>Total won</dt><dd className="tnum font-semibold">{formatCents(t.owedCents)}</dd></div>
              <div className="flex justify-between"><dt>Paid so far</dt><dd className="tnum font-semibold">{formatCents(t.paidCents)}</dd></div>
              <div className="flex justify-between border-t pt-2 text-base"><dt className="font-bold">{status === 'paid' ? 'Balance' : 'Balance due'}</dt><dd className="tnum font-extrabold text-ink">{formatCents(t.balanceCents)}</dd></div>
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">
              Pay in person at the checkout table (cash, check, or card). Tell the volunteer your bidder number: <strong className="text-foreground">#{bidder.bidder_number}</strong>.
            </p>
            {ev.pickup_instructions ? <p className="mt-2 text-sm text-muted-foreground">{ev.pickup_instructions}</p> : null}
          </div>
        </>
      )}
    </div>
  )
}
