/**
 * Turns a database error into a coarse, secret-free reason for /api/health.
 * Only a category and (for Postgres errors) the standard SQLSTATE code are ever exposed — never the message,
 * host, user or connection string.
 */
export type DbReason =
  | 'bad_connection_string' | 'password' | 'project_or_user' | 'too_many_connections' | 'host_not_found'
  | 'connection_refused' | 'timeout' | 'tls' | 'tables_missing' | 'unknown'

export function classifyDbError(e: unknown): { reason: DbReason; code?: string } {
  const err = e as { code?: string; message?: string }
  const msg = String(err?.message ?? '')
  const code = typeof err?.code === 'string' ? err.code : undefined
  const reason: DbReason =
    /not a valid connection string|Invalid URL/i.test(msg) ? 'bad_connection_string'
    : code === '28P01' || /password authentication failed/i.test(msg) ? 'password'
    : /tenant or user not found|tenant\/user .* not found/i.test(msg) ? 'project_or_user'
    : code === '53300' || /max client|MaxClients|too many (clients|connections)|remaining connection slots/i.test(msg) ? 'too_many_connections'
    : code === 'ENOTFOUND' ? 'host_not_found'
    : code === 'ECONNREFUSED' ? 'connection_refused'
    : code === 'ETIMEDOUT' || /timeout|timed out/i.test(msg) ? 'timeout'
    : /SSL|TLS|certificate/i.test(msg) ? 'tls'
    : code === '42P01' ? 'tables_missing'
    : 'unknown'
  return { reason, code }
}
