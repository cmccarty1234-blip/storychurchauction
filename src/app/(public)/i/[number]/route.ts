import { NextResponse } from 'next/server'
import { getEvent } from '@/lib/events'
import { one } from '@/lib/db'

/** Short link used inside QR codes: /i/12 → that item's page. Keeps QR codes small and scannable. */
export async function GET(req: Request, ctx: RouteContext<'/i/[number]'>) {
  const { number } = await ctx.params
  const n = parseInt(number, 10)
  const ev = await getEvent()
  const item = Number.isInteger(n) ? await one<{ id: string }>(`select id from auction_items where event_id = $1 and item_number = $2 and status <> 'draft'`, [ev.id, n]) : undefined
  const base = new URL(req.url)
  return NextResponse.redirect(new URL(item ? `/auction/${item.id}` : '/auction', base.origin))
}
