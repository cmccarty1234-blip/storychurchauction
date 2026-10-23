import { query, type Db } from './db'

export async function audit(
  e: {
    eventId?: string | null
    actorType: 'admin' | 'bidder' | 'system'
    actorId?: string | null
    action: string
    entityType?: string
    entityId?: string
    details?: Record<string, unknown>
  },
  db?: Db,
) {
  await query(
    `insert into audit_logs (event_id, actor_type, actor_id, action, entity_type, entity_id, details)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [e.eventId ?? null, e.actorType, e.actorId ?? null, e.action, e.entityType ?? null, e.entityId ?? null, JSON.stringify(e.details ?? {})],
    db,
  )
}
