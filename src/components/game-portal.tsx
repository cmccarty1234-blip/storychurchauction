'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCents, parseDollars } from '@/lib/money'
import { newKey, post } from '@/lib/client'
import { ItemImage } from '@/components/item-card'
import { liveClock, mmss, secsUntil, useGameState, useTicker } from '@/lib/game-client'
import type { StageItem } from '@/lib/game-state'

type Def = { code: string; name: string; description: string; icon: string; priceCents: number; enabled: boolean; category: 'powerup' | 'pie'; kinds: string[]; seconds: number | null }
type Inv = { code: string; name: string; purchased: number; used: number; available: number }
export type Me = { signedIn: boolean; bidderNumber?: number; defs: Def[]; inventory: Inv[]; history: { code: string; name: string; item_number: number; title: string; at: string; headline: string | null }[] }

export function useMe() {
  const [me, setMe] = useState<Me | null>(null)
  const loader = useRef<() => void>(() => {})
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/powerups/me', { cache: 'no-store' })
        if (r.ok && alive) setMe(await r.json())
      } catch {}
    }
    loader.current = () => void load()
    const first = setTimeout(() => void load(), 0)
    const id = setInterval(() => void load(), 10000)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(id)
    }
  }, [])
  return { me, reload: () => loader.current() }
}

// ───────────────────────── using a Power-Up ─────────────────────────
type Ctx = { id: string; kind: 'silent' | 'live'; status: string; minNextCents?: number }

function wanted(code: string, c: Ctx) {
  switch (code) {
    case 'resurrection': return c.status === 'provisional'
    case 'challenge_flag': return c.kind === 'live' && c.status === 'provisional'
    case 'final_call':
    case 'knockout':
    case 'block':
    case 'back_in': return c.status === 'open'
    default: return false
  }
}

export function PowerUpActions({ item, me, onChanged }: { item: Ctx; me: Me | null; onChanged: () => void }) {
  const [openCode, setOpenCode] = useState<string | null>(null)
  if (!me?.signedIn) return null
  const owned = me.inventory.filter((i) => i.available > 0 && me.defs.find((d) => d.code === i.code)?.enabled && wanted(i.code, item) && me.defs.find((d) => d.code === i.code)!.kinds.includes(item.kind))
  if (owned.length === 0) return null
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {owned.map((o) => (
          <button key={o.code} onClick={() => setOpenCode(openCode === o.code ? null : o.code)} aria-expanded={openCode === o.code} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-ink bg-brand-yellow px-4 text-sm font-bold text-ink hover:bg-brand-yellow-hover">
            <Sparkles className="size-4" aria-hidden /> Use {o.name} <span className="rounded-full bg-ink px-1.5 text-xs text-brand-yellow">×{o.available}</span>
          </button>
        ))}
      </div>
      {openCode ? <Activate key={openCode + item.id} code={openCode} item={item} def={me.defs.find((d) => d.code === openCode)!} onDone={() => { setOpenCode(null); onChanged() }} /> : null}
    </div>
  )
}

