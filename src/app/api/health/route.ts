import { one } from '@/lib/db'
import { classifyDbError } from '@/lib/health'

export const dynamic = 'force-dynamic'

/** Public, secret-free status check: is the database reachable, and does the event exist? */
export async function GET() {
  try {
    const row = await one<{ n: number }>('select count(*)::int as n from events')
    return Response.json({ ok: true, database: 'reachable', eventExists: (row?.n ?? 0) > 0 }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const { reason, code } = classifyDbError(e)
    return Response.json({ ok: false, database: 'unreachable', reason, code }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
