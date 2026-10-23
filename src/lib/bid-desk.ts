import { one, query } from './db'
import { AppError } from './errors'
import { getItemByNumber, listItems } from './queries'

export type DeskItem = {
  id: string
  number: number
  title: string
  open: boolean
  currentCents: number | null
  minNextCents: number
  incrementCents: number
  leaderNumber: number | null
  closesAt: string | null
}

const toDesk = (i: Awaited<ReturnType<typeof getItemByNumber>> & object): DeskItem => ({
  id: i.id,
  number: i.item_number,
  title: i.title,
  open: i.phase === 'open',
  currentCents: i.current_bid_cents,
  minNextCents: i.min_next_cents,
  incrementCents: i.increment_cents,
  leaderNumber: i.leader_number,
  closesAt: i.effective_close ? new Date(i.effective_close).toISOString() : null,
})

/** A guest at the Bid Desk: who they are and where they stand on every silent item they've bid on. */
export async function deskGuest(eventId: string, paddle: number) {
  const b = await one<{ id: string; bidder_number: number; name: string; assisted: boolean }>(
    'select id, bidder_number, name, assisted from bidders where event_id = $1 and bidder_number = $2',
    [eventId, paddle],
  )
  if (!b) throw new AppError('BIDDER_NOT_FOUND', `No guest with paddle number ${paddle}.`, 404)
  const mine = await query<{ item_id: string; top: number }>(
    'select item_id, max(amount_cents)::int as top from silent_bids where bidder_id = $1 group by item_id',
    [b.id],
  )
  const top = new Map(mine.map((m) => [m.item_id, m.top]))
  const items = (await listItems(eventId, { kind: 'silent' }))
    .filter((i) => top.has(i.id))
    .map((i) => ({ ...toDesk(i), myTopCents: top.get(i.id)!, leading: i.current_bidder_id === b.id }))
  return {
    bidder: { id: b.id, number: b.bidder_number, name: b.name, assisted: b.assisted },
    leading: items.filter((i) => i.open && i.leading),
    outbid: items.filter((i) => !i.leading && i.open),
    finished: items.filter((i) => !i.open),
  }
}

/** Look up a silent item by its number (the number printed on the item card). */
export async function deskItem(eventId: string, n: number): Promise<DeskItem> {
  const i = await getItemByNumber(eventId, n)
  if (!i || i.status === 'draft') throw new AppError('ITEM_NOT_FOUND', `There is no item #${n}.`, 404)
  if (i.kind !== 'silent') throw new AppError('WRONG_KIND', `Item #${n} is a live-auction item — bids on it are taken by paddle at the live auction.`, 409)
  return toDesk(i)
}
