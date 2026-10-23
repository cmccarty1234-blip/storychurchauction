import pg from 'pg'
import { pgConfig } from './pgconfig'

// int8 (count/sum/identity) → number. Our values never approach 2^53.
pg.types.setTypeParser(20, (v) => parseInt(v, 10))
// date (no time) → 'YYYY-MM-DD' string, not a timezone-shifted JS Date.
pg.types.setTypeParser(1082, (v) => v)

type G = typeof globalThis & { __auctionPool?: pg.Pool }
const g = globalThis as G

// Deliberately NOT named DATABASE_URL so a shell variable for another project can never be picked up.
export function dbUrl() {
  const url = process.env.AUCTION_DATABASE_URL
  if (!url) throw new Error('AUCTION_DATABASE_URL is not set (see .env.example)')
  return url
}

export function pool(): pg.Pool {
  if (!g.__auctionPool) {
    // Serverless: every instance has its own pool, and a pooler caps total clients — keep it small on Vercel.
    const defaultMax = process.env.VERCEL ? 3 : 10
    g.__auctionPool = new pg.Pool({
      ...pgConfig(dbUrl()),
      max: Number(process.env.AUCTION_DB_POOL_MAX ?? defaultMax),
      idleTimeoutMillis: 20_000,
    })
  }
  return g.__auctionPool
}

export type Db = pg.PoolClient | pg.Pool

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool()) {
  return (await db.query<T>(text, params)).rows
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = [], db: Db = pool()) {
  return (await db.query<T>(text, params)).rows[0] as T | undefined
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect()
  try {
    await c.query('begin')
    const r = await fn(c)
    await c.query('commit')
    return r
  } catch (e) {
    await c.query('rollback').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}
