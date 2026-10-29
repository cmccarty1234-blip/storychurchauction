'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Flame, Maximize2, Volume2, VolumeX, Zap } from 'lucide-react'
import { formatCents } from '@/lib/money'
import { liveClock, mmss, secsUntil, useGameState, useTicker } from '@/lib/game-client'
import type { GameState, StageItem } from '@/lib/game-state'

type Ann = GameState['announcements'][number]

const img = (p: string | null) => (p ? `/api/uploads/${p}` : null)

// ───────────────────────── sound (opt-in; muted until someone clicks) ─────────────────────────
function useBeeper(muted: boolean) {
  const ctx = useRef<AudioContext | null>(null)
  return (freq = 880, ms = 140, vol = 0.12) => {
    if (muted) return
    try {
      ctx.current ??= new AudioContext()
      const c = ctx.current
      const o = c.createOscillator()
      const g = c.createGain()
      o.frequency.value = freq
      g.gain.value = vol
      o.connect(g).connect(c.destination)
      o.start()
      o.stop(c.currentTime + ms / 1000)
    } catch {}
  }
}

export function Projector({ qr, joinUrl }: { qr: string; joinUrl: string }) {
  const { state, online, now } = useGameState(1000)
  useTicker(100)
  const [reduced, setReduced] = useState(false)
  const [muted, setMuted] = useState(true)
  const beep = useBeeper(muted)

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const saved = localStorage.getItem('sc-reduce-motion')
        setReduced(saved != null ? saved === '1' : window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      } catch {}
      // If this browser already lets the page play sound without a click (site allowed, or launched with the autoplay flag), start with sound on.
      try {
        const policy = (navigator as Navigator & { getAutoplayPolicy?: (t: string) => string }).getAutoplayPolicy?.('mediaelement')
        if (policy === 'allowed') setMuted(false)
      } catch {}
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // ── Announcement overlays (Power-Ups, Room Events, winner reveals, host messages) ──
  const seen = useRef<Set<string> | null>(null)
  const queue = useRef<Ann[]>([])
  const [overlay, setOverlay] = useState<Ann | null>(null)
  useEffect(() => {
    if (!state) return
    const t = now()
    if (seen.current === null) {
      // First load or reconnect: don't replay history, only things that happened in the last few seconds.
      seen.current = new Set(state.announcements.filter((a) => t - new Date(a.at).getTime() > 6000).map((a) => a.id))
    }
    for (const a of [...state.announcements].reverse()) {
      if (!a.interrupt || seen.current.has(a.id)) continue
      seen.current.add(a.id)
      queue.current.push(a)
    }
    if (!overlay && queue.current.length) {
      const next = queue.current.shift()!
      setOverlay(next)
      beep(next.kind === 'item.sold' ? 988 : 660, 260)
    }
  }, [state, overlay]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!overlay) return
    const ms = overlay.kind === 'room.jackpot.winner' ? 11000 : overlay.kind === 'item.sold' ? 8000 : 5500
    const id = setTimeout(() => setOverlay(null), ms)
    return () => clearTimeout(id)
  }, [overlay])

  // Countdown ticks in the last seconds of the live timer
  const lastBeep = useRef(-1)
  const live = state?.stage
  const clock = live ? liveClock(live, now(), !!state?.event.emergency) : null
  useEffect(() => {
    if (!clock || clock.frozen) return
    const s = Math.ceil(clock.secs)
    if (s <= 5 && s > 0 && s !== lastBeep.current) {
      lastBeep.current = s
      beep(520 + (5 - s) * 60, 90)
    }
  })

  // A little "ka-ching" whenever the bid on the item on the block goes up (not when a screen first loads).
  const lastBid = useRef<{ id: string | null; cents: number | null }>({ id: null, cents: null })
  useEffect(() => {
    const st = state?.stage
    const prev = lastBid.current
    lastBid.current = { id: st?.id ?? null, cents: st?.currentBidCents ?? null }
    if (st && prev.id === st.id && st.currentBidCents != null && st.currentBidCents !== prev.cents) {
      beep(1318, 90)
      setTimeout(() => beep(1760, 170), 90)
    }
  })

  if (!state) return <Shell reduced={reduced}><Center><p className="text-[length:calc(var(--u)*3)] text-white/60">Connecting to the auction…</p></Center></Shell>

  const t = now()
  const room = state.room
  let main: React.ReactNode
  if (state.event.emergency) {
    main = (
      <Center>
        <p className="font-heading text-[length:calc(var(--u)*7)] leading-none text-brand-yellow">PLEASE STAND BY</p>
        <p className="mt-6 text-[length:calc(var(--u)*2.6)] text-white/80">Bidding is paused for a moment.{state.event.emergency.reason ? ` ${state.event.emergency.reason}` : ''}</p>
      </Center>
    )
  } else if (state.event.displayMode === 'message' && state.event.displayMessage) {
    main = <Center><p className="font-heading max-w-[calc(var(--u)*80)] text-center text-[length:calc(var(--u)*6)] leading-tight text-brand-yellow">{state.event.displayMessage}</p></Center>
  } else if (state.event.displayMode === 'welcome') {
    main = <Welcome state={state} qr={qr} joinUrl={joinUrl} />
  } else if (state.event.displayMode === 'thanks') {
    main = <Thanks state={state} />
  } else if (state.event.displayMode === 'pie') {
    main = <PieFinale state={state} />
  } else if (room?.code === 'lightning') {
    main = <LightningView state={state} now={t} />
  } else if (room?.code === 'battle') {
    main = <BattleView state={state} now={t} />
  } else if (room?.code === 'jackpot') {
    main = (
      <Center>
        <p className="font-heading text-[length:calc(var(--u)*8)] leading-none text-brand-yellow">MYSTERY JACKPOT!</p>
        <p className="mt-6 text-[length:calc(var(--u)*3)]">Everyone who registered is in. Prize: <b className="text-brand-yellow">{String(room.config.prize ?? 'a mystery prize')}</b></p>
      </Center>
    )
  } else if ((state.stage || state.reopened[0]) && state.event.displayMode !== 'dashboard') {
    main = <LiveView state={state} item={state.stage ?? state.reopened[0]} now={t} />
  } else {
    main = <Dashboard state={state} now={t} qr={qr} joinUrl={joinUrl} />
  }

  return (
    <Shell reduced={reduced}>
      {main}
      {state.pies.enabled && ['live', 'lightning', 'battle'].includes(room?.code ?? (state.stage || state.reopened[0] ? 'live' : '')) && !state.event.emergency ? (
        <div className="flex shrink-0 items-center justify-center gap-[calc(var(--u)*2)] bg-brand-yellow py-[0.6vh] text-ink">
          <p className="font-heading text-[length:calc(var(--u)*2.2)]">PIE BRANDON IN THE FACE — sign up at the Bid Desk! Small {formatCents(state.pies.smallPriceCents)} · LARGE {formatCents(state.pies.largePriceCents)}</p>
        </div>
      ) : null}
      <Ticker state={state} reduced={reduced} />
      {state.commercial && !state.event.emergency && new Date(state.commercial.endsAt).getTime() > t ? <CommercialBreak key={state.commercial.startedAt} c={state.commercial} now={t} muted={muted} onSound={() => setMuted(false)} reduced={reduced} joinUrl={joinUrl} /> : null}
      {overlay ? <Overlay a={overlay} state={state} /> : null}
      {!online ? <div className="fixed left-4 top-4 rounded bg-amber-500 px-3 py-1 text-sm font-bold text-black">Reconnecting…</div> : null}
      <div className="fixed bottom-14 right-3 z-50 flex gap-2 opacity-30 transition hover:opacity-100 focus-within:opacity-100">
        <button aria-label={muted ? 'Turn sound on' : 'Mute sound'} onClick={() => setMuted((m) => !m)} className="rounded-full bg-white/15 p-3 text-white hover:bg-white/30">
          {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
        </button>
        <button
          aria-label={reduced ? 'Turn animations on' : 'Reduce motion'}
          aria-pressed={reduced}
          onClick={() => {
            setReduced((r) => {
              try { localStorage.setItem('sc-reduce-motion', r ? '0' : '1') } catch {}
              return !r
            })
          }}
          className="rounded-full bg-white/15 p-3 text-white hover:bg-white/30"
        >
          <Zap className="size-5" />
        </button>
        <button aria-label="Full screen" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})} className="rounded-full bg-white/15 p-3 text-white hover:bg-white/30">
          <Maximize2 className="size-5" />
        </button>
      </div>
    </Shell>
  )
}

