'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertOctagon, Check, Megaphone, Pause, Play, Plus, Radio, Square, Timer, Tv, X } from 'lucide-react'
import { COMMERCIALS } from '@/lib/commercials'
import { newKey, post } from '@/lib/client'
import { formatCents, parseDollars } from '@/lib/money'
import { liveClock, mmss, secsUntil, useGameState, useTicker } from '@/lib/game-client'

type HostData = {
  queue: { id: string; item_number: number; title: string; starting_bid_cents: number; min_qualifying_bid_cents: number | null }[]
  silent: { id: string; item_number: number; title: string }[]
  pending: { id: string; amount_cents: number; bidder_number: number; name: string }[]
  recentActs: { name: string; bidder_number: number; item_number: number; created_at: string }[]
  rooms: { code: string; name: string; enabled: boolean; config: Record<string, unknown> }[]
  wheelbarrow: { totalCents: number; floorCents: number; noBidItems: number; items: number }
  pies: { smallSold: number; largeSold: number; smallLeft: number; largeLeft: number; thrown: number; cents: number; line: { bidderNumber: number; name: string; size: 'small' | 'large'; code: string }[] }
}

const big = 'min-h-14 rounded-xl px-5 text-lg font-bold transition active:scale-[0.98] disabled:opacity-40'
const gold = `${big} bg-brand-yellow text-ink hover:bg-brand-yellow-hover`
const dark = `${big} bg-ink text-white hover:bg-charcoal`
const ghost = `${big} border-2 border-ink bg-white text-ink hover:bg-secondary`
const danger = `${big} bg-red-700 text-white hover:bg-red-800`