function Activate({ code, item, def, onDone }: { code: string; item: Ctx; def: Def; onDone: () => void }) {
  const needsBid = code === 'challenge_flag' || code === 'resurrection'
  const needsTarget = code === 'block'
  const [amount, setAmount] = useState(needsBid && item.minNextCents ? String(item.minNextCents / 100) : '')
  const [target, setTarget] = useState('')
  const [plan, setPlan] = useState<{ effect: string; seconds: number | null } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const key = useRef(newKey())
  const body = () => ({ itemId: item.id, code, amountCents: needsBid && amount.trim() ? parseDollars(amount) ?? 0 : undefined, targetNumber: needsTarget ? parseInt(target, 10) || undefined : undefined })

  async function check() {
    setBusy(true)
    setErr(null)
    const r = await post<{ effect: string; seconds: number | null }>('/api/powerups', { action: 'preview', ...body() })
    setBusy(false)
    if (r.ok) setPlan(r.data)
    else {
      setPlan(null)
      setErr(r.error.message)
    }
  }
  async function confirm() {
    setBusy(true)
    const r = await post<{ headline?: string }>('/api/powerups', { action: 'activate', idempotencyKey: key.current, ...body() })
    setBusy(false)
    if (r.ok) {
      setDone(r.data.headline ?? 'Power-Up used!')
      setTimeout(onDone, 2200)
    } else {
      if (r.error.code !== 'NETWORK') key.current = newKey()
      setPlan(null)
      setErr(r.error.message)
    }
  }
  if (done) return <p role="status" className="sc-pop rounded-xl bg-ink px-4 py-3 text-lg font-extrabold text-brand-yellow">{done}</p>
  return (
    <div className="rounded-xl border-2 border-ink bg-white p-4">
      <p className="font-bold">{def.name}</p>
      <p className="text-sm text-muted-foreground">{def.description}</p>
      {needsBid ? (
        <label className="mt-3 block text-sm font-semibold">{code === 'resurrection' ? 'Your bid (optional — clear it to just reopen) $' : 'Your challenging bid $'}<Input value={amount} onChange={(e) => { setAmount(e.target.value); setPlan(null) }} inputMode="decimal" className="mt-1 h-12 text-lg font-bold" /></label>
      ) : null}
      {needsTarget ? (
        <label className="mt-3 block text-sm font-semibold">Paddle number to block<Input value={target} onChange={(e) => { setTarget(e.target.value); setPlan(null) }} inputMode="numeric" className="mt-1 h-12 text-lg font-bold" /></label>
      ) : null}
      {plan ? (
        <div className="mt-3 rounded-lg bg-secondary p-3" role="status">
          <p className="font-semibold">Here’s exactly what will happen:</p>
          <p className="mt-1">{plan.effect}</p>
          <p className="mt-2 text-sm text-muted-foreground">This uses one {def.name} from your inventory. The server decides — if anything has changed, nothing is used.</p>
          <div className="mt-3 flex gap-2">
            <Button variant="bid" className="h-12 flex-1" onClick={confirm} disabled={busy}>{busy ? <Loader2 className="size-5 animate-spin" /> : `Yes — use ${def.name}`}</Button>
            <Button variant="outline" className="h-12" onClick={() => setPlan(null)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button className="mt-3 h-12 w-full" onClick={check} disabled={busy}>{busy ? <Loader2 className="size-5 animate-spin" /> : 'Check what this will do'}</Button>
      )}
      {err ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{err}</p> : null}
    </div>
  )
}

/** Drop-in panel for any item page: shows the guest's usable Power-Ups for that item. */
export function ItemPowerUps({ item }: { item: Ctx }) {
  const { me, reload } = useMe()
  return <PowerUpActions item={item} me={me} onChanged={reload} />
}

// ───────────────────────── the portal ─────────────────────────
export function GamePortal() {
  const { state, online, now, reload } = useGameState(2500)
  const { me, reload: reloadMe } = useMe()
  useTicker(250)
  const [tab, setTab] = useState<'live' | 'inventory' | 'store'>('live')
  if (!state) return <p className="py-10 text-center text-lg">Loading the auction…</p>
  const t = now()
  const refresh = () => { void reload(); void reloadMe() }
  const stage = state.stage
  const chance = [...state.reopened, ...state.lastChance]
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Live &amp; Power-Ups</h1>
        <span className="text-xs text-muted-foreground" role="status">{online ? 'Live' : 'Reconnecting…'}</span>
      </div>
      {state.event.emergency ? <p role="alert" className="rounded-xl bg-red-700 p-4 text-lg font-bold text-white">Bidding is paused for a moment. Please stand by.</p> : null}
      {state.room ? <RoomBanner state={state} now={t} /> : null}

      <div role="tablist" aria-label="Game portal" className="grid grid-cols-3 gap-2">
        {([['live', 'Live auction'], ['inventory', 'My Power-Ups'], ['store', 'Power-Up store']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-12 rounded-xl border-2 border-ink px-2 text-sm font-bold ${tab === k ? 'bg-brand-yellow' : 'bg-white hover:bg-secondary'}`}>{l}</button>
        ))}
      </div>

      {tab === 'live' ? (
        <>
          {stage ? <LiveCard item={stage} state={state} now={t} me={me} onChanged={refresh} /> : (
            <div className="rounded-2xl border bg-card p-6">
              <p className="text-lg font-semibold">No live item is on the block right now.</p>
              {state.nextLive ? <p className="mt-1 text-muted-foreground">Coming up: #{state.nextLive.number} {state.nextLive.title}</p> : null}
            </div>
          )}

          {state.reopened.filter((i) => i.kind === 'live' && i.id !== stage?.id).map((i) => (
            <LiveCard key={i.id} item={i} state={state} now={t} me={me} onChanged={refresh} />
          ))}

          <section aria-labelledby="lc" className="rounded-2xl border-2 border-ink bg-white p-4">
            <h2 id="lc" className="text-2xl">Last chance</h2>
            <p className="text-sm text-muted-foreground">These auctions have closed but are not final. The leader shown is provisional — they have not won yet.</p>
            {chance.length === 0 ? <p className="mt-3 text-muted-foreground">Nothing in its last-chance window right now.</p> : null}
            <div className="mt-3 space-y-3">
              {chance.map((i) => (
                <div key={i.id} className="rounded-xl border p-3">
                  <div className="flex gap-3">
                    <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-secondary"><ItemImage path={i.imagePath} title="" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">#{i.number} {i.title}</p>
                      <p className="tnum text-xl font-extrabold">{formatCents(i.currentBidCents)} <span className="text-sm font-semibold text-muted-foreground">provisional · bidder #{i.leaderNumber ?? '—'}{me?.bidderNumber === i.leaderNumber ? ' (you!)' : ''}</span></p>
                      <p className="text-sm">
                        {i.status === 'reopened' ? <b className="text-danger">REOPENED — {mmss(secsUntil(i.deadlineAt, t))} to bid!</b> : <><Timer className="mr-1 inline size-4" aria-hidden />Window closes in <b className="tnum">{mmss(secsUntil(i.provisionalUntil, t))}</b></>}
                        {' · '}{i.reopenUsed ? 'Resurrection used' : 'Resurrection available'}
                      </p>
                    </div>
                  </div>
                  {i.status === 'reopened' ? <Link href={i.kind === 'live' ? '/play' : `/auction/${i.id}`} className="mt-2 inline-block text-sm font-semibold underline">{i.kind === 'silent' ? 'Open item to bid' : ''}</Link> : null}
                  {i.status === 'provisional' ? (
                    <>
                      {me?.signedIn ? null : <p className="mt-2 text-sm">Register to use Power-Ups.</p>}
                      <PowerUpActions item={{ id: i.id, kind: i.kind, status: i.status, minNextCents: i.minNextCents }} me={me} onChanged={refresh} />
                      {i.kind === 'silent' ? <Link href={`/auction/${i.id}`} className="mt-2 inline-block text-sm font-semibold underline">View item</Link> : null}
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          <section aria-labelledby="act" className="rounded-2xl border bg-card p-4">
            <h2 id="act" className="text-2xl">What’s happening</h2>
            <ul className="mt-2 space-y-1.5">
              {state.announcements.filter((a) => a.kind !== 'item.provisional').slice(0, 8).map((a) => (
                <li key={a.id} className="text-sm"><b>{a.headline}</b>{a.body ? <span className="text-muted-foreground"> — {a.body}</span> : null}</li>
              ))}
              {state.announcements.every((a) => a.kind === 'item.provisional') ? <li className="text-sm text-muted-foreground">Activity will appear here as it happens.</li> : null}
            </ul>
          </section>
        </>
      ) : null}

      {tab === 'inventory' ? <Inventory me={me} /> : null}
      {tab === 'store' ? <Store me={me} /> : null}
    </div>
  )
}

function RoomBanner({ state, now }: { state: NonNullable<ReturnType<typeof useGameState>['state']>; now: number }) {
  const r = state.room!
  const secs = secsUntil(r.endsAt, now)
  return (
    <div className="rounded-2xl bg-ink p-4 text-white" role="status">
      {r.code === 'lightning' ? <p className="font-heading text-2xl text-brand-yellow">⚡ LIGHTNING ROUND! <span className="tnum">{mmss(secs)}</span></p> : null}
      {r.code === 'lightning' ? <p className="text-sm">Bids on silent items {(r.lightningItems ?? []).map((n) => `#${n}`).join(', ')} go up by just $1 right now.</p> : null}
      {r.code === 'battle' ? <p className="font-heading text-2xl text-brand-yellow">BATTLE OF THE ROOM! <span className="tnum">{mmss(secs)}</span></p> : null}
      {r.code === 'battle' && r.battle ? <p className="text-sm">Gold {r.battle.gold.points} — Black {r.battle.black.points}. Game points, not dollars: 10 per accepted bid + 1 per $10 it raises the price.</p> : null}
      {r.code === 'jackpot' ? <p className="font-heading text-2xl text-brand-yellow">MYSTERY JACKPOT! Everyone registered is in.</p> : null}
    </div>
  )
}

function LiveCard({ item, state, now, me, onChanged }: { item: StageItem; state: ReturnType<typeof useGameState>['state'] & object; now: number; me: Me | null; onChanged: () => void }) {
  const clock = liveClock(item, now, !!state.event.emergency)
  const [amount, setAmount] = useState(String(item.minNextCents / 100))
  const [fb, setFb] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const key = useRef(newKey())
  const touched = useRef(false)
  useEffect(() => {
    const id = setTimeout(() => {
      setAmount((cur) => {
        if (!touched.current || (parseDollars(cur) ?? 0) < item.minNextCents) {
          touched.current = false
          return String(item.minNextCents / 100)
        }
        return cur
      })
    }, 0)
    return () => clearTimeout(id)
  }, [item.minNextCents])
  const mine = me?.bidderNumber != null && me.bidderNumber === item.leaderNumber
  const recent = state.recentBids.filter((b) => b.itemNumber === item.number).slice(0, 4)
  async function bid(e: React.FormEvent) {
    e.preventDefault()
    const cents = parseDollars(amount)
    if (cents == null) return setFb({ ok: false, text: 'Enter a bid amount in dollars.' })
    setBusy(true)
    const r = await post<{ accepted?: boolean }>('/api/bids/live-request', { itemId: item.id, amountCents: cents, idempotencyKey: key.current })
    setBusy(false)
    if (r.ok) {
      key.current = newKey()
      touched.current = false
      setFb({ ok: true, text: r.data.accepted ? `Accepted! You lead at ${formatCents(cents)}.` : `Request sent for ${formatCents(cents)} — waiting for the clerk.` })
    } else {
      if (r.error.code !== 'NETWORK') key.current = newKey()
      setFb({ ok: false, text: r.error.message })
    }
    onChanged()
  }
  const hot = clock && !clock.frozen && clock.secs <= state.event.warningSeconds
  return (
    <section aria-label="Live auction item" className={`rounded-2xl border-2 bg-white p-4 ${hot ? 'border-red-600' : 'border-ink'}`}>
      <div className="flex gap-3">
        <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-secondary"><ItemImage path={item.imagePath} title={item.title} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{item.status === 'reopened' ? (item.timerPhase === 'challenge' ? 'Challenge — everyone can respond' : 'Reopened — bid now') : 'On the block now'} · item #{item.number}</p>
          <h2 className="truncate text-2xl">{item.title}</h2>
          <p className="tnum text-3xl font-extrabold">{item.currentBidCents != null ? formatCents(item.currentBidCents) : 'Open'}</p>
          <p className="text-sm font-semibold">{mine ? <span className="text-[#0f5c4f]">You’re leading!</span> : item.leaderNumber ? `Bidder #${item.leaderNumber} leads` : 'No bids yet'}</p>
        </div>
        {clock ? (
          <div className={`flex flex-col items-center justify-center rounded-xl px-3 ${hot ? 'bg-red-600 text-white' : 'bg-ink text-white'}`}>
            <span className="tnum font-heading text-4xl">{mmss(clock.secs)}</span>
            <span className="text-[10px] font-bold tracking-widest">{clock.label}</span>
          </div>
        ) : null}
      </div>
      {me?.signedIn ? (
        <form onSubmit={bid} className="mt-4">
          <label htmlFor="live-bid" className="text-sm font-semibold">Your bid (next minimum {formatCents(item.minNextCents)})</label>
          <div className="mt-1 flex gap-2">
            <span className="self-center text-2xl font-bold text-muted-foreground">$</span>
            <Input id="live-bid" inputMode="decimal" value={amount} onChange={(e) => { touched.current = true; setAmount(e.target.value) }} className="h-14 text-2xl font-bold" />
            <Button type="submit" variant="bid" size="lg" className="h-14 px-6 text-lg" disabled={busy || mine || (item.status !== 'open' && item.status !== 'reopened')}>{busy ? <Loader2 className="size-5 animate-spin" /> : 'Bid'}</Button>
          </div>
          {item.status === 'paused' ? <p className="mt-2 text-sm font-semibold">Paused by the hosts — bidding resumes in a moment.</p> : null}
          <div aria-live="polite" className="min-h-6">{fb ? <p role={fb.ok ? 'status' : 'alert'} className={`mt-2 rounded-lg px-3 py-2 text-sm font-medium ${fb.ok ? 'bg-[#dff3ee] text-[#0f5c4f]' : 'bg-red-50 text-red-800'}`}>{fb.text}</p> : null}</div>
        </form>
      ) : (
        <Link href="/register?next=/play" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand-yellow px-5 font-bold">Register to bid</Link>
      )}
      <PowerUpActions item={{ id: item.id, kind: 'live', status: item.status, minNextCents: item.minNextCents }} me={me} onChanged={onChanged} />
      {recent.length ? <ul className="mt-3 space-y-0.5 text-sm text-muted-foreground">{recent.map((b, i) => <li key={i}>Bidder #{b.bidderNumber} bid {formatCents(b.amountCents)}</li>)}</ul> : null}
    </section>
  )
}

function Inventory({ me }: { me: Me | null }) {
  if (!me) return <p>Loading…</p>
  if (!me.signedIn) return <p className="rounded-xl border bg-card p-5">Register or sign in to see your Power-Ups. <Link href="/register?next=/play" className="font-semibold underline">Register</Link></p>
  const owned = me.inventory.filter((i) => i.purchased > 0)
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-2xl">My Power-Ups</h2>
        {owned.length === 0 ? <p className="mt-2 text-muted-foreground">You don’t have any yet. Buy them at the bidding desk — they show up here instantly.</p> : null}
        <ul className="mt-3 divide-y">
          {owned.map((i) => (
            <li key={i.code} className="flex items-center justify-between py-2"><span className="font-semibold">{i.name}</span><span className="tnum text-sm">{i.code.startsWith('pie_') ? `${i.available} to throw — you'll be called up at the end of the night · ${i.used} thrown` : `${i.available} available · ${i.used} used`}</span></li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted-foreground">Open an item that is eligible (the live item, or one in Last chance) and tap “Use”.</p>
      </section>
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="text-2xl">History</h2>
        {me.history.length === 0 ? <p className="mt-2 text-muted-foreground">Nothing used yet.</p> : <ul className="mt-2 space-y-1 text-sm">{me.history.map((h, i) => <li key={i}><b>{h.name}</b> on #{h.item_number} {h.title} — {new Date(h.at).toLocaleTimeString()}</li>)}</ul>}
      </section>
    </div>
  )
}

function Store({ me }: { me: Me | null }) {
  if (!me) return <p>Loading…</p>
  return (
    <section className="space-y-3">
      <p className="rounded-xl bg-secondary p-4 text-sm font-semibold">Power-Ups are bought in person at the bidding desk (cash, check or card). Tell the volunteer your paddle number{me.bidderNumber ? ` — yours is #${me.bidderNumber}` : ''}. They’ll appear in “My Power-Ups” right away. There is no online payment.</p>
      {me.defs.filter((d) => d.category !== 'pie').map((d) => (
        <div key={d.code} className={`rounded-2xl border bg-card p-4 ${d.enabled ? '' : 'opacity-60'}`}>
          <div className="flex items-baseline justify-between gap-3"><h3 className="text-xl font-extrabold">{d.name}</h3><span className="tnum text-xl font-extrabold">{formatCents(d.priceCents)}</span></div>
          <p className="mt-1">{d.description}</p>
          <p className="mt-1 text-sm text-muted-foreground">Works on: {d.kinds.join(' & ')} auctions{d.enabled ? '' : ' · not available tonight'}</p>
        </div>
      ))}
      {me.defs.some((d) => d.category === 'pie') ? (
        <div className="rounded-2xl border-2 border-ink bg-brand-yellow p-4">
          <h3 className="text-xl font-extrabold">🥧 Pie Brandon in the Face!</h3>
          <p className="mt-1 font-semibold">Sign up all night at the Bid Desk. At the end of the night you&rsquo;ll be called up to throw it.</p>
          <ul className="mt-2 space-y-1">
            {me.defs.filter((d) => d.category === 'pie' && d.enabled).map((d) => (
              <li key={d.code} className="flex items-baseline justify-between"><span className="font-bold">{d.code === 'pie_large' ? 'Large pie' : 'Small pie'}</span><span className="tnum text-xl font-extrabold">{formatCents(d.priceCents)}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
