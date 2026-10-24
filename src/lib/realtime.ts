import pg from 'pg'
import { dbUrl } from './db'
import { pgConfig } from './pgconfig'

/**
 * Realtime transport: Postgres LISTEN/NOTIFY → Server-Sent Events.
 * Writers call `notify(client, ...)` INSIDE their transaction, so the event is delivered
 * only if (and when) the bid/request commits. One shared LISTEN connection per server process
 * fans out to every open /api/stream connection.
 *
 * LISTEN needs a SESSION connection (direct, or the pooler's session mode on port 5432), whereas ordinary queries are
 * best sent through the pooler's TRANSACTION mode (port 6543), which shares connections far better under load. Set
 * AUCTION_DATABASE_URL to the transaction pooler and AUCTION_LISTEN_DATABASE_URL to the session pooler; if the
 * latter is unset the main URL is used for both (fine locally).
 */
export type RealtimeMsg = { t: 'item' | 'live' | 'bidder' | 'game'; id?: string }

export async function notify(db: pg.PoolClient | pg.Pool, msg: RealtimeMsg) {
  await db.query('select pg_notify($1, $2)', ['auction', JSON.stringify(msg)])
}

type Listener = (m: RealtimeMsg) => void
type Hub = { listeners: Set<Listener>; client?: pg.Client; connecting?: boolean }
type G = typeof globalThis & { __rt?: Hub }
const g = globalThis as G
const hub: Hub = (g.__rt ??= { listeners: new Set<Listener>() })

async function connect() {
  if (hub.client || hub.connecting) return
  hub.connecting = true
  try {
    const client = new pg.Client(pgConfig(process.env.AUCTION_LISTEN_DATABASE_URL || dbUrl()))
    client.on('error', () => reset())
    client.on('end', () => reset())
    client.on('notification', (n) => {
      try {
        const m = JSON.parse(n.payload ?? '{}') as RealtimeMsg
        hub.listeners.forEach((l) => l(m))
      } catch {}
    })
    await client.connect()
    await client.query('listen auction')
    hub.client = client
  } catch {
    setTimeout(connect, 2000)
  } finally {
    hub.connecting = false
  }
}

function reset() {
  hub.client = undefined
  if (hub.listeners.size > 0) setTimeout(connect, 1000)
}

export function subscribe(l: Listener): () => void {
  hub.listeners.add(l)
  void connect()
  return () => hub.listeners.delete(l)
}
