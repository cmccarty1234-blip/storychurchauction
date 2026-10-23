import { route } from '@/lib/api'
import { query } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { getEvent } from '@/lib/events'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { requireAdmin } from '@/lib/session'

function csvCell(v: unknown): string {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v)
  // Neutralise spreadsheet formula injection from guest-entered text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const dollars = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2))

function csv(header: string[], rows: unknown[][]) {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export const GET = route<RouteContext<'/api/admin/export/[kind]'>>(async (_req, ctx) => {
  const { kind } = await ctx.params
  const admin = await requireAdmin()
  const ev = await getEvent()
  await finalizeDueSilentItems(admin.id)
  let out: string

  if (kind === 'results') {
    const rows = await query<any>(
      `select i.item_number, i.title, i.kind, b.bidder_number, b.name, wr.amount_cents,
              coalesce((select sum(a.amount_cents) from payment_allocations a join payments p on p.id = a.payment_id
                         where a.winning_result_id = wr.id and p.voided_at is null),0)::int paid,
              ic.status, ic.exception
         from winning_results wr join auction_items i on i.id = wr.item_id join bidders b on b.id = wr.bidder_id
         left join item_collections ic on ic.winning_result_id = wr.id
        where i.event_id = $1 and wr.voided_at is null order by i.item_number`,
      [ev.id],
    )
    out = csv(['Item #', 'Title', 'Type', 'Winner #', 'Winner', 'Winning amount', 'Paid', 'Balance', 'Collection', 'Released as exception'],
      rows.map((r) => [r.item_number, r.title, r.kind, r.bidder_number, r.name, dollars(r.amount_cents), dollars(r.paid), dollars(r.amount_cents - r.paid), r.status, r.exception ? 'yes' : '']))
  } else if (kind === 'payments') {
    const rows = await query<any>(
      `select p.created_at, b.bidder_number, b.name, p.method, p.amount_cents, p.reference, a.name as received_by, p.voided_at, p.void_reason
         from payments p join bidders b on b.id = p.bidder_id join admin_users a on a.id = p.received_by_admin_id
        where p.event_id = $1 order by p.created_at`,
      [ev.id],
    )
    out = csv(['Received at (UTC)', 'Bidder #', 'Bidder', 'Method', 'Amount', 'Reference', 'Received by', 'Voided at (UTC)', 'Void reason'],
      rows.map((r) => [r.created_at, r.bidder_number, r.name, r.method, dollars(r.amount_cents), r.reference, r.received_by, r.voided_at, r.void_reason]))
  } else if (kind === 'balances') {
    const rows = await query<any>(
      `select b.bidder_number, b.name, coalesce(sum(wr.amount_cents),0)::int owed,
              coalesce((select sum(a.amount_cents) from payment_allocations a join payments p on p.id = a.payment_id
                         join winning_results w2 on w2.id = a.winning_result_id and w2.voided_at is null
                        where w2.bidder_id = b.id and p.voided_at is null),0)::int paid
         from bidders b join winning_results wr on wr.bidder_id = b.id and wr.voided_at is null
        where b.event_id = $1 group by b.id order by b.bidder_number`,
      [ev.id],
    )
    out = csv(['Bidder #', 'Bidder', 'Total owed', 'Paid', 'Balance'], rows.map((r) => [r.bidder_number, r.name, dollars(r.owed), dollars(r.paid), dollars(r.owed - r.paid)]))
  } else {
    throw new AppError('NOT_FOUND', 'Unknown export.', 404)
  }
  return new Response(out, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="storychurch-${kind}.csv"`, 'Cache-Control': 'no-store' },
  })
})
