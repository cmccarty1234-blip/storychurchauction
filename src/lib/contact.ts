export type Contact = { type: 'phone' | 'email'; value: string }

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim()
  const only = trimmed.replace(/\D/g, '')
  if (trimmed.startsWith('+')) return only.length >= 8 && only.length <= 15 ? `+${only}` : null
  if (only.length === 10) return `+1${only}`
  if (only.length === 11 && only.startsWith('1')) return `+${only}`
  return null
}

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254 ? e : null
}

/** Accepts whatever the guest typed in the single "phone or email" field. */
export function parseContact(raw: string): Contact | null {
  const s = raw.trim()
  if (!s) return null
  if (s.includes('@')) {
    const v = normalizeEmail(s)
    return v ? { type: 'email', value: v } : null
  }
  const v = normalizePhone(s)
  return v ? { type: 'phone', value: v } : null
}

export function formatPhone(p: string | null | undefined): string {
  if (!p) return ''
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p
}
