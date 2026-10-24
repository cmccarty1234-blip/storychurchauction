import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Clock, Gift, Trophy } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { getItem, liveBidHistory } from '@/lib/queries'
import { getBidder } from '@/lib/session'
import { one, query } from '@/lib/db'
import { finalizeDueSilentItems } from '@/lib/bidding'
import { formatCents } from '@/lib/money'
import { formatInTz } from '@/lib/time'
import { BidPanel } from '@/components/bid-panel'
import { ItemPowerUps } from '@/components/game-portal'
import { Countdown } from '@/components/countdown'
import { ItemImage, PhaseBadge } from '@/components/item-card'
import { LiveRefresh } from '@/components/live-refresh'

export async function generateMetadata({ params }: { params: Promise<{ itemId: string }> }) {
  const item = await getItem((await params).itemId).catch(() => null)
  return { title: item ? `#${item.item_number} ${item.title}` : 'Item' }
}

export default async function ItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  await finalizeDueSilentItems()
  const [ev, item, bidder] = await Promise.all([getEvent(), getItem(itemId), getBidder()])
  if (!item) notFound()

  const isLive = item.kind === 'live'
  const winner = await one<{ bidder_number: number; bidder_id: string; amount_cents: number }>(
    `select b.bidder_number, w.bidder_id, w.amount_cents from winning_results w join bidders b on b.id = w.bidder_id
      where w.item_id = $1 and w.voided_at is null`,
    [item.id],
  )

  // Public bid history shows bidder NUMBERS only — never names or contact details.
  const history = isLive
    ? (await liveBidHistory(item.id)).filter((h) => !h.voided).slice(0, 8).map((h) => ({ n: h.bidder_number, cents: h.amount_cents, at: h.created_at }))
    : (await query<{ bidder_number: number; amount_cents: number; created_at: Date }>(
        `select b.bidder_number, s.amount_cents, s.created_at from silent_bids s join bidders b on b.id = s.bidder_id
          where s.item_id = $1 order by s.amount_cents desc limit 8`,
        [item.id],
      )).map((h) => ({ n: h.bidder_number, cents: h.amount_cents, at: h.created_at }))

  let myTop: number | null = null
  let myRequest: { amountCents: number; status: 'pending' | 'accepted' | 'rejected' | 'superseded' | 'expired' } | null = null
  if (bidder) {
    myTop = (
      await one<{ m: number | null }>(
        isLive
          ? 'select max(amount_cents) m from live_accepted_bids b where item_id = $1 and bidder_id = $2 and not exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id)'
          : 'select max(amount_cents) m from silent_bids where item_id = $1 and bidder_id = $2',
        [item.id, bidder.id],
      )
    )?.m ?? null
    if (isLive) {
      const r = await one<{ amount_cents: number; status: any }>(
        'select amount_cents, status from live_bid_requests where item_id = $1 and bidder_id = $2 order by created_at desc limit 1',
        [item.id, bidder.id],
      )
      if (r && r.status !== 'superseded') myRequest = { amountCents: r.amount_cents, status: r.status }
    }
  }

  const iAmLeading = !!bidder && item.current_bidder_id === bidder.id
  const iWon = !!bidder && winner?.bidder_id === bidder.id
  const hasBid = item.current_bid_cents != null
  const closedMessage =
    item.status === 'provisional'
      ? hasBid
        ? `Bidding is closed. Bidder #${item.leader_number}${iAmLeading ? ' (you)' : ''} leads at ${formatCents(item.current_bid_cents)} — provisional until the last-chance window ends.`
        : 'Bidding is closed. This item has no bids yet; it is in its last-chance window.'
      : item.phase === 'closed'
      ? winner
        ? iWon
          ? `🎉 You won this item for ${formatCents(winner.amount_cents)}!`
          : `Bidding closed. Sold for ${formatCents(winner.amount_cents)} to Bidder #${winner.bidder_number}.`
        : item.status === 'finalized' || item.kind === 'silent'
          ? hasBid ? `Bidding closed. Final bid ${formatCents(item.current_bid_cents)}.` : 'Bidding closed. This item received no bids.'
          : 'Bidding closed. The clerk is confirming the winner.'
      : item.phase === 'paused'
        ? 'The auctioneer has paused bidding for a moment. Hang tight.'
        : isLive && item.phase === 'upcoming'
          ? 'This item hasn’t come up in the live auction yet. Check back when it’s on the block.'
          : item.phase === 'upcoming'
            ? `Bidding opens ${formatInTz(item.silent_start_at, ev.timezone)}.`
            : undefined

  return (
    <div className="space-y-6">
      <LiveRefresh />
      <Link href={isLive ? '/auction?type=live' : '/auction'} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink hover:underline">
        <ArrowLeft className="size-4" /> All {isLive ? 'live' : 'silent'} items
      </Link>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-10">
        <div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border bg-secondary shadow-sm">
            <ItemImage path={item.image_path} title={item.title} />
            <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1.5 text-sm font-bold text-ink shadow-sm">#{item.item_number}</span>
          </div>
          <div className="mt-6 hidden md:block">
            <Description item={item} />
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <PhaseBadge item={item} />
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-muted-foreground ring-1 ring-border">{isLive ? 'Live auction' : 'Silent auction'}</span>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold leading-tight">{item.title}</h1>
            {item.donor_name ? <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Gift className="size-4" /> Donated by {item.donor_name}</p> : null}
          </div>

          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">{hasBid ? (item.phase === 'closed' ? 'Final bid' : isLive ? 'Current accepted bid' : 'Current bid') : 'Starting bid'}</p>
                <p className="tnum text-4xl font-extrabold text-ink" aria-live="polite">{formatCents(hasBid ? item.current_bid_cents : item.starting_bid_cents)}</p>
                {hasBid ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.bid_count} {item.bid_count === 1 ? 'bid' : 'bids'} · leading: <span className="font-semibold text-foreground">Bidder #{item.leader_number}{iAmLeading ? ' (you)' : ''}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No bids yet — be the first!</p>
                )}
              </div>
              {item.kind === 'silent' && item.effective_close ? (
                <div className="text-right text-sm">
                  <p className="flex items-center justify-end gap-1 text-muted-foreground"><Clock className="size-4" /> {item.phase === 'closed' ? 'Closed' : 'Closes'}</p>
                  <p className="font-semibold">{formatInTz(item.effective_close, ev.timezone, { weekday: undefined })}</p>
                  {item.phase === 'open' ? <Countdown closesAt={item.effective_close} className="text-sm" /> : null}
                </div>
              ) : null}
            </div>
          </div>

          {iWon ? (
            <p className="flex items-center gap-2 rounded-xl bg-[#dff3ee] p-4 font-semibold text-[#0f5c4f]"><Trophy className="size-5" /> {closedMessage} Pay at the checkout table to pick it up.</p>
          ) : null}

          {!iWon ? (
            <BidPanel
              mode={isLive ? 'live' : 'silent'}
              itemId={item.id}
              itemNumber={item.item_number}
              signedIn={!!bidder}
              nextPath={`/auction/${item.id}`}
              currentCents={item.current_bid_cents}
              minNextCents={item.min_next_cents}
              incrementCents={item.increment_cents}
              iAmLeading={iAmLeading}
              myTopBidCents={myTop}
              open={item.phase === 'open'}
              closedMessage={closedMessage}
              myRequest={myRequest}
            />
          ) : null}

          {ev.game_mode && bidder && !iWon ? (
            <>
              {item.status === 'provisional' || item.status === 'reopened' ? (
                <p className="rounded-xl bg-secondary p-4 text-sm font-semibold" role="status">
                  {item.status === 'reopened' ? 'This auction was reopened — bidding is open for a short time!' : 'Last-chance window: bidding has closed, but nothing is final yet. Power-Ups can still change the result.'}
                </p>
              ) : null}
              <ItemPowerUps item={{ id: item.id, kind: item.kind, status: item.status, minNextCents: item.min_next_cents }} />
            </>
          ) : null}

          {history.length > 0 ? (
            <section aria-labelledby="hist" className="rounded-xl border bg-card p-5 shadow-sm">
              <h2 id="hist" className="font-bold">Bid history</h2>
              <ul className="mt-3 divide-y text-sm">
                {history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between py-2">
                    <span>Bidder #{h.n}{bidder && bidder.bidder_number === h.n ? <span className="ml-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-ink">you</span> : null}</span>
                    <span className="tnum font-semibold">{formatCents(h.cents)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="md:hidden">
            <Description item={item} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Description({ item }: { item: { description: string; increment_cents: number; starting_bid_cents: number } }) {
  return (
    <section aria-labelledby="desc">
      <h2 id="desc" className="font-bold">About this item</h2>
      <p className="mt-2 whitespace-pre-line text-muted-foreground">{item.description || 'No description yet.'}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-white p-3 ring-1 ring-border"><dt className="text-muted-foreground">Starting bid</dt><dd className="tnum font-bold">{formatCents(item.starting_bid_cents)}</dd></div>
        <div className="rounded-xl bg-white p-3 ring-1 ring-border"><dt className="text-muted-foreground">Bid increment</dt><dd className="tnum font-bold">{formatCents(item.increment_cents)}</dd></div>
      </dl>
    </section>
  )
}
