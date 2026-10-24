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

export function Projector() {
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
    main = <Dashboard state={state} now={t} />
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

// ───────────────────────── Mode A: dashboard ─────────────────────────
function Dashboard({ state, now }: { state: GameState; now: number }) {
  const tt = state.totals
  const tiles = [
    { l: 'TOTAL COMMITTED (bids)', v: tt.leadingCents + tt.finalizedCents, sub: 'leading + won bids — not yet collected' },
    { l: 'PAYMENTS RECEIVED', v: tt.paymentsCents, sub: 'auction items, actually paid' },
    { l: 'POWER-UP SALES', v: tt.powerupCents, sub: 'collected at the bidding desk' },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.5vh] p-[2vw]">
      <div className="flex items-center justify-between gap-[2vw]">
        <div className="min-w-0">
          <Logo className="h-[6vh]" />
          <h1 className="mt-[0.6vh] truncate font-heading text-[2.4vw] text-brand-yellow">{state.event.name}</h1>
        </div>
        <p className="font-heading text-[2vw] tracking-wide text-white/70">YOUR STORY MATTERS.</p>
      </div>
      <div className="grid grid-cols-3 gap-[1.2vw]">
        {tiles.map((x) => (
          <div key={x.l} className="rounded-2xl border border-white/20 bg-white/5 p-[1.2vw]">
            <p className="text-[1.2vw] font-bold tracking-[0.18em] text-white/60">{x.l}</p>
            <p className="tnum font-heading text-[5vw] leading-none text-brand-yellow">{formatCents(x.v)}</p>
            <p className="text-[1vw] text-white/50">{x.sub}</p>
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-[1.2vw]">
        <Panel title="LAST CHANCE" accent>
          {state.lastChance.length + state.reopened.length === 0 ? <Empty>No items in their last-chance window.</Empty> : null}
          {[...state.reopened, ...state.lastChance].slice(0, 5).map((i) => {
            const secs = secsUntil(i.provisionalUntil, now)
            return (
              <Row key={i.id} left={<><b className="text-brand-yellow">#{i.number}</b> {i.title}</>} right={<><span className="tnum font-bold">{formatCents(i.currentBidCents)}</span> <span className="tnum ml-2 text-brand-yellow">{mmss(secs)}</span></>} sub={`Provisional: bidder #${i.leaderNumber ?? '—'}${i.status === 'reopened' ? ' · REOPENED' : ''}`} />
            )
          })}
        </Panel>
        <Panel title="CLOSING SOON">
          {state.closingSoon.length === 0 ? <Empty>No silent items closing in the next 20 minutes.</Empty> : null}
          {state.closingSoon.map((i) => (
            <Row key={i.id} left={<><b className="text-brand-yellow">#{i.number}</b> {i.title}</>} right={<span className="tnum text-brand-yellow">{mmss(secsUntil(i.closesAt, now))}</span>} sub={formatCents(i.currentBidCents)} />
          ))}
          {state.nextLive ? (
            <div className="mt-3 rounded-xl border border-brand-yellow/60 p-[0.8vw]">
              <p className="text-[1.1vw] font-bold tracking-[0.2em] text-brand-yellow">UP NEXT LIVE</p>
              <p className="text-[1.9vw] font-bold">#{state.nextLive.number} {state.nextLive.title}</p>
              <p className="text-[1.2vw] text-white/60">Opens at {formatCents(state.nextLive.startingBidCents)}</p>
            </div>
          ) : null}
        </Panel>
        <Panel title="HOTTEST SILENT ITEMS">
          {state.hot.length === 0 ? <Empty>Bids will show up here.</Empty> : null}
          {state.hot.map((i) => (
            <Row key={i.id} left={<><b className="text-brand-yellow">#{i.number}</b> {i.title}</>} right={<span className="tnum font-bold">{formatCents(i.currentBidCents)}</span>} sub={`${i.bidCount} bids · bidder #${i.leaderNumber ?? '—'} leads`} />
          ))}
        </Panel>
      </div>
    </div>
  )
}

const Panel = ({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) => (
  <section className={`flex min-h-0 flex-col overflow-hidden rounded-2xl border p-[1vw] ${accent ? 'border-brand-yellow bg-brand-yellow/5' : 'border-white/20 bg-white/5'}`}>
    <h2 className="mb-[1vh] font-heading text-[1.7vw] tracking-wide text-brand-yellow">{title}</h2>
    <div className="min-h-0 flex-1 space-y-[0.8vh] overflow-hidden">{children}</div>
  </section>
)
const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-[1.3vw] text-white/40">{children}</p>
const Row = ({ left, right, sub }: { left: React.ReactNode; right: React.ReactNode; sub?: string }) => (
  <div className="border-b border-white/10 pb-[0.6vh]">
    <div className="flex items-baseline justify-between gap-3 text-[1.6vw]"><span className="truncate">{left}</span><span className="shrink-0">{right}</span></div>
    {sub ? <p className="text-[1.1vw] text-white/50">{sub}</p> : null}
  </div>
)

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
