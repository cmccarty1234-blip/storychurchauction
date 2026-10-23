export type ApiError = { code: string; message: string; [k: string]: unknown }
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

/** POST JSON. A network failure is reported as such — callers must never show success unless ok === true. */
export async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data.error ?? { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } }
    return { ok: true, data: data as T }
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'Couldn’t reach the server — nothing was saved. Check your connection and try again.' } }
  }
}

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)
