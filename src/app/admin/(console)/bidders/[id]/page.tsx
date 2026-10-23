import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getEvent } from '@/lib/events'
import { one, query } from '@/lib/db'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { paymentStatus, totals, wonItems } from '@/lib/checkout'
import { formatPhone } from '@/lib/contact'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { EditBidderForm, ResetPinButton } from '@/components/bidder-forms'
import { buttonVariants } from '@/components/ui/button'
import { LiveRefresh } from '@/components/live-refresh'

export default async function AdminBidderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ev = await getEvent()
  await finalizeDueSilentItems()
  const b = /^[0-9a-f-]{36}$/i.test(id) ? await one<any>('select * from bidders where id = $1 and event_id = $2', [id, ev.id]) : undefined
  if (!b) notFound()
  const [won, active, changes] = await Promise.all([
    wonItems(b.id),
    query<any>(
      `select i.id, i.item_number, i.title, i.kind, i.current_bid_cents, i.status,
              (select max(amount_cents) from silent_bids s where s.item_id = i.id and s.bidder_id = $1) as my_silent
         from auction_items i where i.current_bidder_id = $1 and i.status in ('open','paused','closed') order by i.item_number`,
      [b.id],
    ),
    query<any>(`select l.created_at, l.details, a.name as actor from audit_logs l left join admin_users a on a.id = l.actor_id where l.entity_type = 'bidder' and l.entity_id = $1 order by l.id desc`, [b.id]),
  ])
  const t = totals(won)

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/bidders" className="text-sm font-medium text-ink hover:underline">← All bidders</Link>
          <h1 className="mt-1 text-3xl font-extrabold">#{b.bidder_number} · {b.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{[formatPhone(b.phone), b.email].filter(Boolean).join(' · ') || 'No contact info'}{b.assisted ? ' · assisted bidder' : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ResetPinButton id={b.id} number={b.bidder_number} />
          <Link href={`/admin/checkout/${b.id}`} className={buttonVariants({ variant: 'bid' })}>Open checkout</Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <EditBidderForm id={b.id} name={b.name} phone={formatPhone(b.phone)} email={b.email ?? ''} />
        <div className="space-y-6">
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="font-bold">Active bids (currently leading)</h2>
            <ul className="mt-3 divide-y text-sm">
              {active.map((a: any) => (
                <li key={a.id} className="flex justify-between py-2"><Link href={`/admin/items/${a.id}`} className="hover:underline">#{a.item_number} {a.title}{a.status === 'closed' ? ' (closed)' : ''}</Link><span className="tnum font-semibold">{formatCents(a.current_bid_cents)}</span></li>
              ))}
              {active.length === 0 ? <li className="py-2 text-muted-foreground">Not leading on anything right now.</li> : null}
            </ul>
          </section>
          <section className="rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="font-bold">Items won · {paymentStatus(t) === 'none' ? 'none yet' : paymentStatus(t)}</h2>
            <ul className="mt-3 divide-y text-sm">
              {won.map((w) => (
                <li key={w.item_id} className="flex justify-between py-2"><span>#{w.item_number} {w.title}</span><span className="tnum font-semibold">{formatCents(w.amount_cents)}</span></li>
              ))}
              {won.length === 0 ? <li className="py-2 text-muted-foreground">No wins yet.</li> : null}
            </ul>
            {won.length ? <p className="tnum mt-2 text-right text-sm">Total {formatCents(t.owedCents)} · balance <strong>{formatCents(t.balanceCents)}</strong></p> : null}
          </section>
        </div>
      </div>

      {changes.length ? (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="font-bold">Change history</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {changes.map((c: any, i: number) => (
              <li key={i} className="text-muted-foreground">{formatInTz(c.created_at, ev.timezone)} · {c.actor ?? 'system'} · {c.details?.before ? `${JSON.stringify(c.details.before)} → ${JSON.stringify(c.details.after)}` : 'registered as assisted bidder'}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
