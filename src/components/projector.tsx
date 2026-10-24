'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { Maximize2, Volume2, VolumeX, Zap } from 'lucide-react'
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

  if (!state) return <Shell reduced={reduced}><Center><p className="text-[3vw] text-white/60">Connecting to the auction…</p></Center></Shell>

  const t = now()
  const room = state.room
  let main: React.ReactNode
  if (state.event.emergency) {
    main = (
      <Center>
        <p className="font-heading text-[7vw] leading-none text-brand-yellow">PLEASE STAND BY</p>
        <p className="mt-6 text-[2.6vw] text-white/80">Bidding is paused for a moment.{state.event.emergency.reason ? ` ${state.event.emergency.reason}` : ''}</p>
      </Center>
    )
  } else if (state.event.displayMode === 'message' && state.event.displayMessage) {
    main = <Center><p className="font-heading max-w-[80vw] text-center text-[6vw] leading-tight text-brand-yellow">{state.event.displayMessage}</p></Center>
  } else if (state.event.displayMode === 'welcome') {
    main = <Welcome state={state} qr={qr} joinUrl={joinUrl} />
  } else if (state.event.displayMode === 'thanks') {
    main = <Thanks state={state} />
  } else if (room?.code === 'lightning') {
    main = <LightningView state={state} now={t} />
  } else if (room?.code === 'battle') {
    main = <BattleView state={state} now={t} />
  } else if (room?.code === 'jackpot') {
    main = (
      <Center>
        <p className="font-heading text-[8vw] leading-none text-brand-yellow">MYSTERY JACKPOT!</p>
        <p className="mt-6 text-[3vw]">Everyone who registered is in. Prize: <b className="text-brand-yellow">{String(room.config.prize ?? 'a mystery prize')}</b></p>
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
      <Ticker state={state} reduced={reduced} />
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

/** The church's white wordmark, shown as-is on the dark projector. */
function Logo({ className = 'h-[5vh]' }: { className?: string }) {
  return <Image src="/brand/storychurch-banner.png" alt="Story Church" width={1562} height={286} priority className={`${className} w-auto`} />
}

function Shell({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  return (
    <div data-reduce={reduced} className="relative flex h-screen w-screen flex-col overflow-hidden bg-ink text-white">
      <div className="h-[0.6vh] shrink-0 bg-brand-yellow" aria-hidden />
      <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
const Center = ({ children }: { children: React.ReactNode }) => <div className="flex flex-1 flex-col items-center justify-center px-[4vw] text-center">{children}</div>

function Countdown({ secs, warn, big = false, frozen = false, label }: { secs: number; warn: number; big?: boolean; frozen?: boolean; label?: string }) {
  const danger = !frozen && secs <= 5
  const hot = !frozen && secs <= warn
  return (
    <div className={`text-center ${hot && !frozen ? 'sc-glow' : ''} rounded-3xl border-4 px-[2vw] py-[1vh] ${danger ? 'border-red-500 bg-red-600/20' : hot ? 'border-brand-yellow bg-brand-yellow/10' : 'border-white/30'}`}>
      <div className={`tnum font-heading leading-none ${big ? 'text-[9vw]' : 'text-[7vw]'} ${danger ? 'text-red-400' : hot ? 'text-brand-yellow' : 'text-white'}`}>{mmss(secs)}</div>
      {label ? <div className="mt-1 text-[1.6vw] font-bold tracking-[0.25em] text-white/70">{label}</div> : null}
    </div>
  )
}

// ───────────────────────── Mode B: live auction ─────────────────────────
function LiveView({ state, item, now }: { state: GameState; item: StageItem; now: number }) {
  const emergency = !!state.event.emergency
  const reopened = item.status === 'reopened'
  const clock = liveClock(item, now, emergency)
  const warn = state.event.warningSeconds
  const bids = state.recentBids.filter((b) => b.itemNumber === item.number).slice(0, 5)
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[46%_54%] gap-[2vw] p-[2.5vw]">
      <div className="relative overflow-hidden rounded-3xl border-4 border-brand-yellow bg-charcoal">
        {img(item.imagePath) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img(item.imagePath)!} alt={item.title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center font-heading text-[12vw] text-white/20">#{item.number}</div>
        )}
        <div className="absolute left-0 top-0 rounded-br-3xl bg-brand-yellow px-[1.6vw] py-[0.6vh] font-heading text-[3vw] text-ink">ITEM {item.number}</div>
      </div>
      <div className="flex min-h-0 flex-col justify-between">
        <div>
          <Logo className="mb-[1vh] h-[3.6vh] opacity-80" />
          <h1 className="font-heading text-[4.4vw] leading-[1.02]">{item.title}</h1>
          {reopened ? <p className="sc-pop mt-2 inline-block rounded-full bg-brand-yellow px-4 py-1 text-[2vw] font-bold text-ink">{item.timerPhase === 'challenge' ? 'CHALLENGE — everyone can respond!' : 'RESURRECTED — this auction is back!'}</p> : null}
        </div>
        <div className="space-y-[1.2vh]">
          <div>
            <p className="text-[1.6vw] font-bold tracking-[0.25em] text-white/60">CURRENT BID</p>
            <p className="tnum font-heading text-[9vw] leading-none text-brand-yellow">{item.currentBidCents != null ? formatCents(item.currentBidCents) : 'OPEN'}</p>
            <p className="mt-1 text-[2.6vw] font-bold">{item.leaderNumber ? <>Bidder <span className="text-brand-yellow">#{item.leaderNumber}</span> leads</> : 'Be the first to bid!'}</p>
            <p className="text-[1.9vw] text-white/70">Next bid: <b className="text-white">{formatCents(item.minNextCents)}</b></p>
          </div>
          {clock ? <Countdown secs={clock.secs} warn={warn} big frozen={clock.frozen} label={clock.label} /> : null}
        </div>
        <div className="space-y-[0.6vh]">
          {bids.map((b, i) => (
            <p key={b.at + i} className="sc-slide text-[1.9vw] text-white/80">
              <span className="font-bold text-brand-yellow">#{b.bidderNumber}</span> bid <b className="text-white">{formatCents(b.amountCents)}</b>
            </p>
          ))}
        </div>
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
    <div className="rounded-2xl bg-white p-[1.2vw] text-center text-ink">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code to register and bid" className={`mx-auto aspect-square ${big ? 'w-[26vh]' : 'w-[18vh]'}`} />
      <p className={`mt-[0.8vh] font-heading leading-tight ${big ? 'text-[2.6vw]' : 'text-[1.9vw]'}`}>BID FROM YOUR PHONE</p>
      <p className={`font-bold text-ink/70 ${big ? 'text-[1.7vw]' : 'text-[1.3vw]'}`}>Scan to register &amp; bid</p>
      <p className={`mt-[0.4vh] font-bold ${big ? 'text-[1.6vw]' : 'text-[1.2vw]'}`}>{shortUrl(joinUrl)}</p>
    </div>
  )
}

function Dashboard({ state, now, qr, joinUrl }: { state: GameState; now: number; qr: string; joinUrl: string }) {
  const tt = state.totals
  // One headline number: every winning/leading bid plus Power-Up sales.
  const committed = tt.leadingCents + tt.finalizedCents + tt.powerupCents
  const goal = state.event.goalCents
  const pct = goal ? Math.min(100, (committed / goal) * 100) : 0
  const closeSecs = state.event.silentCloseAt ? secsUntil(state.event.silentCloseAt, now) : null
  const closed = closeSecs != null && closeSecs <= 0
  const finalStretch = closeSecs != null && closeSecs > 0 && closeSecs <= 15 * 60
  const chance = [...state.reopened, ...state.lastChance].slice(0, 3)
  const spots = state.hot
  const spot = spots.length ? spots[Math.floor(now / 8000) % spots.length] : null
  const tz = state.event.timezone
  const tips = [
    'POWER-UPS! Buy one at the bidding desk to reopen, extend or end an auction.',
    ...(closeSecs != null && !closed ? [`The silent auction closes at ${clockTime(state.event.silentCloseAt, tz)}. Get your final bids in!`] : []),
    ...(state.nextLive ? [`UP NEXT LIVE: #${state.nextLive.number} ${state.nextLive.title} — opens at ${formatCents(state.nextLive.startingBidCents)}`] : []),
    'Checkout opens after the silent auction closes. Pay by cash, check or card.',
    'No phone? Ask any volunteer — they can place your bid for you.',
  ]
  const tip = tips[Math.floor(now / 10000) % tips.length]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.4vh] p-[2vw]">
      <div className="flex items-center justify-between gap-[2vw]">
        <Logo className="h-[6vh]" />
        <p className="font-heading text-[2vw] tracking-wide text-white/70">YOUR STORY MATTERS.</p>
      </div>

      <div className="grid grid-cols-[1.6fr_1fr] gap-[1.2vw]">
        <div className="rounded-2xl border border-white/20 bg-white/5 px-[2vw] py-[1.2vh]">
          <div className="flex items-baseline justify-between">
            <p className="text-[1.7vw] font-bold tracking-[0.25em] text-white/60">TOTAL COMMITTED</p>
            <p className="text-[1.7vw] font-bold text-white/70">{state.bidsTonight} bids tonight</p>
          </div>
          <p className="tnum font-heading text-[7.5vw] leading-none text-brand-yellow">{formatCents(committed)}</p>
          {goal ? (
            <div className="mt-[1vh]">
              <div className="h-[2.4vh] overflow-hidden rounded-full bg-white/15" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress toward the fundraising goal">
                <div className="h-full rounded-full bg-brand-yellow transition-all duration-1000" style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-[0.4vh] text-[1.7vw] font-bold text-white/80">{Math.floor(pct)}% of our {formatCents(goal)} goal</p>
            </div>
          ) : null}
        </div>
        <div className={`flex flex-col items-center justify-center rounded-2xl border-2 px-[1.5vw] py-[1.2vh] text-center ${finalStretch ? 'sc-glow border-brand-yellow bg-brand-yellow/10' : 'border-white/20 bg-white/5'}`}>
          <p className="text-[1.6vw] font-bold tracking-[0.2em] text-white/60">{closed ? 'SILENT AUCTION' : 'SILENT AUCTION CLOSES IN'}</p>
          <p className={`tnum font-heading leading-none ${finalStretch ? 'text-[8vw] text-brand-yellow' : 'text-[6vw]'}`}>{closeSecs == null ? '—' : closed ? 'CLOSED' : hms(closeSecs)}</p>
          {finalStretch ? <p className="mt-1 text-[1.8vw] font-bold text-brand-yellow">FINAL CALL FOR SILENT BIDS!</p> : null}
        </div>
      </div>

      {chance.length ? (
        <div className="sc-pop rounded-2xl bg-brand-yellow px-[2vw] py-[1vh] text-ink">
          <p className="font-heading text-[2vw]">LAST CHANCE — NOT FINAL YET!</p>
          {chance.map((i) => (
            <p key={i.id} className="flex justify-between gap-4 text-[2vw] font-bold">
              <span className="truncate">#{i.number} {i.title} — {formatCents(i.currentBidCents)} (bidder #{i.leaderNumber ?? '—'}{i.status === 'reopened' ? ', REOPENED' : ''})</span>
              <span className="tnum shrink-0">{mmss(secsUntil(i.status === 'reopened' ? i.deadlineAt : i.provisionalUntil, now))}</span>
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-[1.2vw]">
        <div className="min-h-0 overflow-hidden rounded-2xl border border-white/20 bg-white/5">
          {spot ? (
            <div key={spot.id} className="sc-slide grid h-full grid-cols-[1.05fr_1fr]">
              <div className="relative bg-charcoal">
                {img(spot.imagePath) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img(spot.imagePath)!} alt={spot.title} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center font-heading text-[8vw] text-white/20">#{spot.number}</div>
                )}
                <div className="absolute left-0 top-0 rounded-br-2xl bg-brand-yellow px-[1.2vw] py-[0.4vh] font-heading text-[2.2vw] text-ink">ITEM {spot.number}</div>
              </div>
              <div className="flex min-h-0 flex-col justify-center gap-[1vh] p-[1.8vw]">
                <p className="text-[1.5vw] font-bold tracking-[0.22em] text-brand-yellow">HOT RIGHT NOW</p>
                <h2 className="font-heading text-[3.2vw] leading-[1.05]">{spot.title}</h2>
                <p className="tnum font-heading text-[6.5vw] leading-none text-brand-yellow">{formatCents(spot.currentBidCents)}</p>
                <p className="text-[2vw] font-bold">Bidder <span className="text-brand-yellow">#{spot.leaderNumber ?? '—'}</span> leads · {spot.bidCount} bids</p>
                {spot.closesAt ? <p className="text-[1.7vw] text-white/70">Closes in <b className="tnum text-white">{hms(secsUntil(spot.closesAt, now))}</b></p> : null}
              </div>
            </div>
          ) : (
            <Center>
              <Logo className="h-[12vh]" />
              <p className="mt-[3vh] font-heading text-[4vw] text-brand-yellow">BIDS WILL SHOW UP HERE</p>
              <p className="mt-2 text-[2vw] text-white/70">Scan the code and place the first bid!</p>
            </Center>
          )}
        </div>
        <div className="flex min-h-0 flex-col gap-[1.2vh]">
          <QrCard qr={qr} joinUrl={joinUrl} />
          <div key={tip} className="sc-slide flex flex-1 items-center rounded-2xl border border-brand-yellow/60 bg-brand-yellow/10 px-[1.4vw] py-[1vh]">
            <p className="text-[1.8vw] font-bold leading-snug">{tip}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── host-selected screens ─────────────────────────
function Welcome({ state, qr, joinUrl }: { state: GameState; qr: string; joinUrl: string }) {
  const close = clockTime(state.event.silentCloseAt, state.event.timezone)
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.3fr_1fr] items-center gap-[3vw] px-[4vw]">
      <div>
        <Logo className="h-[11vh]" />
        <p className="mt-[3vh] font-heading text-[9vw] leading-[0.95] text-brand-yellow">WELCOME!</p>
        <p className="mt-[2vh] text-[2.8vw] font-bold leading-snug">Scan the code to register and start bidding from your phone.</p>
        {close ? <p className="mt-[1.5vh] text-[2.2vw] text-white/75">The silent auction closes at <b className="text-white">{close}</b>.</p> : null}
        <p className="mt-[3vh] font-heading text-[2.2vw] tracking-wide text-white/70">YOUR STORY MATTERS.</p>
      </div>
      <QrCard qr={qr} joinUrl={joinUrl} big />
    </div>
  )
}

function Thanks({ state }: { state: GameState }) {
  const tt = state.totals
  const committed = tt.leadingCents + tt.finalizedCents + tt.powerupCents
  return (
    <Center>
      <Logo className="h-[9vh]" />
      <p className="sc-pop mt-[3vh] font-heading text-[10vw] leading-none text-brand-yellow">THANK YOU!</p>
      <p className="mt-[2vh] text-[2.8vw] font-bold">Together we raised</p>
      <p className="tnum font-heading text-[11vw] leading-none">{formatCents(committed)}</p>
      <p className="mt-[3vh] max-w-[80vw] whitespace-pre-line text-[2.4vw] font-bold leading-snug">{state.event.pickup.trim() || 'Please visit the checkout table to pay and pick up your items.'}</p>
      <p className="mt-[2vh] font-heading text-[2.2vw] tracking-wide text-white/70">YOUR STORY MATTERS.</p>
    </Center>
  )
}

// ───────────────────────── Mode D: Room Events ─────────────────────────
function LightningView({ state, now }: { state: GameState; now: number }) {
  const room = state.room!
  const secs = secsUntil(room.endsAt, now)
  const nums = (room.lightningItems ?? []).slice(0, 24)
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2vh] px-[3vw] text-center">
      <p className="sc-pop font-heading text-[9vw] leading-none text-brand-yellow">⚡ LIGHTNING ROUND! ⚡</p>
      <p className="text-[2.8vw]">Bids go up by just <b className="text-brand-yellow">$1</b> on these silent items — get your phone out!</p>
      <Countdown secs={secs} warn={10} big label="TIME LEFT" />
      <p className="max-w-[85vw] text-[2.4vw] font-bold">Items: {nums.map((n) => `#${n}`).join('  ')}</p>
      <div className="space-y-1">
        {state.recentBids.slice(0, 4).map((b, i) => (
          <p key={b.at + i} className="sc-slide text-[2vw] text-white/80"><b className="text-brand-yellow">#{b.bidderNumber}</b> bid {formatCents(b.amountCents)} on {b.title}</p>
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
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-[3vh] px-[4vw]">
      <p className="text-center font-heading text-[7vw] leading-none text-brand-yellow">BATTLE OF THE ROOM!</p>
      <div className="mx-auto"><Countdown secs={secs} warn={10} label="TIME LEFT" /></div>
      <div className="grid grid-cols-2 gap-[3vw] text-center">
        <div className="rounded-3xl bg-brand-yellow p-[2vw] text-ink"><p className="font-heading text-[3vw]">TEAM GOLD</p><p className="tnum font-heading text-[9vw] leading-none">{b.gold.points}</p><p className="text-[1.4vw] font-bold">{b.gold.bids} bids · {b.gold.players} players</p></div>
        <div className="rounded-3xl border-4 border-brand-yellow bg-black p-[2vw]"><p className="font-heading text-[3vw] text-brand-yellow">TEAM BLACK</p><p className="tnum font-heading text-[9vw] leading-none">{b.black.points}</p><p className="text-[1.4vw] font-bold text-white/70">{b.black.bids} bids · {b.black.players} players</p></div>
      </div>
      <div className="flex h-[4vh] overflow-hidden rounded-full border-2 border-white/40">
        <div className="bg-brand-yellow transition-all duration-700" style={{ width: `${(b.gold.points / total) * 100}%` }} />
        <div className="flex-1 bg-black" />
      </div>
      <p className="text-center text-[1.5vw] text-white/60">Game points, not dollars. {String(room.config.reward ?? '') ? <>Reward: <b className="text-white">{String(room.config.reward)}</b>. </> : null}Each accepted bid scores 10 points + 1 per $10 it raises the price.</p>
    </div>
  )
}

// ───────────────────────── Modes C & E: overlays ─────────────────────────
function Overlay({ a, state }: { a: Ann; state: GameState }) {
  const isSold = a.kind === 'item.sold'
  const isJackpot = a.kind === 'room.jackpot.winner'
  const item = a.itemId ? [...state.lastChance, ...state.reopened, state.stage].find((i) => i?.id === a.itemId) : null
  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-ink/95 px-[5vw] text-center" role="alert">
      <div className="absolute top-[3vh]"><Logo className="h-[6vh]" /></div>
      {isSold ? <Confetti /> : null}
      {isJackpot ? (
        <Jackpot a={a} />
      ) : (
        <>
          <p className="sc-pop font-heading text-[8.5vw] leading-[1.02] text-brand-yellow">{isSold ? 'SOLD!' : a.headline}</p>
          {isSold ? (
            <>
              <p className="sc-pop mt-4 text-[3.6vw] font-bold">{String(a.payload.bidderNumber ? `Bidder #${a.payload.bidderNumber}` : '')}</p>
              <p className="tnum sc-pop font-heading text-[11vw] leading-none">{formatCents(Number(a.payload.amountCents ?? 0))}</p>
              <p className="mt-3 text-[2.6vw] text-white/80">{a.headline.replace(/^SOLD!\s*/, '').split(' — ')[0]}</p>
            </>
          ) : (
            <>
              {a.body ? <p className="mt-4 text-[3vw] font-bold">{a.body}</p> : null}
              {item ? <p className="mt-2 text-[2.2vw] text-white/70">Currently {formatCents(item.currentBidCents)}{item.provisionalUntil ? ' · last-chance window open' : ''}</p> : null}
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
      <p className="font-heading text-[7vw] leading-none text-brand-yellow">MYSTERY JACKPOT!</p>
      <p className={`tnum font-heading mt-6 text-[18vw] leading-none ${done ? 'sc-pop text-white' : 'text-white/60'}`}>{shown != null ? `#${shown}` : '…'}</p>
      <p className="mt-4 text-[3vw]">{done ? <>wins <b className="text-brand-yellow">{String(a.payload.prize ?? 'the prize')}</b>!</> : `Drawing from ${entries} registered guests…`}</p>
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

// ───────────────────────── activity ticker ─────────────────────────
function Ticker({ state, reduced }: { state: GameState; reduced: boolean }) {
  // Only verified events: announcements and accepted bids from the database.
  const lines = [
    ...state.announcements.filter((a) => !a.kind.startsWith('item.provisional')).slice(0, 8).map((a) => a.headline),
    ...state.recentBids.slice(0, 6).map((b) => `Bidder #${b.bidderNumber} bid ${formatCents(b.amountCents)} on ${b.title}`),
  ]
  const text = lines.length ? lines : ['Welcome to the StoryChurch auction — YOUR STORY MATTERS.']
  const run = [...text, ...text]
  return (
    <div className="h-[6.5vh] shrink-0 overflow-hidden border-t-2 border-brand-yellow bg-black">
      {reduced ? (
        <p className="truncate px-[2vw] py-[1.2vh] text-[2vw] text-white/90">{text[0]}</p>
      ) : (
        <div className="flex w-max items-center gap-[4vw] whitespace-nowrap py-[1.2vh] pl-[2vw]" style={{ animation: `sc-marquee ${Math.max(30, run.length * 5)}s linear infinite` }}>
          {run.map((l, i) => (
            <span key={i} className="text-[2vw] text-white/90"><span className="mr-[1.5vw] text-brand-yellow">●</span>{l}</span>
          ))}
        </div>
      )}
    </div>
  )
}
