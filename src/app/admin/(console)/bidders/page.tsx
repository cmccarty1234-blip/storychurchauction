import Link from 'next/link'
import { getEvent } from '@/lib/events'
import { query } from '@/lib/db'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { formatPhone } from '@/lib/contact'
import { formatCents } from '@/lib/money'
import { AssistedRegisterForm } from '@/components/bidder-forms'
import { LiveRefresh } from '@/components/live-refresh'

export const metadata = { title: 'Bidders' }

export default async function AdminBidders({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? '').trim()
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const num = /^#?\d+$/.test(q) ? parseInt(q.replace('#', ''), 10) : null
  const rows = await query<any>(
    `select b.id, b.bidder_number, b.name, b.phone, b.email, b.assisted,
            (select count(*) from auction_items i where i.event_id = b.event_id and i.current_bidder_id = b.id and i.status in ('open','paused','closed'))::int as leading,
            (select count(*) from winning_results w where w.bidder_id = b.id and w.voided_at is null)::int as wins,
            coalesce((select sum(w.amount_cents) from winning_results w where w.bidder_id = b.id and w.voided_at is null),0)::int as won_cents
       from bidders b
      where b.event_id = $1 and ($2 = '' or b.bidder_number = $3 or lower(b.name) like '%' || lower($2) || '%'
            or b.phone like '%' || regexp_replace($2, '\\D', '', 'g') || '%' and regexp_replace($2, '\\D', '', 'g') <> ''
            or lower(coalesce(b.email,'')) like '%' || lower($2) || '%')
      order by b.bidder_number limit 300`,
    [ev.id, q, num],
  )

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <h1 className="text-3xl font-extrabold">Bidders</h1>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <form className="flex gap-2" role="search">
            <input name="q" defaultValue={q} placeholder="Search by name, bidder #, phone or email" aria-label="Search bidders" className="h-11 flex-1 rounded-lg border border-input bg-white px-3 text-base" />
            <button className="h-11 rounded-lg bg-brand-yellow px-5 font-semibold text-ink">Search</button>
          </form>
          <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="p-3">#</th><th className="p-3">Name</th><th className="p-3">Contact</th><th className="p-3 text-right">Leading</th><th className="p-3 text-right">Won</th></tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((b) => (
                  <tr key={b.id} className="hover:bg-secondary/40">
                    <td className="p-3 font-bold">{b.bidder_number}</td>
                    <td className="p-3"><Link href={`/admin/bidders/${b.id}`} className="font-semibold text-ink hover:underline">{b.name}</Link>{b.assisted ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">assisted</span> : null}</td>
                    <td className="p-3 text-xs text-muted-foreground">{[formatPhone(b.phone), b.email].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="tnum p-3 text-right">{b.leading}</td>
                    <td className="tnum p-3 text-right">{b.wins ? `${b.wins} · ${formatCents(b.won_cents)}` : '—'}</td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No bidders match.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{rows.length} shown (max 300). Contact details are visible to staff only.</p>
        </div>
        <AssistedRegisterForm />
      </div>
    </div>
  )
}
