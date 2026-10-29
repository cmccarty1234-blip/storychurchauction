import { route } from '@/lib/api'
import { query } from '@/lib/db'
import { inventory, listDefs } from '@/lib/powerups'
import { getBidder } from '@/lib/session'

export const dynamic = 'force-dynamic'

/** The signed-in guest's Power-Up inventory + activation history. Signed-out visitors just get the store. */
export const GET = route(async () => {
  const defs = (await listDefs()).map((d) => ({ code: d.code, name: d.name, description: d.description, icon: d.icon, priceCents: d.price_cents, enabled: d.enabled, category: d.category, kinds: d.kinds, seconds: d.config.seconds ?? null }))
  const bidder = await getBidder()
  if (!bidder) return Response.json({ signedIn: false, defs, inventory: [], history: [] }, { headers: { 'Cache-Control': 'no-store' } })
  const [inv, history] = await Promise.all([
    inventory(bidder.id),
    query<{ code: string; name: string; item_number: number; title: string; at: Date; headline: string | null }>(
      `select a.powerup_code as code, d.name, i.item_number, i.title, a.created_at as at, a.details->>'headline' as headline
         from powerup_activations a join powerup_defs d on d.code = a.powerup_code join auction_items i on i.id = a.item_id
        where a.bidder_id = $1 order by a.created_at desc limit 30`,
      [bidder.id],
    ),
  ])
  return Response.json({ signedIn: true, bidderNumber: bidder.bidder_number, defs, inventory: inv, history: history.map((h) => ({ ...h, at: h.at.toISOString() })) }, { headers: { 'Cache-Control': 'no-store' } })
})