function PieIcon({ className = 'size-[1em]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <ellipse cx="32" cy="40" rx="28" ry="12" fill="#c98a3c" />
      <path d="M6 38 Q32 4 58 38 Q32 50 6 38Z" fill="#fff6e0" />
      <path d="M6 38 Q32 4 58 38" fill="none" stroke="#c98a3c" strokeWidth="5" strokeLinecap="round" />
      <circle cx="22" cy="30" r="3.2" fill="#e8b4b8" /><circle cx="34" cy="24" r="3.2" fill="#e8b4b8" /><circle cx="44" cy="31" r="3.2" fill="#e8b4b8" />
    </svg>
  )
}

/** The church's white wordmark, shown as-is on the dark projector. */
function Logo({ className = 'h-[5vh]' }: { className?: string }) {
  return <Image src="/brand/storychurch-banner.png" alt="Story Church" width={1562} height={286} priority className={`${className} w-auto`} />
}

function Shell({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  return (
    <div data-reduce={reduced} style={{ '--u': 'min(1vw, 1.7778vh)' } as React.CSSProperties} className="relative flex h-screen w-screen flex-col overflow-hidden bg-ink text-white">
      <div className="h-[0.6vh] shrink-0 bg-brand-yellow" aria-hidden />
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
const Center = ({ children }: { children: React.ReactNode }) => <div className="flex flex-1 flex-col items-center justify-center px-[calc(var(--u)*4)] text-center">{children}</div>

function Countdown({ secs, warn, big = false, frozen = false, label, callClass }: { secs: number; warn: number; big?: boolean; frozen?: boolean; label?: string; callClass?: string }) {
  const danger = !frozen && secs <= 5
  const hot = !frozen && secs <= warn
  return (
    <div className={`text-center ${hot && !frozen ? 'sc-glow' : ''} rounded-3xl border-4 px-[calc(var(--u)*2)] py-[1vh] ${danger ? 'border-red-500 bg-red-600/20' : hot ? 'border-brand-yellow bg-brand-yellow/10' : 'border-white/30'}`}>
      <div className={`tnum font-heading leading-none ${big ? 'text-[length:calc(var(--u)*8)]' : 'text-[length:calc(var(--u)*7)]'} ${danger ? 'text-red-400' : hot ? 'text-brand-yellow' : 'text-white'}`}>{mmss(secs)}</div>
      {label && callClass ? <div key={label} className={`sc-pop mt-1 font-heading text-[length:calc(var(--u)*3.6)] leading-none tracking-wide ${callClass}`}>{label}</div> : null}
      {label && !callClass ? <div className="mt-1 text-[length:calc(var(--u)*1.6)] font-bold tracking-[0.25em] text-white/70">{label}</div> : null}
    </div>
  )
}

// ───────────────────────── Mode B: live auction ─────────────────────────
function LiveView({ state, item, now }: { state: GameState; item: StageItem; now: number }) {
  const emergency = !!state.event.emergency
  const reopened = item.status === 'reopened'
  const clock = liveClock(item, now, emergency)
  const warn = state.event.warningSeconds
  const itemBids = state.recentBids.filter((b) => b.itemNumber === item.number)
  // The screen does the auctioneer's job: calls at 10 / 5 / 2 seconds, a flash on every new bid, and a banner when bids pile up.
  const live = !clock?.frozen && (item.status === 'open' || item.status === 'reopened')
  const secs = clock?.secs ?? 0
  const call = live && secs > 0 && secs <= 10 ? (secs <= 2 ? { t: 'FINAL CALL!', c: 'text-red-400' } : secs <= 5 ? { t: 'GOING TWICE…', c: 'text-orange-400' } : { t: 'GOING ONCE…', c: 'text-brand-yellow' }) : null
  const age = (b: { at: string }) => now - new Date(b.at).getTime()
  const jump = itemBids[0] && itemBids[1] && age(itemBids[0]) < 2500 ? itemBids[0].amountCents - itemBids[1].amountCents : null
  const war = itemBids.filter((b) => age(b) < 20000).length >= 3
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[46%_54%] gap-[calc(var(--u)*2)] p-[calc(var(--u)*2.5)]">
      <div className="relative overflow-hidden rounded-3xl border-4 border-brand-yellow bg-charcoal">
        {img(item.imagePath) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img(item.imagePath)!} alt={item.title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center font-heading text-[length:calc(var(--u)*12)] text-white/20">#{item.number}</div>
        )}
        <div className="absolute left-0 top-0 rounded-br-3xl bg-brand-yellow px-[calc(var(--u)*1.6)] py-[0.6vh] font-heading text-[length:calc(var(--u)*3)] text-ink">ITEM {item.number}</div>
      </div>
      <div className="flex min-h-0 flex-col justify-between">
        <div>
          <Logo className="mb-[1vh] h-[3.6vh] opacity-80" />
          <h1 className="line-clamp-2 font-heading text-[length:calc(var(--u)*3.6)] leading-[1.02]">{item.title}</h1>
          {reopened ? <p className="sc-pop mt-2 inline-block rounded-full bg-brand-yellow px-4 py-1 text-[length:calc(var(--u)*2)] font-bold text-ink">{item.timerPhase === 'challenge' ? 'CHALLENGE — everyone can respond!' : 'RESURRECTED — this auction is back!'}</p> : null}
        </div>
        <div className="space-y-[1.2vh]">
          <div>
            <p className="text-[length:calc(var(--u)*1.6)] font-bold tracking-[0.25em] text-white/60">CURRENT BID</p>
            <p key={item.currentBidCents ?? 'open'} className="tnum sc-pop font-heading text-[length:calc(var(--u)*8)] leading-none text-brand-yellow">
              {item.currentBidCents != null ? formatCents(item.currentBidCents) : 'OPEN'}
              {jump && jump > 0 ? <span className="sc-pop ml-[calc(var(--u)*2)] align-middle text-[length:calc(var(--u)*4)] text-green-400">+{formatCents(jump)}</span> : null}
            </p>
            <p className="mt-1 text-[length:calc(var(--u)*2.6)] font-bold">{item.leaderNumber ? <>Bidder <span className="text-brand-yellow">#{item.leaderNumber}</span> leads</> : 'Be the first to bid!'}</p>
            <p className="text-[length:calc(var(--u)*1.9)] text-white/70">Next bid: <b className="text-white">{formatCents(item.minNextCents)}</b></p>
          </div>
          {clock ? <Countdown secs={clock.secs} warn={warn} big frozen={clock.frozen} label={call ? call.t : clock.label} callClass={call?.c} /> : null}
        </div>
        {war ? <p className="sc-pop flex shrink-0 items-center gap-[calc(var(--u)*1)] font-heading text-[length:calc(var(--u)*3)] leading-none text-red-400"><Flame className="size-[1.1em]" />BIDDING WAR!</p> : null}
      </div>
    </div>
  )
}

// ───────────────────────── Mode A: auction dashboard ─────────────────────────
const hms = (secs: number) => {
  const s = Math.max(0, Math.ceil(secs))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const x = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}

const clockTime = (iso: string | null, tz: string) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) : null)
const shortUrl = (u: string) => u.replace(/^https?:\/\//, '').replace(/\/+$/, '')

function QrCard({ qr, joinUrl, big = false }: { qr: string; joinUrl: string; big?: boolean }) {
  return (
    <div className={`flex min-h-0 flex-col rounded-2xl bg-white p-[calc(var(--u)*1.2)] text-center text-ink ${big ? '' : 'h-full'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code to register and bid" className={big ? 'mx-auto aspect-square w-[26vh]' : 'mx-auto min-h-0 flex-1 object-contain'} />
      <p className={`mt-[0.6vh] shrink-0 font-heading leading-tight ${big ? 'text-[length:calc(var(--u)*2.6)]' : 'text-[length:calc(var(--u)*1.8)]'}`}>BID FROM YOUR PHONE</p>
      <p className={`shrink-0 font-bold text-ink/70 ${big ? 'text-[length:calc(var(--u)*1.7)]' : 'text-[length:calc(var(--u)*1.25)]'}`}>Scan to register &amp; bid</p>
      <p className={`shrink-0 font-bold ${big ? 'text-[length:calc(var(--u)*1.6)]' : 'text-[length:calc(var(--u)*1.15)]'}`}>{shortUrl(joinUrl)}</p>
    </div>
  )
}

function Dashboard({ state, now, qr, joinUrl }: { state: GameState; now: number; qr: string; joinUrl: string }) {
  const tt = state.totals
  // One headline number: every winning/leading bid plus Power-Up sales.
  const committed = tt.leadingCents + tt.finalizedCents + tt.powerupCents + tt.pieCents
  const goal = state.event.goalCents
  const pct = goal ? Math.min(100, (committed / goal) * 100) : 0
  const closeSecs = state.event.silentCloseAt ? secsUntil(state.event.silentCloseAt, now) : null
  const closed = closeSecs != null && closeSecs <= 0
  const finalStretch = closeSecs != null && closeSecs > 0 && closeSecs <= 15 * 60
  const chance = [...state.reopened, ...state.lastChance].slice(0, 3)
  const spots = state.hot
  const spot = spots.length ? spots[Math.floor(now / 8000) % spots.length] : null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.4vh] p-[calc(var(--u)*2)]">
      <div className="flex items-center justify-between gap-[calc(var(--u)*2)]">
        <Logo className="h-[6vh]" />
        <p className="font-heading text-[length:calc(var(--u)*2)] tracking-wide text-white/70">YOUR STORY MATTERS.</p>
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] gap-[calc(var(--u)*1.2)]">
        <div className="rounded-2xl border border-white/20 bg-white/5 px-[calc(var(--u)*2)] py-[1.2vh]">
          <div className="flex items-baseline justify-between">
            <p className="text-[length:calc(var(--u)*1.7)] font-bold tracking-[0.25em] text-white/60">TOTAL COMMITTED</p>
            <p className="text-[length:calc(var(--u)*1.7)] font-bold text-white/70">{state.bidsTonight} bids tonight</p>
          </div>
          <p className="tnum font-heading text-[length:calc(var(--u)*6.2)] leading-none text-brand-yellow">{formatCents(committed)}</p>
          {goal ? (
            <div className="mt-[1vh]">
              <div className="h-[2.4vh] overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress toward the fundraising goal">
                <div className="h-full rounded-full bg-brand-yellow transition-all duration-1000" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-[0.4vh] text-[length:calc(var(--u)*1.7)] font-bold text-white/80">{Math.floor(pct)}% of our {formatCents(goal)} goal</p>
            </div>
          ) : null}
        </div>
        <div className={`flex flex-col items-center justify-center rounded-2xl border-2 px-[calc(var(--u)*1.5)] py-[1.2vh] text-center ${finalStretch ? 'sc-glow border-brand-yellow bg-brand-yellow/10' : 'border-white/20 bg-white/5'}`}>
          <p className="text-[length:calc(var(--u)*1.6)] font-bold tracking-[0.2em] text-white/60">{closed ? 'SILENT AUCTION' : 'SILENT AUCTION CLOSES IN'}</p>
          <p className={`tnum font-heading leading-none ${finalStretch ? 'text-[length:calc(var(--u)*6.4)] text-brand-yellow' : 'text-[length:calc(var(--u)*5)]'}`}>{closeSecs == null ? '—' : closed ? 'CLOSED' : hms(closeSecs)}</p>
          {finalStretch ? <p className="mt-1 text-[length:calc(var(--u)*1.8)] font-bold text-brand-yellow">FINAL CALL FOR SILENT BIDS!</p> : null}
        </div>
      </div>

      {state.pies.enabled ? (
        <div className="flex items-center justify-between gap-[calc(var(--u)*2)] rounded-2xl bg-brand-yellow px-[calc(var(--u)*2)] py-[1vh] text-ink">
          <p className="font-heading text-[length:calc(var(--u)*3.4)] leading-none"><PieIcon className="mr-[calc(var(--u)*1)] inline-block size-[1.1em] align-[-0.12em]" />PIE BRANDON IN THE FACE!</p>
          <p className="text-right text-[length:calc(var(--u)*2)] font-extrabold leading-tight">
            Small {formatCents(state.pies.smallPriceCents)} · LARGE {formatCents(state.pies.largePriceCents)}
            <span className="block text-[length:calc(var(--u)*1.7)] font-bold">{state.pies.smallSold + state.pies.largeSold > 0 ? `${state.pies.smallSold + state.pies.largeSold} pies pledged · ${formatCents(state.pies.cents)} raised` : 'Sign up at the Bid Desk!'}</span>
          </p>
        </div>
      ) : null}

      {chance.length ? (
        <div className="sc-pop rounded-2xl bg-brand-yellow px-[calc(var(--u)*2)] py-[1vh] text-ink">
          <p className="font-heading text-[length:calc(var(--u)*2)]">LAST CHANCE — NOT FINAL YET!</p>
          {chance.map((i) => (
            <p key={i.id} className="flex justify-between gap-4 text-[length:calc(var(--u)*2)] font-bold">
              <span className="truncate">#{i.number} {i.title} — {formatCents(i.currentBidCents)} (bidder #{i.leaderNumber ?? '—'}{i.status === 'reopened' ? ', REOPENED' : ''})</span>
              <span className="tnum shrink-0">{mmss(secsUntil(i.status === 'reopened' ? i.deadlineAt : i.provisionalUntil, now))}</span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-[calc(var(--u)*1.2)]">
        <div className="min-h-0 overflow-hidden rounded-2xl border border-white/20 bg-white/5">
          {spot ? (
            <div key={spot.id} className="sc-slide grid h-full grid-cols-[1.05fr_1fr]">
              <div className="relative bg-charcoal">
                {img(spot.imagePath) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img(spot.imagePath)!} alt={spot.title} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center"><Logo className="h-[9vh] opacity-50" /></div>
                )}
                <div className="absolute left-0 top-0 rounded-br-2xl bg-brand-yellow px-[calc(var(--u)*1.2)] py-[0.4vh] font-heading text-[length:calc(var(--u)*2.2)] text-ink">ITEM {spot.number}</div>
              </div>
              <div className="flex min-h-0 min-w-0 flex-col justify-center gap-[0.4vh] overflow-hidden p-[calc(var(--u)*1.2)]">
                <p className="text-[length:calc(var(--u)*1.5)] font-bold tracking-[0.22em] text-brand-yellow">HOT RIGHT NOW</p>
                <h2 className="line-clamp-2 font-heading text-[length:calc(var(--u)*2.4)] leading-[1.05]">{spot.title}</h2>
                <p className="tnum font-heading text-[length:calc(var(--u)*4.4)] leading-none text-brand-yellow">{formatCents(spot.currentBidCents)}</p>
                <p className="text-[length:calc(var(--u)*1.8)] font-bold">Bidder <span className="text-brand-yellow">#{spot.leaderNumber ?? '—'}</span> leads · {spot.bidCount} {spot.bidCount === 1 ? 'bid' : 'bids'}</p>
                {spot.closesAt ? <p className="text-[length:calc(var(--u)*1.5)] text-white/70">Closes in <b className="tnum text-white">{hms(secsUntil(spot.closesAt, now))}</b></p> : null}
              </div>
            </div>
          ) : (
            <Center>
              <Logo className="h-[12vh]" />
              <p className="mt-[3vh] font-heading text-[length:calc(var(--u)*4)] text-brand-yellow">BIDS WILL SHOW UP HERE</p>
              <p className="mt-2 text-[length:calc(var(--u)*2)] text-white/70">Scan the code and place the first bid!</p>
            </Center>
          )}
        </div>
        <QrCard qr={qr} joinUrl={joinUrl} />
      </div>
    </div>
  )
}

// ───────────────────────── host-selected screens ─────────────────────────
function Welcome({ state, qr, joinUrl }: { state: GameState; qr: string; joinUrl: string }) {
  const close = clockTime(state.event.silentCloseAt, state.event.timezone)
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.3fr_1fr] items-center gap-[calc(var(--u)*3)] px-[calc(var(--u)*4)]">
      <div>
        <Logo className="h-[11vh]" />
        <p className="mt-[3vh] font-heading text-[length:calc(var(--u)*9)] leading-[0.95] text-brand-yellow">WELCOME!</p>
        <p className="mt-[2vh] text-[length:calc(var(--u)*2.8)] font-bold leading-snug">Scan the code to register and start bidding from your phone.</p>
        {close ? <p className="mt-[1.5vh] text-[length:calc(var(--u)*2.2)] text-white/75">The silent auction closes at <b className="text-white">{close}</b>.</p> : null}
        <p className="mt-[3vh] font-heading text-[length:calc(var(--u)*2.2)] tracking-wide text-white/70">YOUR STORY MATTERS.</p>
      </div>
      <QrCard qr={qr} joinUrl={joinUrl} big />
    </div>
  )
}

function PieFinale({ state }: { state: GameState }) {
  const p = state.pies
  const left = p.smallLeft + p.largeLeft
  return (
    <Center>
      <Logo className="h-[8vh]" />
      <p className="sc-pop mt-[2vh] font-heading text-[length:calc(var(--u)*7)] leading-[0.95] text-brand-yellow"><PieIcon className="mr-[calc(var(--u)*1.5)] inline-block size-[0.95em] align-[-0.1em]" />PIE BRANDON IN THE FACE!</p>
      <p className="mt-[2vh] text-[length:calc(var(--u)*3)] font-bold">{left > 0 ? `${left} pies waiting` : p.thrown > 0 ? 'Every pie has been thrown!' : 'Sign up at the Bid Desk!'} · {formatCents(p.cents)} raised</p>
      {p.next.length ? (
        <div className="mt-[3vh] w-[calc(var(--u)*70)] rounded-3xl border-4 border-brand-yellow bg-white/5 p-[calc(var(--u)*2)]">
          <p className="text-[length:calc(var(--u)*1.8)] font-bold tracking-[0.25em] text-brand-yellow">UP NEXT</p>
          {p.next.map((n, i) => (
            <p key={i} className={`font-heading ${i === 0 ? 'text-[length:calc(var(--u)*5.5)] text-white' : 'text-[length:calc(var(--u)*2.8)] text-white/70'}`}>
              Bidder #{n.bidderNumber} — {n.size === 'large' ? 'LARGE' : 'small'} pie
            </p>
          ))}
        </div>
      ) : null}
    </Center>
  )
}

function Thanks({ state }: { state: GameState }) {
  const tt = state.totals
  const committed = tt.leadingCents + tt.finalizedCents + tt.powerupCents + tt.pieCents
  return (
    <Center>
      <Logo className="h-[9vh]" />
      <p className="sc-pop mt-[3vh] font-heading text-[length:calc(var(--u)*10)] leading-none text-brand-yellow">THANK YOU!</p>
      <p className="mt-[2vh] text-[length:calc(var(--u)*2.8)] font-bold">Together we raised</p>
      <p className="tnum font-heading text-[length:calc(var(--u)*11)] leading-none">{formatCents(committed)}</p>
      <p className="mt-[3vh] max-w-[calc(var(--u)*80)] whitespace-pre-line text-[length:calc(var(--u)*2.4)] font-bold leading-snug">{state.event.pickup.trim() || 'Please visit the checkout table to pay and pick up your items.'}</p>
      <p className="mt-[2vh] font-heading text-[length:calc(var(--u)*2.2)] tracking-wide text-white/70">YOUR STORY MATTERS.</p>
    </Center>
  )
}

// ───────────────────────── Mode D: Room Events ─────────────────────────
function LightningView({ state, now }: { state: GameState; now: number }) {
  const room = state.room!
  const secs = secsUntil(room.endsAt, now)
  const nums = (room.lightningItems ?? []).slice(0, 24)
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2vh] px-[calc(var(--u)*3)] text-center">
      <p className="sc-pop font-heading text-[length:calc(var(--u)*9)] leading-none text-brand-yellow">⚡ LIGHTNING ROUND! ⚡</p>
      <p className="text-[length:calc(var(--u)*2.8)]">Bids go up by just <b className="text-brand-yellow">$1</b> on these silent items — get your phone out!</p>
      <Countdown secs={secs} warn={10} big label="TIME LEFT" />
      <p className="max-w-[calc(var(--u)*85)] text-[length:calc(var(--u)*2.4)] font-bold">Items: {nums.map((n) => `#${n}`).join('  ')}</p>
      <div className="space-y-1">
        {state.recentBids.slice(0, 4).map((b, i) => (
          <p key={b.at + i} className="sc-slide text-[length:calc(var(--u)*2)] text-white/80"><b className="text-brand-yellow">#{b.bidderNumber}</b> bid {formatCents(b.amountCents)} on {b.title}</p>
        ))}
      </div>
    </div>
  )
}

function BattleView({ state, now }: { state: GameState; now: number }) {
  const room = state.room!
  const b = room.battle ?? { gold: { points: 0, bids: 0, players: 0 }, black: { points: 0, bids: 0, players: 0 } }
  const total = Math.max(1, b.gold.points + b.black.points)
  const secs = secsUntil(room.endsAt, now)
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-[3vh] px-[calc(var(--u)*4)]">
      <p className="text-center font-heading text-[length:calc(var(--u)*7)] leading-none text-brand-yellow">BATTLE OF THE ROOM!</p>
      <div className="mx-auto"><Countdown secs={secs} warn={10} label="TIME LEFT" /></div>
      <div className="grid grid-cols-2 gap-[calc(var(--u)*3)] text-center">
        <div className="rounded-3xl bg-brand-yellow p-[calc(var(--u)*2)] text-ink"><p className="font-heading text-[length:calc(var(--u)*3)]">TEAM GOLD</p><p className="tnum font-heading text-[length:calc(var(--u)*9)] leading-none">{b.gold.points}</p><p className="text-[length:calc(var(--u)*1.4)] font-bold">{b.gold.bids} bids · {b.gold.players} players</p></div>
        <div className="rounded-3xl border-4 border-brand-yellow bg-black p-[calc(var(--u)*2)]"><p className="font-heading text-[length:calc(var(--u)*3)] text-brand-yellow">TEAM BLACK</p><p className="tnum font-heading text-[length:calc(var(--u)*9)] leading-none">{b.black.points}</p><p className="text-[length:calc(var(--u)*1.4)] font-bold text-white/70">{b.black.bids} bids · {b.black.players} players</p></div>
      </div>
      <div className="flex h-[4vh] overflow-hidden rounded-full border-2 border-white/40">
        <div className="bg-brand-yellow transition-all duration-700" style={{ width: `${(b.gold.points / total) * 100}%` }} />
        <div className="flex-1 bg-black" />
      </div>
      <p className="text-center text-[length:calc(var(--u)*1.5)] text-white/60">Game points, not dollars. {String(room.config.reward ?? '') ? <>Reward: <b className="text-white">{String(room.config.reward)}</b>. </> : null}Each accepted bid scores 10 points + 1 per $10 it raises the price.</p>
    </div>
  )
}

// ───────────────────────── Modes C & E: overlays ─────────────────────────
function Overlay({ a, state }: { a: Ann; state: GameState }) {
  const isSold = a.kind === 'item.sold'
  const isJackpot = a.kind === 'room.jackpot.winner'
  const item = a.itemId ? [...state.lastChance, ...state.reopened, state.stage].find((i) => i?.id === a.itemId) : null
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-ink/95 px-[calc(var(--u)*5)] text-center" role="alert">
      <div className="absolute top-[3vh]"><Logo className="h-[6vh]" /></div>
      {isSold ? <Confetti /> : null}
      {isJackpot ? (
        <Jackpot a={a} />
      ) : (
        <>
          <p className="sc-pop font-heading text-[length:calc(var(--u)*8.5)] leading-[1.02] text-brand-yellow">{isSold ? 'SOLD!' : a.headline}</p>
          {isSold ? (
            <>
              <p className="sc-pop mt-4 text-[length:calc(var(--u)*3.6)] font-bold">{String(a.payload.bidderNumber ? `Bidder #${a.payload.bidderNumber}` : '')}</p>
              <p className="tnum sc-pop font-heading text-[length:calc(var(--u)*11)] leading-none">{formatCents(Number(a.payload.amountCents ?? 0))}</p>
              <p className="mt-3 text-[length:calc(var(--u)*2.6)] text-white/80">{a.headline.replace(/^SOLD!\s*/, '').split(' — ')[0]}</p>
            </>
          ) : (
            <>
              {a.body ? <p className="mt-4 text-[length:calc(var(--u)*3)] font-bold">{a.body}</p> : null}
              {item ? <p className="mt-2 text-[length:calc(var(--u)*2.2)] text-white/70">Currently {formatCents(item.currentBidCents)}{item.provisionalUntil ? ' · last-chance window open' : ''}</p> : null}
            </>
          )}
        </>
      )}
    </div>
  )
}

