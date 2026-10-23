import { describe, expect, it } from 'vitest'
import { classifyDbError } from '@/lib/health'

const e = (message: string, code?: string) => Object.assign(new Error(message), code ? { code } : {})

describe('database error classification (for /api/health)', () => {
  it.each([
    [e('password authentication failed for user "postgres"', '28P01'), 'password'],
    [e('(ENOTFOUND) tenant/user postgres.abc not found'), 'project_or_user'],
    [e('Tenant or user not found'), 'project_or_user'],
    [e('MaxClientsInSessionMode: max clients reached - in Session mode max clients are limited to pool_size'), 'too_many_connections'],
    [e('remaining connection slots are reserved', '53300'), 'too_many_connections'],
    [e('getaddrinfo ENOTFOUND aws-0-xxxx.pooler.supabase.com', 'ENOTFOUND'), 'host_not_found'],
    [e('connect ECONNREFUSED 127.0.0.1:54329', 'ECONNREFUSED'), 'connection_refused'],
    [e('Connection terminated due to connection timeout'), 'timeout'],
    [e('self-signed certificate in certificate chain'), 'tls'],
    [e('relation "events" does not exist', '42P01'), 'tables_missing'],
    [e('AUCTION_DATABASE_URL is not a valid connection string. It must be…'), 'bad_connection_string'],
    [e('something nobody has seen before'), 'unknown'],
  ])('%#', (err, reason) => {
    expect(classifyDbError(err).reason).toBe(reason)
  })

  it('never returns the message, host or credentials', () => {
    const out = JSON.stringify(classifyDbError(e('password authentication failed for user "postgres.abcd" at aws-0-us-west-2.pooler.supabase.com', '28P01')))
    expect(out).not.toMatch(/postgres\.abcd|pooler|supabase/)
  })
})
