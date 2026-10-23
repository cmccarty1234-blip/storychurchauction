import { z } from 'zod'
import { AppError } from './errors'

type Handler<C> = (req: Request, ctx: C) => Promise<unknown>

/** Wraps a route handler: same-origin check for writes, JSON in/out, AppError → structured error. */
export function route<C = unknown>(fn: Handler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.get('origin')
        if (origin && new URL(origin).host !== req.headers.get('host')) throw new AppError('BAD_ORIGIN', 'Cross-site request blocked.', 403)
      }
      const out = await fn(req, ctx)
      if (out instanceof Response) return out
      return Response.json(out ?? { ok: true })
    } catch (e) {
      if (e instanceof AppError) {
        return Response.json({ error: { code: e.code, message: e.message, ...e.data } }, { status: e.status })
      }
      console.error('[api] unexpected error', e)
      return Response.json({ error: { code: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' } }, { status: 500 })
    }
  }
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw new AppError('INVALID_REQUEST', 'Invalid request.')
  }
  const r = schema.safeParse(raw)
  if (!r.success) throw new AppError('INVALID_REQUEST', r.error.issues[0]?.message ?? 'Invalid request.')
  return r.data
}

export const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id')
