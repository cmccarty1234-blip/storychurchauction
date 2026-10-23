import Link from 'next/link'
import { getEvent } from '@/lib/events'
import { query } from '@/lib/db'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { LiveRefresh } from '@/components/live-refresh'

export const metadata = { title: 'Bid history' }

export default async function AdminBids({ searchParams }: { searchParams: Promise<{ item?: string; bidder?: string; view?: string }> }) {
  const sp = await searchParams
  const ev = await getEvent()
  const view = sp.view === 'audit' ? 'audit' : 'bids'
  const item = /^\d+$/.test(sp.item ?? '') ? parseInt(sp.item!, 10) : null
  const bidder = /^\d+$/.test(sp.bidder ?? '') ? parseInt(sp.bidder!, 10) : null

  const bids = view === 'bids'
    ? await query<any>(
        `select * from (
           select s.created_at, i.item_number, i.title, b.bidder_number, b.name, s.amount_cents,
                  case when s.placed_by_admin_id is null then 'Silent · phone' else 'Silent · assisted by ' || a.name end as how, false as voided, null::text as note
             from silent_bids s join auction_items i on i.id = s.item_id join bidders b on b.id = s.bidder_id left join admin_users a on a.id = s.placed_by_admin_id
            where i.event_id = $1
           union all
           select l.created_at, i.item_number, i.title, b.bidder_number, b.name, l.amount_cents,
                  'Live · ' || case l.source when 'paddle' then 'paddle' else 'phone request' end || ' (clerk ' || a.name || ')', v.accepted_bid_id is not null, v.reason
             from live_accepted_bids l join auction_items i on i.id = l.item_id join bidders b on b.id = l.bidder_id
             join admin_users a on a.id = l.entered_by_admin_id left join live_bid_voids v on v.accepted_bid_id = l.id
            where i.event_id = $1
         ) x where ($2::int is null or item_number = $2) and ($3::int is null or bidder_number = $3)
         order by created_at desc limit 300`,
        [ev.id, item, bidder],
      )
    : []
  const audit = view === 'audit'
    ? await query<any>(
        `select l.id, l.created_at, l.action, l.entity_type, l.details, l.actor_type, a.name as actor
           from audit_logs l left join admin_users a on a.id = l.actor_id where l.event_id = $1 or l.event_id is null order by l.id desc limit 300`,
        [ev.id],
      )
    : []

  const tab = (v: string, label: string) => (
    <Link href={v === 'bids' ? '/admin/bids' : '/admin/bids?view=audit'} className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${view === v ? 'bg-brand-yellow text-ink' : 'bg-white ring-1 ring-border hover:bg-secondary'}`}>{label}</Link>
  )

  return (
    <div className="space-y-5">
      <LiveRefresh />
      <h1 className="text-3xl font-extrabold">Bid history</h1>
      <div className="flex flex-wrap items-center gap-2">
        {tab('bids', 'All accepted bids')}{tab('audit', 'Audit log')}
        {view === 'bids' ? (
          <form className="ml-auto flex flex-wrap gap-2" role="search">
            <input name="item" defaultValue={sp.item ?? ''} placeholder="Item #" inputMode="numeric" aria-label="Filter by item number" className="h-10 w-24 rounded-lg border border-input bg-white px-3 text-sm" />
            <input name="bidder" defaultValue={sp.bidder ?? ''} placeholder="Bidder #" inputMode="numeric" aria-label="Filter by bidder number" className="h-10 w-28 rounded-lg border border-input bg-white px-3 text-sm" />
            <button className="h-10 rounded-lg bg-brand-yellow px-4 text-sm font-semibold text-ink">Filter</button>
          </form>
        ) : null}
      </div>

      {view === 'bids' ? (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="p-3">When</th><th className="p-3">Item</th><th className="p-3">Bidder</th><th className="p-3 text-right">Amount</th><th className="p-3">How recorded</th></tr>
            </thead>
            <tbody className="divide-y">
              {bids.map((b: any, i: number) => (
                <tr key={i} className={b.voided ? 'text-muted-foreground line-through' : ''}>
                  <td className="p-3 text-xs">{formatInTz(b.created_at, ev.timezone, { weekday: undefined })}</td>
                  <td className="p-3">#{b.item_number} {b.title}</td>
                  <td className="p-3">#{b.bidder_number} {b.name}</td>
                  <td className="tnum p-3 text-right font-semibold">{formatCents(b.amount_cents)}</td>
                  <td className="p-3 text-xs">{b.how}{b.voided ? ` · VOIDED: ${b.note}` : ''}</td>
                </tr>
              ))}
              {bids.length === 0 ? <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No bids match.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="p-3">When</th><th className="p-3">Who</th><th className="p-3">Action</th><th className="p-3">Details</th></tr>
            </thead>
            <tbody className="divide-y">
              {audit.map((a: any) => (
                <tr key={a.id}>
                  <td className="p-3 text-xs">{formatInTz(a.created_at, ev.timezone, { weekday: undefined })}</td>
                  <td className="p-3 text-xs">{a.actor ?? a.actor_type}</td>
                  <td className="p-3 font-mono text-xs">{a.action}</td>
                  <td className="max-w-[420px] truncate p-3 text-xs text-muted-foreground" title={JSON.stringify(a.details)}>{JSON.stringify(a.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
