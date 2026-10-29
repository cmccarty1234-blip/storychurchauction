import Link from 'next/link'
import { ArrowRight, CalendarDays, Clock, Gavel, MapPin, Radio, Smartphone, UserRound } from 'lucide-react'
import { getEvent } from '@/lib/events'
import { currentLiveItem, listItems } from '@/lib/queries'
import { getBidder } from '@/lib/session'
import { formatCents } from '@/lib/money'
import { formatInTz, nowMs } from '@/lib/time'
import { linkButton } from '@/components/ui/button'
import { LiveRefresh } from '@/components/live-refresh'
import { Countdown } from '@/components/countdown'
import { PiePromo } from '@/components/pie-promo'

export default async function HomePage() {
  const ev = await getEvent()
  const [bidder, live, items] = await Promise.all([getBidder(), currentLiveItem(ev.id), listItems(ev.id)])
  const silent = items.filter((i) => i.kind === 'silent')
  const closes = ev.silent_close_at
  const silentClosed = closes != null && closes.getTime() <= nowMs()
  const eventDay = ev.event_date ? new Date(`${ev.event_date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : null
  const eventName = ev.name.replace(/\s*\(DEMO\)\s*$/, '')

  return (
    <div className="space-y-12 sm:space-y-16">
      <LiveRefresh />

      <section aria-labelledby="hero" className="pt-4 sm:pt-10">
        <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-wide text-ink">
          <span className="h-0.5 w-10 bg-gold" aria-hidden /> {eventName}
        </p>
        <h1 id="hero" className="mt-4 text-[44px] uppercase leading-[0.95] text-ink sm:text-7xl lg:text-[88px]">
          Your story<br />matters.
        </h1>
        <span className="mt-5 block h-2 w-28 rounded-full bg-brand-yellow" aria-hidden />
        <p className="mt-5 max-w-xl text-lg text-charcoal sm:text-xl">
          Join StoryChurch for a community auction where every bid supports a greater purpose.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link href="/auction" className={linkButton({ size: 'lg', variant: 'default' }, 'h-14 px-8 text-base uppercase tracking-wide')}>
            Browse auction items <ArrowRight className="size-5" />
          </Link>
          <a href="#event" className={linkButton({ size: 'lg', variant: 'outline' }, 'h-14 px-8 text-base uppercase tracking-wide')}>
            View event details
          </a>
        </div>
        {bidder ? (
          <p className="mt-5 text-sm font-semibold">You’re registered · Bidder #{bidder.bidder_number}</p>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            New here? <Link href="/register" className="font-semibold text-ink underline underline-offset-2">Register in about a minute</Link> — just your name and a phone number or email.
          </p>
        )}
      </section>

      <PiePromo eventId={ev.id} />

      {live ? (
        <Link href={`/auction/${live.id}`} className="flex items-center justify-between gap-4 rounded-xl border-2 border-ink bg-white p-5 shadow-sm transition hover:bg-ivory">
          <div className="flex items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ink text-brand-yellow"><Radio className="size-6" /></span>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-danger">Live auction · on the block now</p>
              <p className="text-lg font-bold">#{live.item_number} · {live.title}</p>
              <p className="tnum text-sm text-muted-foreground">Current bid {formatCents(live.current_bid_cents ?? live.starting_bid_cents)}</p>
            </div>
          </div>
          <ArrowRight className="size-6 shrink-0" />
        </Link>
      ) : null}

      <section aria-labelledby="how">
        <h2 id="how" className="text-[28px] uppercase sm:text-4xl">How it works</h2>
        <ol className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
          {[
            { icon: UserRound, t: '1. Register', d: 'Enter your name and a phone number or email. You get a bidder number and a PIN right away.' },
            { icon: Gavel, t: '2. Bid', d: `Browse ${silent.length} silent auction items. Tap one, enter your bid, and watch it update live.` },
            { icon: Smartphone, t: '3. Join the live auction', d: 'During the live auction, raise your paddle — or request a bid from your phone.' },
          ].map(({ icon: Icon, t, d }) => (
            <li key={t} className="rounded-xl border bg-card p-6 shadow-sm">
              <span className="flex size-11 items-center justify-center rounded-lg bg-brand-yellow"><Icon className="size-6" aria-hidden /></span>
              <h3 className="mt-4 text-lg">{t}</h3>
              <p className="mt-1 text-muted-foreground">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="event" aria-labelledby="details" className="scroll-mt-24">
        <h2 id="details" className="text-[28px] uppercase sm:text-4xl">Event details</h2>
        <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <dt className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><CalendarDays className="size-4" aria-hidden /> Event date</dt>
            <dd className="mt-2 text-lg font-bold">{eventDay ?? 'To be announced'}</dd>
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <dt className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Clock className="size-4" aria-hidden /> Silent auction {silentClosed ? 'closed' : 'closes'}</dt>
            <dd className="mt-2 text-lg font-bold">{closes ? formatInTz(closes, ev.timezone) : 'To be announced'}</dd>
            {closes && !silentClosed ? <dd className="mt-1 text-sm text-muted-foreground"><Countdown closesAt={closes} /></dd> : null}
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <dt className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><MapPin className="size-4" aria-hidden /> Where & contact</dt>
            <dd className="mt-2 font-semibold">{ev.contact_info || 'Story Church'}</dd>
          </div>
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <dt className="flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Gavel className="size-4" aria-hidden /> Checkout & pickup</dt>
            <dd className="mt-2 text-sm">{ev.pickup_instructions || 'Pay in person at the checkout table (cash, check, or card terminal).'}</dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