export function HostConsole({ isAdmin }: { isAdmin: boolean }) {
  const { state, online, now, reload } = useGameState(1000)
  useTicker(250)
  const [data, setData] = useState<HostData | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [armed, setArmed] = useState<string | null>(null)
  const [paddle, setPaddle] = useState('')
  const [amount, setAmount] = useState('')
  const [announce, setAnnounce] = useState('')
  const [prize, setPrize] = useState('')
  const [reason, setReason] = useState('')
  const [promo, setPromo] = useState<Record<string, string>>({})
  const key = useRef(newKey())
  const touched = useRef(false)

  const loadRef = useRef<() => void>(() => {})
  const watch = `${state?.stage?.id}|${state?.stage?.currentBidCents}|${state?.room?.id}`
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch('/api/admin/show', { cache: 'no-store' })
        if (r.ok && alive) setData(await r.json())
      } catch {}
    }
    loadRef.current = () => void load()
    const first = setTimeout(() => void load(), 0)
    const id = setInterval(() => void load(), 3000)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(id)
    }
  }, [watch])
  const loadData = () => loadRef.current()

  const stage = state?.stage ?? null
  const minNext = stage?.minNextCents
  useEffect(() => {
    if (minNext == null) return
    const id = setTimeout(() => {
      setAmount((cur) => {
        if (!touched.current || (parseDollars(cur) ?? 0) < minNext) {
          touched.current = false
          return String(minNext / 100)
        }
        return cur
      })
    }, 0)
    return () => clearTimeout(id)
  }, [stage?.id, minNext])

  async function run(url: string, body: Record<string, unknown>, okText?: string) {
    setBusy(true)
    const r = await post(url, body)
    setBusy(false)
    setArmed(null)
    if (r.ok) {
      if (okText) setMsg({ ok: true, text: okText })
      else setMsg(null)
    } else setMsg({ ok: false, text: r.error.message })
    void reload()
    void loadData()
    return r
  }
  const show = (body: Record<string, unknown>, okText?: string) => run('/api/admin/show', body, okText)
  const live = (body: Record<string, unknown>, okText?: string) => run('/api/admin/live', body, okText)
  /** Two-tap safety for disruptive controls. */
  const confirmed = (id: string, fn: () => void) => {
    if (armed === id) fn()
    else {
      setArmed(id)
      setTimeout(() => setArmed((a) => (a === id ? null : a)), 3500)
    }
  }

  if (!state) return <p className="p-6 text-lg">Loading the show…</p>
  const t = now()
  const clock = stage ? liveClock(stage, t, !!state.event.emergency) : null
  const room = state.room
  // The server keeps reporting a break for a while past the video's length (so a late or ad-delayed video isn't cut); the host only cares while it is really running.
  const playing = state.commercial && secsUntil(state.commercial.endsAt, t) > 0 ? state.commercial : null
  const sessionRoom = (code: string) => data?.rooms.find((r) => r.code === code)

  async function sendPaddle(e: React.FormEvent) {
    e.preventDefault()
    if (!stage) return
    const p = parseInt(paddle, 10)
    const cents = parseDollars(amount)
    if (!Number.isInteger(p) || cents == null) return setMsg({ ok: false, text: 'Enter the paddle number and the amount.' })
    const r = await live({ action: 'paddle', itemId: stage.id, paddleNumber: p, amountCents: cents, idempotencyKey: key.current }, `Bid accepted: #${p} at ${formatCents(cents)}`)
    if (r.ok || r.error.code !== 'NETWORK') key.current = newKey()
    if (r.ok) {
      setPaddle('')
      touched.current = false
    }
  }

  return (
    <div className="space-y-4">
      {state.event.emergency ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-700 p-4 text-white">
          <p className="text-xl font-bold">EMERGENCY STOP — all bidding and clocks are frozen. {state.event.emergency.reason}</p>
          <button className={`${big} bg-white text-red-800`} disabled={busy} onClick={() => show({ action: 'emergency-release' }, 'Bidding resumed.')}>Resume bidding</button>
        </div>
      ) : null}
      {!online ? <p className="rounded-xl bg-amber-200 p-3 font-bold text-amber-950">Connection lost — reconnecting. Controls may not work until it returns.</p> : null}
      {msg ? <p role="status" className={`rounded-xl p-3 text-lg font-semibold ${msg.ok ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`}>{msg.text}</p> : null}

      {data?.wheelbarrow ? (
        <p className="rounded-xl bg-brand-yellow p-3 text-lg font-bold" title="The least we raise if every item sells for at least its minimum, plus Power-Up and pie sales">
          Wheelbarrow (minimum if every item sells): <span className="tnum">{formatCents(data.wheelbarrow.totalCents)}</span>
          <span className="block text-sm font-semibold">{data.wheelbarrow.items} items · {data.wheelbarrow.noBidItems} with no bids yet</span>
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          ['Committed (bids)', state.totals.leadingCents + state.totals.finalizedCents],
          ['Won (final)', state.totals.finalizedCents],
          ['Power-Up sales', state.totals.powerupCents],
          ['Payments received', state.totals.paymentsCents],
          ['Still owed', state.totals.outstandingCents],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border bg-card p-3"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{l}</p><p className="tnum text-2xl font-extrabold">{formatCents(v as number)}</p></div>
        ))}
      </div>

      {/* ── On the block ── */}
      <section className="rounded-2xl border-2 border-ink bg-white p-4">
        <h2 className="mb-2 flex items-center gap-2 text-2xl"><Radio className="size-6" /> On the block</h2>
        {stage ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
            <div>
              <p className="text-3xl font-extrabold">#{stage.number} {stage.title}</p>
              <p className="tnum mt-1 text-5xl font-extrabold">{stage.currentBidCents != null ? formatCents(stage.currentBidCents) : 'No bids yet'}</p>
              <p className="mt-1 text-xl">{stage.leaderNumber ? `Leader: bidder #${stage.leaderNumber}` : 'Waiting for the first bid'} · next bid {formatCents(stage.minNextCents)} · {stage.bidCount} bids</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{clock?.label} · {stage.timerPhase === 'initial' ? 'opening period' : stage.timerPhase === 'countdown' ? 'inactivity countdown' : ''}</p>
              <p className={`tnum font-heading text-7xl ${clock && !clock.frozen && clock.secs <= state.event.warningSeconds ? 'text-red-700' : ''}`}>{clock ? mmss(clock.secs) : '—'}</p>
              {stage.deadlineAt && stage.status === 'open' ? <p className="text-xs text-muted-foreground">server deadline {new Date(stage.deadlineAt).toLocaleTimeString()}</p> : null}
            </div>
            <div className="flex flex-wrap gap-2 lg:col-span-2">
              {stage.status === 'paused' ? (
                <button className={gold} disabled={busy} onClick={() => live({ action: 'resume', itemId: stage.id })}><Play className="mr-1 inline size-5" /> Resume</button>
              ) : (
                <button className={ghost} disabled={busy} onClick={() => live({ action: 'pause', itemId: stage.id })}><Pause className="mr-1 inline size-5" /> Pause</button>
              )}
              <button className={ghost} disabled={busy || stage.status !== 'open'} onClick={() => show({ action: 'extend', itemId: stage.id, seconds: 15 })}><Timer className="mr-1 inline size-5" /> +15 s</button>
              <button className={dark} disabled={busy} onClick={() => confirmed('end', () => live({ action: 'close', itemId: stage.id, confirmed: true }, 'Bidding ended — last-chance window started.'))}>
                <Square className="mr-1 inline size-5" /> {armed === 'end' ? 'Tap again to end bidding' : 'End bidding'}
              </button>
              <button className={danger} disabled={busy || !!state.event.emergency} onClick={() => confirmed('stop', () => show({ action: 'emergency-stop', reason: reason || 'Host stop' }, 'EMERGENCY STOP in force.'))}>
                <AlertOctagon className="mr-1 inline size-5" /> {armed === 'stop' ? 'Tap again to STOP EVERYTHING' : 'Emergency stop'}
              </button>
              <input aria-label="Emergency stop reason" placeholder="Reason (optional)" className="h-14 min-w-0 flex-1 rounded-xl border px-3" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <form onSubmit={sendPaddle} className="flex flex-wrap items-end gap-3 rounded-xl bg-secondary p-3 lg:col-span-2">
              <label className="font-semibold">Paddle #<input inputMode="numeric" value={paddle} onChange={(e) => setPaddle(e.target.value)} className="mt-1 block h-14 w-32 rounded-xl border px-3 text-2xl font-bold" /></label>
              <label className="font-semibold">Amount $<input inputMode="decimal" value={amount} onChange={(e) => { touched.current = true; setAmount(e.target.value) }} className="mt-1 block h-14 w-40 rounded-xl border px-3 text-2xl font-bold" /></label>
              <button type="submit" className={gold} disabled={busy || stage.status === 'paused'}><Check className="mr-1 inline size-5" /> Enter paddle bid</button>
            </form>
            {data && data.pending.length ? (
              <div className="lg:col-span-2">
                <p className="font-bold">Phone bids waiting for you (auto-accept is off):</p>
                {data.pending.map((p) => (
                  <div key={p.id} className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="tnum text-lg">#{p.bidder_number} {p.name} — {formatCents(p.amount_cents)}</span>
                    <button className={gold} onClick={() => live({ action: 'accept', requestId: p.id })}>Accept</button>
                    <button className={ghost} onClick={() => live({ action: 'reject', requestId: p.id })}><X className="inline size-5" /></button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-lg text-muted-foreground">No live item is on the block. Start the next one below.</p>
        )}
      </section>

      {/* ── Queue ── */}
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="mb-2 text-2xl">Up next</h2>
        {data?.queue.length ? (
          <ul className="space-y-2">
            {data.queue.map((q, i) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                <span className="text-lg font-semibold">#{q.item_number} {q.title} <span className="font-normal text-muted-foreground">· opens at {formatCents(q.starting_bid_cents)}{q.min_qualifying_bid_cents != null ? ` · Knockout unlocks at ${formatCents(q.min_qualifying_bid_cents)}` : ''}</span></span>
                <span className="flex flex-wrap gap-2">
                  <button className={i === 0 ? gold : ghost} disabled={busy || !!stage || !!state.event.emergency} onClick={() => live({ action: 'start', itemId: q.id }, `Started #${q.item_number} — bidding opens when its commercial ends.`)}><Play className="mr-1 inline size-5" /> Start with video</button>
                  <button className={ghost} disabled={busy || !!stage || !!state.event.emergency} onClick={() => live({ action: 'start', itemId: q.id, withVideo: false }, `Started #${q.item_number} — bidding is open.`)}>Start without video</button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No live items waiting. (Items must be shown to guests first.)</p>
        )}
      </section>

      {/* ── Last chance ── */}
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="mb-2 text-2xl">Last-chance window</h2>
        {state.lastChance.length + state.reopened.length === 0 ? <p className="text-muted-foreground">Nothing is in its last-chance window.</p> : null}
        <ul className="space-y-2">
          {[...state.reopened, ...state.lastChance].map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
              <span className="text-lg"><b>#{i.number}</b> {i.title} — {formatCents(i.currentBidCents)} — provisional winner #{i.leaderNumber ?? '—'}{i.status === 'reopened' ? ` · REOPENED ${mmss(secsUntil(i.deadlineAt, t))}` : ''}</span>
              <span className="flex items-center gap-3">
                <span className="tnum text-2xl font-bold">{mmss(secsUntil(i.provisionalUntil, t))}</span>
                <button className={ghost} disabled={busy} onClick={() => confirmed(`fin-${i.id}`, () => show({ action: 'finalize-now', itemId: i.id }, `#${i.number} finalized.`))}>{armed === `fin-${i.id}` ? 'Tap again to finalize' : 'Finalize now'}</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Room Events ── */}
      <section className="rounded-2xl border bg-card p-4">
        <h2 className="mb-2 text-2xl">Room Events</h2>
        {room ? (
          <div className="space-y-3">
            <p className="text-xl font-bold">Running: {room.code === 'lightning' ? 'Lightning Round' : room.code === 'battle' ? 'Battle of the Room' : 'Mystery Jackpot'} {room.endsAt ? <span className="tnum ml-2">{mmss(secsUntil(room.endsAt, t))}</span> : null}</p>
            {room.code === 'battle' && room.battle ? <p className="tnum text-lg">Gold {room.battle.gold.points} — Black {room.battle.black.points}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {room.code === 'jackpot' ? (
                <>
                  <button className={gold} disabled={busy} onClick={() => show({ action: 'jackpot-draw', sessionId: room.id }, 'Winner drawn — see the projector.')}>Draw winner</button>
                  <input aria-label="Redraw reason" placeholder="Reason for a redraw" className="h-14 min-w-0 rounded-xl border px-3" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button className={ghost} disabled={busy || !reason.trim()} onClick={() => show({ action: 'jackpot-draw', sessionId: room.id, reason }, 'Redrawn.')}>Redraw</button>
                </>
              ) : null}
              <button className={dark} disabled={busy} onClick={() => show({ action: 'room-end', sessionId: room.id }, 'Room Event ended.')}>End it now</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button className={gold} disabled={busy || !sessionRoom('lightning')?.enabled} onClick={() => show({ action: 'room-start', code: 'lightning' }, 'Lightning Round started!')}>⚡ Lightning Round</button>
            <button className={gold} disabled={busy || !sessionRoom('battle')?.enabled} onClick={() => show({ action: 'room-start', code: 'battle' }, 'Battle of the Room started!')}>Battle of the Room</button>
            <input aria-label="Jackpot prize" placeholder="Jackpot prize" className="h-14 min-w-0 rounded-xl border px-3" value={prize} onChange={(e) => setPrize(e.target.value)} />
            <button className={gold} disabled={busy || !sessionRoom('jackpot')?.enabled} onClick={() => show({ action: 'room-start', code: 'jackpot', prize: prize || undefined }, 'Mystery Jackpot ready — press Draw winner.')}>Mystery Jackpot</button>
          </div>
        )}
        <p className="mt-2 text-sm text-muted-foreground">Lightning Round: $1 bids on every open silent item for 60 s. Battle: teams are dealt automatically. Jackpot: a random registered guest, auditable.</p>
      </section>

      {/* ── Power-Ups & projector ── */}
      {/* ── Pie Brandon in the Face (finale) ── */}
      <section className="rounded-2xl border-2 border-ink bg-brand-yellow p-4">
        <h2 className="mb-1 text-2xl">🥧 Pie Brandon in the Face</h2>
        {data?.pies ? (
          <>
            <p className="text-lg font-bold">{data.pies.smallLeft + data.pies.largeLeft} pies still to throw ({data.pies.smallLeft} small, {data.pies.largeLeft} large) · {formatCents(data.pies.cents)} raised · {data.pies.thrown} thrown</p>
            {data.pies.line.length === 0 ? <p className="mt-2">Nobody is waiting yet. Sign-ups are sold online and at the Bid Desk all night.</p> : null}
            <ul className="mt-2 space-y-2">
              {data.pies.line.map((p, i) => (
                <li key={`${p.bidderNumber}-${p.code}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white p-3">
                  <span className="text-lg font-bold">{i === 0 ? 'NEXT: ' : ''}#{p.bidderNumber} {p.name} — {p.size === 'large' ? 'LARGE pie' : 'small pie'}</span>
                  <button className={i === 0 ? dark : ghost} disabled={busy} onClick={() => show({ action: 'pie-throw', bidderNumber: p.bidderNumber, code: p.code }, `SPLAT! #${p.bidderNumber} threw a ${p.size} pie.`)}>Splat!</button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={dark} disabled={busy} onClick={() => show({ action: 'display', mode: 'pie' }, 'Projector: pie finale.')}>Show the pie screen</button>
            </div>
            <p className="mt-2 text-sm font-semibold">People are called up in the order they signed up. Tap Splat! as each pie is thrown — it can&rsquo;t be thrown twice.</p>
          </>
        ) : <p>Loading…</p>}
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="mb-1 text-2xl">Chili cook-off</h2>
        <p className="mb-3 text-sm text-muted-foreground">$1 = 1 vote; the chili with the most dollars wins. Guests vote at /chili and pay at checkout.</p>
        <div className="flex flex-wrap gap-2">
          {([['off', 'Hidden'], ['open', 'Open voting'], ['closed', 'Close voting']] as const).map(([s, label]) => (
            <button key={s} className={state.chili.state === s ? gold : ghost} aria-pressed={state.chili.state === s} disabled={busy} onClick={() => show({ action: 'chili-state', state: s }, `Chili: ${label}.`)}>{label}</button>
          ))}
          <button className={dark} disabled={busy} onClick={() => show({ action: 'display', mode: 'chili' }, 'Projector: chili board.')}>Show the chili board</button>
        </div>
        <ol className="mt-3 space-y-1 text-lg">
          {state.chili.entries.map((e, i) => <li key={e.id}><b>{i + 1}.</b> #{e.number} {e.name} — <b className="tnum">{formatCents(e.cents)}</b> ({e.voters} voter{e.voters === 1 ? '' : 's'})</li>)}
        </ol>
        <p className="mt-1 text-sm font-semibold">Total raised: {formatCents(state.chili.totalCents)}</p>
      </section>

      <section className="rounded-2xl border bg-card p-4">
        <h2 className="mb-1 flex items-center gap-2 text-2xl"><Tv className="size-6" /> Commercial breaks</h2>
        <p className="mb-3 text-sm text-muted-foreground">Takes over the projector with a retro TV commercial. Pick a silent item to promote underneath it, then tap Play. The projector needs internet.</p>
        {playing ? (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-brand-yellow px-4 py-3 text-ink">
            <p className="min-w-0 flex-1 font-bold">On the projector now: {playing.title} · {mmss(secsUntil(playing.endsAt, t))} left</p>
            <button className={dark} disabled={busy} onClick={() => show({ action: 'commercial-stop' }, playing.opensItem ? 'Skipped — bidding is open.' : 'Commercial stopped.')}>{playing.opensItem ? 'Skip it & open bidding' : 'Stop it'}</button>
          </div>
        ) : null}
        <ul className="space-y-3">
          {COMMERCIALS.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
              <p className="min-w-0 flex-1 font-bold">{c.title} <span className="font-normal text-muted-foreground">· {c.seconds}s</span></p>
              <select aria-label={`Item to promote with ${c.title}`} className="h-14 min-w-0 max-w-full rounded-xl border bg-white px-3" value={promo[c.key] ?? ''} onChange={(e) => setPromo((p) => ({ ...p, [c.key]: e.target.value }))}>
                <option value="">{c.promote ? `Auto — promotes the “${c.promote}” item` : 'No item — just the commercial'}</option>
                {data?.silent.map((s) => <option key={s.id} value={s.id}>Promote #{s.item_number} {s.title}</option>)}
              </select>
              <button className={gold} disabled={busy || !!playing || !!state.event.emergency} onClick={() => show({ action: 'commercial-play', key: c.key, itemId: promo[c.key] || undefined }, `Playing “${c.title}”.`)}><Play className="inline size-5" /> Play</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card p-4">
          <h2 className="mb-2 text-2xl">Power-Ups just played</h2>
          {data?.recentActs.length ? data.recentActs.map((a, i) => <p key={i} className="text-lg">{a.name} — bidder #{a.bidder_number} on item #{a.item_number}</p>) : <p className="text-muted-foreground">None yet.</p>}
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <h2 className="mb-2 flex items-center gap-2 text-2xl"><Megaphone className="size-6" /> Projector</h2>
          <div className="flex flex-wrap gap-2">
            {([['welcome', 'Welcome'], ['dashboard', 'Auction'], ['live', 'Live item'], ['pie', 'Pie finale'], ['chili', 'Chili board'], ['thanks', 'Thank you'], ['auto', 'Automatic']] as const).map(([m, label]) => (
              <button key={m} className={state.event.displayMode === m ? gold : ghost} aria-pressed={state.event.displayMode === m} disabled={busy} onClick={() => show({ action: 'display', mode: m })}>{label}</button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input aria-label="Announcement" placeholder="Type an announcement…" maxLength={140} className="h-14 min-w-0 flex-1 rounded-xl border px-3" value={announce} onChange={(e) => setAnnounce(e.target.value)} />
            <button className={gold} disabled={busy || !announce.trim()} onClick={async () => { const r = await show({ action: 'announce', headline: announce.trim() }, 'Announcement sent.'); if (r.ok) setAnnounce('') }}>Flash it</button>
            <button className={ghost} disabled={busy || !announce.trim()} onClick={() => show({ action: 'display', mode: 'message', message: announce.trim() }, 'Message pinned on the projector.')}><Plus className="inline size-5" /> Pin</button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Projector address: <b>/display</b> (open it full-screen on the projector computer). {isAdmin ? '' : 'Settings are administrator-only.'}</p>
        </div>
      </section>
    </div>
  )
}
