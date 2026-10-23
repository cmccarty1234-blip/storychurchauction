export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
}

/** "$1,200", "1200.5" → cents. Returns null if not a valid non-negative amount with ≤2 decimals. */
export function parseDollars(input: string | number | null | undefined): number | null {
  if (input == null) return null
  const s = String(input).replace(/[\s$,]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const cents = Math.round(parseFloat(s) * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export const MAX_BID_CENTS = 5_000_000 // $50,000 — guards against typos