/** The shuffle is cosmetic. The winner shown at the end is exactly what the server stored in the draw. */
function Jackpot({ a }: { a: Ann }) {
  const [shown, setShown] = useState<number | null>(null)
  const winner = Number(a.payload.winnerNumber)
  const entries = Number(a.payload.entries ?? 100)
  useEffect(() => {
    let n = 0
    const id = setInterval(() => {
      n++
      if (n * 80 >= 5500) {
        setShown(winner)
        clearInterval(id)
      } else setShown(1001 + Math.floor(Math.random() * Math.max(entries, 5)))
    }, 80)
    return () => clearInterval(id)
  }, [winner, entries])
  const done = shown === winner
  return (
    <>
      <p className="font-heading text-[length:calc(var(--u)*7)] leading-none text-brand-yellow">MYSTERY JACKPOT!</p>
      <p className={`tnum font-heading mt-6 text-[length:calc(var(--u)*18)] leading-none ${done ? 'sc-pop text-white' : 'text-white/60'}`}>{shown != null ? `#${shown}` : '…'}</p>
      <p className="mt-4 text-[length:calc(var(--u)*3)]">{done ? <>wins <b className="text-brand-yellow">{String(a.payload.prize ?? 'the prize')}</b>!</> : `Drawing from ${entries} registered guests…`}</p>
    </>
  )
}

