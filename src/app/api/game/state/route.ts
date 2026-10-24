import { route } from '@/lib/api'
import { getEvent } from '@/lib/events'
import { gameState, gameTick, type GameState } from '@/lib/game-state'

export const dynamic = 'force-dynamic'

/**
 * Public, read-only snapshot for the projector, host console and customer portal (bidder numbers only).
 * Every poll also performs any transition that has come due, so timers fire on time while any screen is open.
 *
 * 100+ phones poll this, so one server instance computes it at most about once a second and shares the result.
 * `serverNow` is advanced by the time the snapshot has sat in the cache, so countdowns stay exact.
 */
const TTL_MS = 900
type Cached = { builtAt: number; p: Promise<GameState> }
const g = globalThis as typeof globalThis & { __gameStateCache?: Cached }

async function build(): Promise<GameState> {
  const ev = await getEvent()
  await gameTick(ev.id)
  return gameState(ev.id)
}

export const GET = route(async () => {
  let c = g.__gameStateCache
  if (!c || Date.now() - c.builtAt > TTL_MS) {
    const fresh: Cached = { builtAt: Date.now(), p: build() }
    fresh.p.catch(() => {
      if (g.__gameStateCache === fresh) g.__gameStateCache = undefined // never cache a failure
    })
    g.__gameStateCache = fresh
    c = fresh
  }
  const s = await c.p
  const aged = new Date(new Date(s.serverNow).getTime() + (Date.now() - c.builtAt)).toISOString()
  return Response.json({ ...s, serverNow: aged }, { headers: { 'Cache-Control': 'no-store' } })
})
