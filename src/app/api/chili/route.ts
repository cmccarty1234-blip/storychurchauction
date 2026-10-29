import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { getEvent } from '@/lib/events'
import { castChiliVote, chiliBoard, myChili } from '@/lib/chili'
import { getBidder, requireBidder } from '@/lib/session'

export const dynamic = 'force-dynamic'

const Body = z.object({ entryId: uuid, votes: z.number().int(), idempotencyKey: z.string().min(8).max(100) })

/** The cook-off board (public: totals only, never who voted) plus, for a signed-in guest, their own votes. */
export const GET = route(async () => {
  const ev = await getEvent()
  const board = await chiliBoard(ev.id)
  const bidder = await getBidder()
  const mine = bidder ? await myChili(bidder.id) : null
  return Response.json({ ...board, signedIn: !!bidder, mine }, { headers: { 'Cache-Control': 'no-store' } })
})

/** A signed-in guest gives $1-per-vote to a chili. The money is collected at checkout. */
export const POST = route(async (req) => {
  const bidder = await requireBidder()
  const b = await body(req, Body)
  return await castChiliVote({ bidderId: bidder.id, entryId: b.entryId, votes: b.votes, idempotencyKey: b.idempotencyKey })
})