function Confetti() {
  const bits = useMemo(() => Array.from({ length: 48 }, (_, i) => ({ left: (i * 37) % 100, delay: (i % 12) * 0.25, dur: 3 + (i % 5) * 0.6, size: 10 + (i % 4) * 6, gold: i % 3 !== 0 })), [])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {bits.map((b, i) => (
        <span key={i} className={`absolute top-0 block ${b.gold ? 'bg-brand-yellow' : 'bg-white'}`} style={{ left: `${b.left}%`, width: b.size, height: b.size * 1.6, animation: `sc-fall ${b.dur}s linear ${b.delay}s infinite` }} />
      ))}
    </div>
  )
}

// ───────────────────────── commercial break (host-triggered takeover) ─────────────────────────
function CommercialBreak({ c, now, muted, onSound, reduced, joinUrl }: { c: NonNullable<GameState['commercial']>; now: number; muted: boolean; onSound: () => void; reduced: boolean; joinUrl: string }) {
  // The sound setting at the start goes in the URL; later changes are sent to the player so the video never restarts.
  const [startMuted] = useState(muted)
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: muted ? 'mute' : 'unMute', args: [] }), '*')
  }, [muted])
  const total = new Date(c.endsAt).getTime() - new Date(c.startedAt).getTime()
  const leftMs = Math.max(0, new Date(c.endsAt).getTime() - now)
  const src = `https://www.youtube-nocookie.com/embed/${c.youtubeId}?autoplay=1&mute=${startMuted ? 1 : 0}&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&disablekb=1&fs=0&cc_load_policy=0&enablejsapi=1`
  const item = c.item
  const anim = (cls: string) => (reduced ? '' : cls)
  // A QR straight to this item's page (/i/<number>), made in the browser so it follows whatever item is being promoted.
  const [itemQr, setItemQr] = useState<string | null>(null)
  const itemNumber = item?.number
  useEffect(() => {
    if (itemNumber == null) return
    let alive = true
    import('qrcode')
      .then((m) => m.default.toDataURL(`${new URL(joinUrl).origin}/i/${itemNumber}`, { errorCorrectionLevel: 'M', margin: 1, width: 400, color: { dark: '#101010', light: '#ffffff' } }))
      .then((url) => { if (alive) setItemQr(url) })
      .catch(() => {})
    return () => { alive = false }
  }, [itemNumber, joinUrl])
  return (
    <div className="fixed inset-0 z-30 flex flex-col items-center overflow-hidden bg-black text-white" role="region" aria-label="Commercial break">
      <div className={`absolute inset-0 ${anim('sc-stripes')}`} aria-hidden />
      <div className="relative z-10 flex w-full items-center justify-between px-[calc(var(--u)*3)] pt-[2vh]">
        <p className="flex items-center gap-[calc(var(--u)*1)] whitespace-nowrap font-heading text-[length:calc(var(--u)*3)] tracking-widest text-brand-yellow">
          <span className={`inline-block size-[calc(var(--u)*1.4)] rounded-full bg-red-600 ${anim('sc-blink')}`} />COMMERCIAL BREAK
        </p>
        {muted ? (
          <button onClick={onSound} className={`whitespace-nowrap rounded-full bg-brand-yellow px-[calc(var(--u)*2)] py-[0.8vh] text-[length:calc(var(--u)*1.8)] font-black text-ink ${anim('sc-blink')}`}><VolumeX className="mr-2 inline size-[1.1em]" />Click here for sound</button>
        ) : null}
        <p className="tnum whitespace-nowrap text-[length:calc(var(--u)*2)] font-bold text-white/70">Back to the auction in :{String(Math.ceil(leftMs / 1000)).padStart(2, '0')}</p>
      </div>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className={`rounded-[calc(var(--u)*2)] border-[calc(var(--u)*1)] border-neutral-700 bg-neutral-900 p-[calc(var(--u)*0.8)] shadow-[0_0_80px_rgba(245,197,24,0.35)] ${anim('sc-tv-on')}`}>
          <div className="relative aspect-video h-[52vh] overflow-hidden rounded-[calc(var(--u)*1)] bg-black">
            <iframe ref={frame} key={c.startedAt} src={src} title={c.title} allow="autoplay; encrypted-media" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen tabIndex={-1} className="pointer-events-none size-full scale-[1.12] border-0" />
            <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.55) 0 2px, transparent 2px 4px)' }} aria-hidden />
            <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.65)]" aria-hidden />
          </div>
        </div>
        <p className="mt-[1.5vh] text-[length:calc(var(--u)*2)] font-semibold italic text-white/70">{c.tagline}</p>
      </div>
      {item ? (
        <div className={`relative z-10 mb-[3vh] flex w-[92%] items-center gap-[calc(var(--u)*2.5)] rounded-2xl bg-brand-yellow p-[calc(var(--u)*1.2)] text-ink shadow-2xl ${anim('sc-rise')}`}>
          {item.imagePath ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img(item.imagePath)!} alt="" className="h-[11vh] w-[calc(var(--u)*13)] shrink-0 rounded-xl object-cover" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-[length:calc(var(--u)*1.5)] font-black tracking-[0.2em]">{c.opensItem ? 'BIDDING OPENS WHEN THIS ENDS — ITEM' : item.kind === 'live' ? 'COMING UP LIVE TONIGHT' : 'WHILE YOU WATCH — BID ON ITEM'}{c.others.length ? 'S' : ''} {[item.number, ...c.others].map((n) => `#${n}`).join(' & ')}</p>
            <p className="line-clamp-2 font-heading text-[length:calc(var(--u)*2.8)] leading-tight">{item.title}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tnum font-heading text-[length:calc(var(--u)*4)] leading-none">{item.currentBidCents ? formatCents(item.currentBidCents) : item.kind === 'live' ? 'LIVE!' : 'Open!'}</p>
            <p className="text-[length:calc(var(--u)*1.5)] font-bold">{item.kind === 'live' ? 'Scan to see it — bid when it goes live' : 'Scan to bid on your phone'}</p>
          </div>
          {itemQr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={itemQr} alt={`QR code for item ${item.number}`} className="aspect-square h-[13vh] shrink-0 rounded-xl bg-white p-[0.5vh]" />
          ) : null}
        </div>
      ) : <div className="mb-[3vh]" />}
      <div className="absolute bottom-0 left-0 z-10 h-[1vh] bg-brand-yellow" style={{ width: `${total > 0 ? (leftMs / total) * 100 : 0}%` }} />
    </div>
  )
}

