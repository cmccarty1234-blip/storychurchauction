import type { ClientConfig } from 'pg'

/**
 * Connection settings shared by the pool, the realtime LISTEN client and the migration runner.
 *
 * Hosted Postgres (Supabase) requires TLS. Node's driver treats `?sslmode=require` in the URL as "verify the
 * certificate chain", which fails against Supabase's pooler, and URL settings override explicit ones — so we strip
 * `sslmode` from the URL and set `ssl` ourselves. Local Postgres (127.0.0.1) stays plain.
 */
export function pgConfig(url: string): ClientConfig {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    // Deliberately do not echo the value: a mistaken paste is often a password.
    throw new Error('AUCTION_DATABASE_URL is not a valid connection string. It must be the full address starting with postgresql:// (Supabase → Connect → Session pooler), not just a password.')
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname)
  const forced = process.env.AUCTION_DB_SSL // 'true' | 'false' to override detection
  const useSsl = forced ? forced === 'true' : !local
  u.searchParams.delete('sslmode')
  return {
    connectionString: u.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  }
}
