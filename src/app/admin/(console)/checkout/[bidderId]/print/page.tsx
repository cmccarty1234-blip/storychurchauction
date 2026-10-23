import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getEvent } from '@/lib/events'
import { one } from '@/lib/db'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { bidderPayments, METHOD_LABEL, paymentStatus, totals, wonItems } from '@/lib/checkout'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { PrintButton } from '@/components/print-button'

export const metadata = { title: 'Checkout summary' }

export default async function PrintSummary({ params }: { params: Promise<{ bidderId: string }> }) {
  const { bidderId } = await params
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const b = /^[0-9a-f-]{36}$/i.test(bidderId) ? await one<any>('select id, bidder_number, name from bidders where id = $1 and event_id = $2', [bidderId, ev.id]) : undefined
  if (!b) notFound()
  const [items, payments] = await Promise.all([wonItems(b.id), bidderPayments(b.id)])
  const t = totals(items)
  const status = paymentStatus(t)
  const valid = payments.filter((p) => !p.voided_at)

  return (
    <div className="mx-auto max-w-2xl space-y-6 rounded-xl border bg-white p-8 print:border-0 print:p-0">
      <div className="no-print flex justify-end"><PrintButton label="Print summary" /></div>
      <div className="flex items-center justify-between rounded-xl border-b-4 border-brand-yellow bg-white px-5 py-3 print:rounded-none">
        <Image src="/brand/storychurch-banner.png" alt="Story Church" width={1562} height={286} className="h-9 w-auto brightness-0" />
        <span className="text-sm font-bold uppercase tracking-wide text-ink">Checkout summary</span>
      </div>
      <div>
        <h1 className="text-2xl font-extrabold">{ev.name.replace(/\s*\(DEMO\)\s*$/, '')}</h1>
        <p className="text-sm text-muted-foreground">Printed {formatInTz(new Date(), ev.timezone)}</p>
        <p className="mt-3 text-lg"><strong>Bidder #{b.bidder_number}</strong> — {b.name}</p>
      </div>

      <table className="w-full text-sm">
        <thead className="border-b-2 text-left text-xs uppercase tracking-wide"><tr><th className="py-2">#</th><th>Item</th><th className="text-right">Amount</th><th className="text-right">Picked up</th></tr></thead>
        <tbody className="divide-y">
          {items.map((i) => (
            <tr key={i.item_id}><td className="py-2 font-bold">{i.item_number}</td><td>{i.title}</td><td className="tnum text-right">{formatCents(i.amount_cents)}</td><td className="text-right">{i.collection_status === 'released' ? '✓' : '☐'}</td></tr>
          ))}
        </tbody>
        <tfoot className="border-t-2">
          <tr><td colSpan={2} className="pt-3 text-right font-semibold">Total owed</td><td className="tnum pt-3 text-right font-bold">{formatCents(t.owedCents)}</td><td /></tr>
          <tr><td colSpan={2} className="text-right">Paid</td><td className="tnum text-right">{formatCents(t.paidCents)}</td><td /></tr>
          <tr><td colSpan={2} className="text-right text-base font-bold">Balance due</td><td className="tnum text-right text-base font-extrabold">{formatCents(t.balanceCents)}</td><td /></tr>
        </tfoot>
      </table>

      <p className="text-sm"><strong>Status:</strong> {status === 'paid' ? 'PAID IN FULL' : status === 'partial' ? 'PARTIAL PAYMENT — balance remains' : status === 'none' ? 'No items won' : 'UNPAID'}</p>

      {valid.length ? (
        <div>
          <h2 className="mb-1 text-sm font-bold">Payments received</h2>
          <ul className="text-sm">
            {valid.map((p) => (
              <li key={p.id} className="flex justify-between border-b py-1"><span>{formatInTz(p.created_at, ev.timezone, { weekday: undefined })} · {METHOD_LABEL[p.method]}{p.reference ? ` (${p.reference})` : ''}</span><span className="tnum">{formatCents(p.amount_cents)}</span></li>
            ))}
          </ul>
        </div>
      ) : null}

      {ev.pickup_instructions ? <p className="text-sm text-muted-foreground">{ev.pickup_instructions}</p> : null}
      <p className="text-xs text-muted-foreground">Thank you for supporting Story Church! {ev.contact_info}</p>
    </div>
  )
}
