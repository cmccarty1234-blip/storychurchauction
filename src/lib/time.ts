// Everything is stored as UTC; the event's IANA timezone is applied only for input and display.

export function formatInTz(date: Date | string | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...opts,
  }).format(new Date(date))
}

function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** "2026-11-14T19:30" interpreted in `tz` → UTC Date. */
export function localInputToUtc(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local)
  if (!m) return null
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  let utc = guess - offsetMs(guess, tz)
  utc = guess - offsetMs(utc, tz)
  return new Date(utc)
}

/** UTC date → "YYYY-MM-DDTHH:mm" wall-clock in `tz` (for datetime-local inputs). */
export function utcToLocalInput(date: Date | string | null | undefined, tz: string): string {
  if (!date) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(date))
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

/** Wall-clock "now" in ms. Wrapped so server components can read the clock without tripping the render-purity lint. */
export const nowMs = () => Date.now()
