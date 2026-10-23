'use client'

import { useEffect, useState } from 'react'

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${String(sec).padStart(2, '0')}`
}

/** Time remaining until `closesAt`. Renders nothing until mounted (avoids server/client clock mismatch). */
export function Countdown({ closesAt, className }: { closesAt: string | Date; className?: string }) {
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const t = new Date(closesAt).getTime()
    const tick = () => setLeft(t - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [closesAt])
  if (left === null) return <span className={className}>&nbsp;</span>
  if (left <= 0) return <span className={className}>Closed</span>
  const urgent = left < 10 * 60 * 1000
  return (
    <span className={`${className ?? ''} tnum ${urgent ? 'font-semibold text-danger' : ''}`} aria-label={`${fmt(left)} remaining`}>
      {fmt(left)} left
    </span>
  )
}
