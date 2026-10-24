'use client'

import { useEffect, useRef, useState } from 'react'
import type { GameState } from './game-state'

/**
 * Polls /api/game/state (which also advances any due timer on the server) and refetches immediately when the
 * realtime stream says something changed. `now()` returns SERVER time, so countdowns match on every screen
 * whatever the device's own clock says.
 */
export function useGameState(intervalMs = 1500) {
  const [state, setState] = useState<GameState | null>(null)
  const [online, setOnline] = useState(true)
  const [offset, setOffset] = useState(0) // server clock minus this device's clock
  const loader = useRef<() => void>(() => {})

  useEffect(() => {
    let inflight = false
    let pending = false
    let alive = true
    const load = async () => {
      if (inflight) {
        pending = true
        return
      }
      inflight = true
      const t0 = Date.now()
      try {
        const res = await fetch('/api/game/state', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const s = (await res.json()) as GameState
        const t1 = Date.now()
        if (alive) {
          setOffset(new Date(s.serverNow).getTime() - (t0 + t1) / 2) // assume symmetric latency
          setState(s)
          setOnline(true)
        }
      } catch {
        if (alive) setOnline(false)
      } finally {
        inflight = false
        if (pending) {
          pending = false
          void load()
        }
      }
    }
    loader.current = () => void load()
    const first = setTimeout(() => void load(), 0)
    const poll = setInterval(() => void load(), intervalMs)
    let es: EventSource | null = null
    let last = 0
    try {
      es = new EventSource('/api/stream')
      es.onmessage = () => {
        if (Date.now() - last > 300) {
          last = Date.now()
          void load()
        }
      }
    } catch {}
    const onVisible = () => document.visibilityState === 'visible' && void load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      alive = false
      clearTimeout(first)
      clearInterval(poll)
      es?.close()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [intervalMs])

  const reload = () => loader.current()
  const now = () => Date.now() + offset
  return { state, online, now, reload }
}

/** Re-renders every `ms` so countdowns animate. */
export function useTicker(ms = 100) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms)
    return () => clearInterval(id)
  }, [ms])
}

/** Seconds remaining (fractional, never negative) until an ISO deadline, by server time. */
export function secsUntil(iso: string | null | undefined, now: number) {
  return iso ? Math.max(0, (new Date(iso).getTime() - now) / 1000) : 0
}

export const mmss = (secs: number) => {
  const s = Math.ceil(secs)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What the live timer should show right now, taking pause/emergency into account. */
export function liveClock(item: GameState['stage'], now: number, emergency: boolean) {
  if (!item) return null
  if (item.status === 'paused') return { secs: (item.pauseRemainingMs ?? 0) / 1000, frozen: true, label: item.haltKind === 'emergency' ? 'STOPPED' : 'PAUSED' }
  if (emergency) return { secs: secsUntil(item.deadlineAt, now), frozen: true, label: 'STANDING BY' }
  const secs = secsUntil(item.deadlineAt, now)
  return { secs, frozen: false, label: item.timerPhase === 'countdown' ? 'GOING ONCE…' : 'BIDDING OPEN' }
}
