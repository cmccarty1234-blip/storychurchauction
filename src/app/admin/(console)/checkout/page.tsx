import Link from 'next/link'
import { Download } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { query } from '@/lib/db'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { formatCents } from '@/lib/money'
import { LiveRefresh } from '@/components/live-refresh'
import { buttonVariants } from '@/components/ui/button'

export const metadata = { title: 'Checkout' }

export default async function CheckoutSearch({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const filter = ['unpaid', 'partial', 'paid'].includes(sp.f ?? '') ? sp.f! : 'all'
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const num = /^#?\d+$/.test(q) ? parseInt(q.replace('#', ''), 10) : null

  const rows = await query<any>(
    `select * from (
       select b.id, b.bidder_number, b.name, count(wr.id)::int as items,
              coalesce(sum(wr.amount_cents),0)::int as owed,
              coalesce((select sum(a.amount_cents) from payment_allocations a join payments p on p.id = a.payment_id
                         join winning_results w2 on w2.id = a.winning_result_id and w2.voided_at is null
                        where w2.bidder_id = b.id and p.voided_at is null),0)::int as paid,
              (select count(*) from item_collections ic join winning_results w3 on w3.id = ic.winning_result_id
                where w3.bidder_id = b.id and w3.voided_at is null and ic.status = 'released')::int as released
         from bidders b join winning_results wr on wr.bidder_id = b.id and wr.voided_at is null
        where b.event_id = $1 and ($2 = '' or b.bidder_number = $3 or lower(b.name) like '%' || lower($2) || '%')
        group by b.id
     ) x
     where ($4 = 'all' or ($4 = 'unpaid' and paid = 0) or ($4 = 'partial' and paid > 0 and paid < owed) or ($4 = 'paid' and paid >= owed))
     order by (owed - paid) desc, bidder_number limit 300`,
    [ev.id, q, num, filter],
  )
  const outstanding = rows.reduce((s: number, r: any) => s + (r.owed - r.paid), 0)

  const chip = (f: string, label: string) => (
    <Link href={`/admin/checkout?${new URLSearchParams({ ...(q ? { q } : {}), ...(f !== 'all' ? { f } : {}) })}`} className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${filter === f ? 'bg-brand-yellow text-ink' : 'bg-white ring-1 ring-border hover:bg-secondary'}`}>{label}</Link>
  )

  return (
    <div className="space-y-5">
      <LiveRefresh />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold">Checkout</h1>
          <p className="mt-1 text-sm text-muted-foreground">Find a bidder by name or bidder number to collect payment.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* eslint-disable @next/next/no-html-link-for-pages -- CSV downloads from an API route, not a page */}
          <a href="/api/admin/export/results" className={buttonVariants({ variant: 'outline', size: 'sm' })}><Download className="size-4" /> Results CSV</a>
          <a href="/api/admin/export/payments" className={buttonVariants({ variant: 'outline', size: 'sm' })}><Download className="size-4" /> Payments CSV</a>
          <a href="/api/admin/export/balances" className={buttonVariants({ variant: 'outline', size: 'sm' })}><Download className="size-4" /> Balances CSV</a>
          {/* eslint-enable @next/next/no-html-link-for-pages */}
        </div>
      </div>

      <form className="flex gap-2" role="search">
        {filter !== 'all' ? <input type="hidden" name="f" value={filter} /> : null}
        <input name="q" defaultValue={q} autoFocus placeholder="Name or bidder #" aria-label="Search winners" className="h-14 min-w-0 flex-1 rounded-xl border border-input bg-white px-4 text-lg" />
        <button className="h-14 shrink-0 rounded-xl bg-brand-yellow px-6 text-lg font-semibold text-ink">Find</button>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {chip('all', 'All winners')}{chip('unpaid', 'Unpaid')}{chip('partial', 'Partly paid')}{chip('paid', 'Paid')}
        <span className="tnum ml-auto text-sm text-muted-foreground">Balance outstanding in this list: <strong className="text-foreground">{formatCents(outstanding)}</strong></span>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="p-3">#</th><th className="p-3">Bidder</th><th className="p-3 text-right">Items</th><th className="p-3 text-right">Total owed</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Balance</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r: any) => {
              const bal = r.owed - r.paid
              const st = bal <= 0 ? { l: 'Paid', c: 'bg-[#dff3ee] text-[#0f5c4f]' } : r.paid > 0 ? { l: 'Partly paid', c: 'bg-amber-100 text-amber-900' } : { l: 'Unpaid', c: 'bg-red-50 text-red-800' }
              return (
                <tr key={r.id} className="hover:bg-secondary/40">
                  <td className="p-3 font-bold">{r.bidder_number}</td>
                  <td className="p-3"><Link href={`/admin/checkout/${r.id}`} className="font-semibold text-ink hover:underline">{r.name}</Link></td>
                  <td className="tnum p-3 text-right">{r.items}</td>
                  <td className="tnum p-3 text-right">{formatCents(r.owed)}</td>
                  <td className="tnum p-3 text-right">{formatCents(r.paid)}</td>
                  <td className="tnum p-3 text-right font-bold">{formatCents(bal)}</td>
                  <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.c}`}>{st.l}</span> <span className="ml-1 text-xs text-muted-foreground">{r.released}/{r.items} released</span></td>
                </tr>
              )
            })}
            {rows.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No winners match. Items appear here once they’re finalized.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
