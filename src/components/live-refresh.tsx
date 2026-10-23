'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const MIN_GAP_MS = 1500 // at most one re-render per device every 1.5 s, however fast bids arrive

/**
 * Keeps the page current without a manual refresh. Listens to /api/stream (Server-Sent Events) and
 * re-renders the server component when anything changes. Two safety nets so a flaky venue network or a
 * host that can't hold streams open degrades to "a few seconds late" instead of "silently stale":
 *   • if the stream drops, poll every `fallbackMs`
 *   • even while connected, poll slowly in case the stream is open but silent
 */
export function LiveRefresh({ fallbackMs = 8000, showStatus = false }: { fallbackMs?: number; showStatus?: boolean }) {
  const router = useRouter()
  const [connected, setConnected] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const last = useRef(0)

  useEffect(() => {
    let es: EventSource | null = null
    let closed = false
    let isConnected = false

    const refresh = () => {
      if (timer.current) return // one is already queued — it will pick up the latest data
      const wait = Math.max(0, last.current + MIN_GAP_MS - Date.now()) + 100 + Math.random() * 400 // jitter: 250 phones shouldn't all query in the same instant
      timer.current = setTimeout(() => {
        timer.current = null
        if (document.visibilityState !== 'visible') return
        last.current = Date.now()
        router.refresh()
      }, wait)
    }

    const open = () => {
      if (closed) return
      es = new EventSource('/api/stream')
      es.onopen = () => {
        isConnected = true
        setConnected(true)
        refresh() // catch up on anything missed while disconnected
      }
      es.onmessage = refresh
      es.onerror = () => {
        isConnected = false
        setConnected(false)
      }
    }
    open()

    let sinceLast = 0
    const tick = setInterval(() => {
      sinceLast += 1000
      const every = isConnected ? Math.max(fallbackMs, 10_000) : fallbackMs
      if (sinceLast >= every) {
        sinceLast = 0
        refresh()
      }
    }, 1000)

    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', refresh)
    return () => {
      closed = true
      es?.close()
      clearInterval(tick)
      if (timer.current) clearTimeout(timer.current)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', refresh)
    }
  }, [router, fallbackMs])

  if (!showStatus) return null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <span className={`size-2 rounded-full ${connected ? 'bg-success' : 'bg-amber-500'}`} aria-hidden />
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  )
}
