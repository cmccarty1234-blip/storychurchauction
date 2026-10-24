import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink, QrCode } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { getItem, liveBidHistory } from '@/lib/queries'
import { requireAdminPage } from '@/lib/session'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { query, one } from '@/lib/db'
import { formatCents } from '@/lib/money'
import { formatInTz, nowMs, utcToLocalInput } from '@/lib/time'
import { ItemForm } from '@/components/item-form'
import { AssistedBidForm, ItemAdminActions } from '@/components/item-admin-actions'
import { LiveRefresh } from '@/components/live-refresh'
import { buttonVariants } from '@/components/ui/button'

export default async function AdminItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = await requireAdminPage()
  await finalizeDueSilentItems()
  const [ev, item] = await Promise.all([getEvent(), getItem(id, { includeDraft: true })])
  if (!item) notFound()

  const silentBids = item.kind === 'silent'
    ? await query<{ bidder_number: number; name: string; amount_cents: number; created_at: Date; by_admin: string | null }>(
        `select b.bidder_number, b.name, s.amount_cents, s.created_at, a.name as by_admin
           from silent_bids s join bidders b on b.id = s.bidder_id left join admin_users a on a.id = s.placed_by_admin_id
          where s.item_id = $1 order by s.amount_cents desc`,
        [item.id],
      )
    : []
  const liveBids = item.kind === 'live' ? await liveBidHistory(item.id) : []
  const winner = await one<{ bidder_number: number; name: string; amount_cents: number; voided_at: Date | null }>(
    `select b.bidder_number, b.name, w.amount_cents, w.voided_at from winning_results w join bidders b on b.id = w.bidder_id
      where w.item_id = $1 order by w.finalized_at desc limit 1`,
    [item.id],
  )
  const hasHistory = silentBids.length > 0 || liveBids.length > 0 || !!winner
  const suggested = utcToLocalInput(new Date(nowMs() + 30 * 60_000), ev.timezone)

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin/items" className="text-sm font-medium text-ink hover:underline">← All items</Link>
          <h1 className="mt-1 text-3xl font-extrabold">#{item.item_number} · {item.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground capitalize">{item.kind} auction · status: {item.phase === 'closed' && item.status === 'open' ? 'closed (time expired)' : item.status}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/labels?item=${item.id}`} className={buttonVariants({ variant: 'outline' })}><QrCode className="size-4" /> QR label</Link>
          <Link href={`/auction/${item.id}`} target="_blank" className={buttonVariants({ variant: 'outline' })}><ExternalLink className="size-4" /> Guest page</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <ItemForm
            defaultIncrement={String(ev.default_increment_cents / 100)}
            initial={{
              id: item.id, kind: item.kind, itemNumber: item.item_number, title: item.title, description: item.description,
              donorName: item.donor_name ?? '', imagePath: item.image_path,
              startingBid: String(item.starting_bid_cents / 100), increment: String(item.increment_cents / 100),
              published: item.status !== 'draft', locked: item.bid_count > 0,
              kindLocked: hasHistory || !(item.kind === 'silent' ? ['draft', 'open'] : ['draft', 'upcoming']).includes(item.status),
            }}
          />
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <p className="text-sm text-muted-foreground">{item.phase === 'closed' ? 'Final bid' : 'Current bid'}</p>
            <p className="tnum text-3xl font-extrabold text-ink">{formatCents(item.current_bid_cents)}</p>
            <p className="text-sm text-muted-foreground">{item.bid_count} bids{item.leader_number ? ` · leader #${item.leader_number}` : ''}</p>
            {item.kind === 'silent' ? <p className="mt-1 text-sm text-muted-foreground">Closes {formatInTz(item.effective_close, ev.timezone)}</p> : null}
            {winner && !winner.voided_at ? (
              <p className="mt-3 rounded-xl bg-[#dff3ee] px-3 py-2 text-sm font-semibold text-[#0f5c4f]">Winner: #{winner.bidder_number} {winner.name} — {formatCents(winner.amount_cents)}</p>
            ) : null}
          </div>

          <ItemAdminActions
            itemId={item.id} kind={item.kind} status={item.status} phase={item.phase} hasHistory={hasHistory}
            isAdmin={admin.role === 'admin'} published={item.status !== 'draft'} suggestedReopenLocal={suggested}
          />

          {item.kind === 'silent' && item.phase === 'open' ? (
            <AssistedBidForm itemId={item.id} currentCents={item.current_bid_cents} minNextCents={item.min_next_cents} />
          ) : null}
        </div>
      </div>

      <section aria-labelledby="bids" className="rounded-xl border bg-card shadow-sm">
        <h2 id="bids" className="border-b p-4 font-bold">Bid history</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="p-3">Bidder</th><th className="p-3 text-right">Amount</th><th className="p-3">When</th><th className="p-3">How</th></tr>
            </thead>
            <tbody className="divide-y">
              {silentBids.map((b, i) => (
                <tr key={i} className={i === 0 ? 'bg-secondary/40' : ''}>
                  <td className="p-3">#{b.bidder_number} {b.name}{i === 0 ? <span className="ml-2 rounded-full bg-brand-yellow px-2 py-0.5 text-xs font-semibold text-ink">high</span> : null}</td>
                  <td className="tnum p-3 text-right font-semibold">{formatCents(b.amount_cents)}</td>
                  <td className="p-3 text-xs text-muted-foreground">{formatInTz(b.created_at, ev.timezone, { weekday: undefined })}</td>
                  <td className="p-3 text-xs">{b.by_admin ? `Assisted by ${b.by_admin}` : 'Phone'}</td>
                </tr>
              ))}
              {liveBids.map((b) => (
                <tr key={b.id} className={b.voided ? 'text-muted-foreground line-through' : ''}>
                  <td className="p-3">#{b.bidder_number} {b.bidder_name}</td>
                  <td className="tnum p-3 text-right font-semibold">{formatCents(b.amount_cents)}</td>
                  <td className="p-3 text-xs">{formatInTz(b.created_at, ev.timezone, { weekday: undefined })}</td>
                  <td className="p-3 text-xs">{b.source === 'paddle' ? 'Paddle' : 'Phone request'}{b.voided ? ` · voided: ${b.void_reason}` : ''}</td>
                </tr>
              ))}
              {silentBids.length + liveBids.length === 0 ? <tr><td colSpan={4} className="p-4 text-muted-foreground">No bids yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
