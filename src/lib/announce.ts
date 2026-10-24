import type pg from 'pg'
import { notify } from './realtime'

/**
 * Writes a projector / ticker message. Callers only announce things that REALLY happened (inside the same
 * transaction as the event itself), so the feed can never show a bid, power-up or winner that does not exist.
 */
export async function announce(
  c: pg.PoolClient,
  a: { eventId: string; kind: string; headline: string; body?: string; itemId?: string; payload?: Record<string, unknown>; interrupt?: boolean },
) {
  await c.query(
    'insert into announcements (event_id, kind, headline, body, item_id, payload, interrupt) values ($1,$2,$3,$4,$5,$6,$7)',
    [a.eventId, a.kind, a.headline, a.body ?? null, a.itemId ?? null, JSON.stringify(a.payload ?? {}), a.interrupt ?? false],
  )
  await notify(c, { t: 'game' })
}
