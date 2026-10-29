import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Printer } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { one, query } from '@/lib/db'
import { requireAdminPage } from '@/lib/session'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { bidderPayments, METHOD_LABEL, paymentStatus, totals, wonItems } from '@/lib/checkout'
import { formatPhone } from '@/lib/contact'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { PaymentForm, ReleaseButton, VoidPaymentButton } from '@/components/checkout-forms'
import { LiveRefresh } from '@/components/live-refresh'
import { buttonVariants } from '@/components/ui/button'
import { refundNote, reconcileBidder } from '@/lib/online-pay'
import { chiliForCheckout } from '@/lib/chili'
import { ChiliCheckout } from '@/components/chili-checkout'

export default async function CheckoutBidder({ params }: { params: Promise<{ bidderId: string }> }) {
  const { bidderId } = await params
  const admin = await requireAdminPage()
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const b = /^[0-9a-f-]{36}$/i.test(bidderId) ? await one<any>('select * from bidders where id = $1 and event_id = $2', [bidderId, ev.id]) : undefined
  if (!b) notFound()
  await reconcileBidder(b.id)
  const refunds = await query<{ refund_due_cents: number }>('select refund_due_cents from online_payments where bidder_id = $1 and refund_due_cents > 0', [b.id])
  const [items, payments, chiliRows] = await Promise.all([wonItems(b.id), bidderPayments(b.id), chiliForCheckout(b.id)])
  const t = totals(items)
  const status = paymentStatus(t)
  const released = items.filter((i) => i.collection_status === 'released').length

  const statusChip = {
    none: { l: 'Nothing won', c: 'bg-muted text-muted-foreground' },
    unpaid: { l: 'Unpaid', c: 'bg-red-50 text-red-800' },
    partial: { l: 'Partly paid', c: 'bg-amber-100 text-amber-900' },
    paid: { l: 'Paid in full', c: 'bg-[#dff3ee] text-[#0f5c4f]' },
  }[status]

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/checkout" className="text-sm font-medium text-ink hover:underline">← Back to search</Link>
          <h1 className="mt-1 text-3xl font-extrabold">#{b.bidder_number} · {b.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{[formatPhone(b.phone), b.email].filter(Boolean).join(' · ') || 'No contact info on file'}</p>
        </div>
        <Link href={`/admin/checkout/${b.id}/print`} target="_blank" className={buttonVariants({ variant: 'outline' })}><Printer className="size-4" /> Printable summary</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-muted-foreground">Total owed</p><p className="tnum text-2xl font-extrabold text-ink">{formatCents(t.owedCents)}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-muted-foreground">Paid</p><p className="tnum text-2xl font-extrabold">{formatCents(t.paidCents)}</p></div>
        <div className="rounded-xl border-2 border-ink bg-white p-4"><p className="text-sm text-muted-foreground">Balance due</p><p className="tnum text-2xl font-extrabold text-danger">{formatCents(t.balanceCents)}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-sm text-muted-foreground">Payment status</p><p className={`mt-1 inline-block rounded-full px-3 py-1 text-sm font-bold ${statusChip.c}`}>{statusChip.l}</p><p className="mt-1 text-xs text-muted-foreground">{released} of {items.length} released</p></div>
      </div>

      <section className="rounded-xl border bg-card shadow-sm" aria-label="Items won">
        <h2 className="border-b p-4 font-bold">Items won</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="p-3">#</th><th className="p-3">Item</th><th className="p-3 text-right">Winning amount</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Balance</th><th className="p-3">Collection</th></tr>
            </thead>
            <tbody className="divide-y">
              {items.map((i) => (
                <tr key={i.item_id}>
                  <td className="p-3 font-bold">{i.item_number}</td>
                  <td className="p-3">{i.title} <span className="text-xs capitalize text-muted-foreground">({i.kind})</span></td>
                  <td className="tnum p-3 text-right font-semibold">{formatCents(i.amount_cents)}</td>
                  <td className="tnum p-3 text-right">{formatCents(i.paid_cents)}</td>
                  <td className="tnum p-3 text-right font-semibold">{formatCents(i.balance_cents)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {i.collection_status === 'released' ? <span className="rounded-full bg-[#dff3ee] px-2.5 py-1 text-xs font-semibold text-[#0f5c4f]">Released{i.exception ? ' (exception)' : ''}</span> : <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold">Not released</span>}
                      <ReleaseButton winningResultId={i.winning_result_id} balanceCents={i.balance_cents} isAdmin={admin.role === 'admin'} released={i.collection_status === 'released'} title={i.title} />
                    </div>
                    {i.exception_reason ? <p className="mt-1 text-xs text-muted-foreground">Exception: {i.exception_reason}</p> : null}
                  </td>
                </tr>
              ))}
              {items.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">This bidder hasn’t won anything (yet).</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {chiliRows.length ? <ChiliCheckout bidderId={b.id} rows={chiliRows} /> : null}

      {refunds.map((r, i) => <p key={i} role="alert" className="rounded-xl border-2 border-red-700 bg-red-50 p-3 font-semibold text-red-900">{refundNote(r.refund_due_cents)}</p>)}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PaymentForm bidderId={b.id} balanceCents={t.balanceCents} />
        <section className="rounded-xl border bg-card shadow-sm" aria-label="Payment history">
          <h2 className="border-b p-4 font-bold">Payment history</h2>
          <ul className="divide-y text-sm">
            {payments.map((p) => (
              <li key={p.id} className={`flex items-center justify-between gap-3 p-4 ${p.voided_at ? 'text-muted-foreground' : ''}`}>
                <div className={p.voided_at ? 'line-through' : ''}>
                  <p className="font-semibold">{METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</p>
                  <p className="text-xs text-muted-foreground">{formatInTz(p.created_at, ev.timezone, { weekday: undefined })} · received by {p.received_by}</p>
                </div>
                <div className="text-right">
                  <p className={`tnum font-bold ${p.voided_at ? 'line-through' : ''}`}>{formatCents(p.amount_cents)}</p>
                  {p.voided_at ? <p className="text-xs text-red-700">Voided: {p.void_reason}</p> : admin.role === 'admin' ? <VoidPaymentButton paymentId={p.id} amount={formatCents(p.amount_cents)} /> : null}
                </div>
              </li>
            ))}
            {payments.length === 0 ? <li className="p-4 text-muted-foreground">No payments recorded yet.</li> : null}
          </ul>
          {admin.role !== 'admin' && payments.length ? <p className="border-t p-3 text-xs text-muted-foreground">Corrections to a recorded payment must be made by an administrator.</p> : null}
        </section>
      </div>
    </div>
  )
}