// ───────────────────────── activity ticker ─────────────────────────
type TickItem = { tag: string; tone: 'bid' | 'news' | 'tip' | 'pie'; text: string; amount?: string; ago?: string }
const TONE: Record<TickItem['tone'], string> = {
  bid: 'bg-brand-yellow text-black',
  news: 'bg-white text-black',
  tip: 'bg-sky-400 text-black',
  pie: 'bg-pink-500 text-white',
}

function Ticker({ state, reduced }: { state: GameState; reduced: boolean }) {
  // Only verified events: announcements and accepted bids from the database. Tips are fixed reminders.
  const now = new Date(state.serverNow).getTime()
  const close = state.event.silentCloseAt && new Date(state.event.silentCloseAt).getTime() > now ? clockTime(state.event.silentCloseAt, state.event.timezone) : null
  const ago = (iso: string) => {
    const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
    return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`
  }
  const bids: TickItem[] = state.recentBids.slice(0, 8).map((b) => ({ tag: 'NEW BID', tone: 'bid', text: `Bidder #${b.bidderNumber} on #${b.itemNumber} ${b.title}`, amount: formatCents(b.amountCents), ago: ago(b.at) }))
  const news: TickItem[] = state.announcements
    .filter((a) => !a.kind.startsWith('item.provisional'))
    .slice(0, 6)
    .map((a) => ({ tag: a.kind.startsWith('powerup') ? 'POWER-UP' : a.kind.startsWith('pie') ? 'PIE' : 'NEWS', tone: a.kind.startsWith('pie') ? 'pie' : 'news', text: a.headline, ago: ago(a.at) }))
  const tips: TickItem[] = [
    ...(state.pies.enabled ? [{ tag: 'PIE BRANDON', tone: 'pie' as const, text: 'Sign up at the Bid Desk — small', amount: `${formatCents(state.pies.smallPriceCents)}, LARGE ${formatCents(state.pies.largePriceCents)}` }] : []),
    { tag: 'POWER-UPS', tone: 'tip', text: 'Buy one at the Bid Desk to reopen, extend or end an auction.' },
    ...(close ? [{ tag: 'SILENT CLOSES', tone: 'tip' as const, text: 'Final bids in before', amount: close }] : []),
    { tag: 'NO PHONE?', tone: 'tip', text: 'Ask any volunteer — they can place your bid for you.' },
    { tag: 'CHECKOUT', tone: 'tip', text: 'Opens after the silent auction closes: cash, check or card.' },
  ]
  // Round-robin so fresh bids and news are never stuck behind the reminders.
  const items: TickItem[] = []
  for (let i = 0; items.length < bids.length + news.length + tips.length; i++) {
    for (const list of [bids, news, tips]) if (list[i]) items.push(list[i])
  }
  const lines = items.length ? items : [{ tag: 'WELCOME', tone: 'news' as const, text: 'to the StoryChurch auction — YOUR STORY MATTERS.' }]
  const run = [...lines, ...lines]
  const chars = lines.reduce((n, l) => n + l.tag.length + l.text.length + (l.amount?.length ?? 0) + 12, 0)
  const row = (l: TickItem, i: number) => (
    <span key={i} className="flex items-center gap-[calc(var(--u)*1)] text-[length:calc(var(--u)*2.3)] text-white">
      <span className={`rounded-full px-[calc(var(--u)*1)] py-[0.2vh] text-[length:calc(var(--u)*1.5)] font-black tracking-wider ${TONE[l.tone]}`}>{l.tag}</span>
      <span className="font-medium">{l.text}</span>
      {l.amount && <span className="font-black text-brand-yellow">{l.amount}</span>}
      {l.ago && <span className="text-[length:calc(var(--u)*1.5)] text-white/50">{l.ago}</span>}
    </span>
  )
  return (
    <div className="relative flex h-[7vh] shrink-0 items-center overflow-hidden border-t-4 border-brand-yellow bg-gradient-to-b from-neutral-900 to-black">
      <div className="relative z-10 flex h-full shrink-0 items-center gap-[calc(var(--u)*0.8)] bg-brand-yellow px-[calc(var(--u)*2)] text-[length:calc(var(--u)*2.2)] font-black tracking-widest text-black shadow-[8px_0_16px_rgba(0,0,0,0.6)]">
        <span className="h-[calc(var(--u)*1.2)] w-[calc(var(--u)*1.2)] animate-pulse rounded-full bg-red-600" />LIVE
      </div>
      {reduced ? (
        <div className="min-w-0 flex-1 truncate px-[calc(var(--u)*2)]">{row(lines[0], 0)}</div>
      ) : (
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex w-max items-center gap-[calc(var(--u)*5)] whitespace-nowrap pl-[calc(var(--u)*3)]" style={{ animation: `sc-marquee ${Math.max(40, Math.round(chars * 0.2))}s linear infinite` }}>
            {run.map(row)}
          </div>
        </div>
      )}
    </div>
  )
}
