import { z } from 'zod'
import { body, route, uuid } from '@/lib/api'
import { one, query, tx } from '@/lib/db'
import { getEvent } from '@/lib/events'
import { announce } from '@/lib/announce'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/realtime'
import { emergencyRelease, emergencyStop, extendTimer, finalizeNow } from '@/lib/lifecycle'
import { drawJackpot, endRoomEvent, startRoomEvent } from '@/lib/rooms'
import { requireAdmin } from '@/lib/session'
import { pieLine, pieSummary, throwPie } from '@/lib/pies'
import { wheelbarrow } from '@/lib/wheelbarrow'
import { commercialByKey } from '@/lib/commercials'
import { setChiliState } from '@/lib/chili'
import { AppError } from '@/lib/errors'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('extend'), itemId: uuid, seconds: z.number().int() }),
  z.object({ action: z.literal('finalize-now'), itemId: uuid }),
  z.object({ action: z.literal('emergency-stop'), reason: z.string().max(200) }),
  z.object({ action: z.literal('emergency-release') }),
  z.object({ action: z.literal('announce'), headline: z.string().min(1).max(140), body: z.string().max(300).optional() }),
  z.object({ action: z.literal('display'), mode: z.enum(['auto', 'dashboard', 'live', 'message', 'welcome', 'thanks', 'pie', 'chili', 'powerups', 'howtobid']), message: z.string().max(200).optional() }),
  z.object({ action: z.literal('room-start'), code: z.enum(['lightning', 'jackpot', 'battle']), itemIds: z.array(uuid).optional(), prize: z.string().max(120).optional(), reward: z.string().max(120).optional(), seconds: z.number().int().optional() }),
  z.object({ action: z.literal('room-end'), sessionId: uuid }),
  z.object({ action: z.literal('pie-throw'), bidderNumber: z.number().int(), code: z.enum(['pie_small', 'pie_large']) }),
  z.object({ action: z.literal('jackpot-draw'), sessionId: uuid, reason: z.string().max(200).optional() }),
  z.object({ action: z.literal('commercial-play'), key: z.string().max(60), itemId: uuid.optional() }),
  z.object({ action: z.literal('commercial-stop') }),
  z.object({ action: z.literal('powerup-test'), code: z.enum(['resurrection', 'final_call', 'knockout', 'block', 'back_in']) }),
  z.object({ action: z.literal('chili-state'), state: z.enum(['off', 'open', 'closed']) }),
])

/** Host console actions. Hosts and administrators only — volunteers can't reach these. */
export const POST = route(async (req) => {
  const admin = await requireAdmin('host') // authenticate before reading the body
  const b = await body(req, Body)
  const ev = await getEvent()
  switch (b.action) {
    case 'extend':
      await extendTimer(b.itemId, b.seconds, admin.id)
      return { ok: true }
    case 'finalize-now':
      return await finalizeNow(b.itemId, admin.id)
    case 'emergency-stop':
      await emergencyStop(ev.id, admin.id, b.reason)
      return { ok: true }
    case 'emergency-release':
      await emergencyRelease(ev.id, admin.id)
      return { ok: true }
    case 'announce':
      await tx(async (c) => {
        await announce(c, { eventId: ev.id, kind: 'host.message', headline: b.headline, body: b.body, interrupt: true })
        await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'host.announce', details: { headline: b.headline } }, c)
      })
      return { ok: true }
    case 'display':
      await tx(async (c) => {
        await c.query('update events set display_mode = $2, display_message = $3 where id = $1', [ev.id, b.mode, b.mode === 'message' ? b.message ?? '' : null])
        await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'host.display_mode', details: { mode: b.mode } }, c)
        await notify(c, { t: 'game' })
      })
      return { ok: true }
    case 'room-start':
      return await startRoomEvent(ev.id, b.code, admin.id, { itemIds: b.itemIds, prize: b.prize, reward: b.reward, seconds: b.seconds })
    case 'pie-throw':
      return await throwPie({ eventId: ev.id, bidderNumber: b.bidderNumber, code: b.code, adminId: admin.id })
    case 'room-end':
      await endRoomEvent(b.sessionId, admin.id)
      return { ok: true }
    case 'jackpot-draw':
      return await drawJackpot(b.sessionId, admin.id, b.reason)
    case 'commercial-play': {
      const clip = commercialByKey(b.key)
      if (!clip) throw new AppError('NOT_FOUND', 'That commercial isn’t in the list.', 404)
      // The host's pick wins; otherwise the clip's own linked item, found by title.
      const linked = b.itemId ?? (clip.promote ? (await one<{ id: string }>(`select id from auction_items where event_id = $1 and title ilike $2 and status <> 'cancelled' order by item_number limit 1`, [ev.id, `%${clip.promote}%`]))?.id ?? null : null)
      await tx(async (c) => {
        await c.query('update events set commercial_key = $2, commercial_item_id = $3, commercial_started_at = now() where id = $1', [ev.id, clip.key, linked])
        await audit({ eventId: ev.id, actorType: 'admin', actorId: admin.id, action: 'host.commercial', details: { key: clip.key, itemId: linked } }, c)
        await notify(c, { t: 'game' })
      })
      return { ok: true }
    }
    case 'powerup-test': {
      // Shows a Power-Up's screen effect on the projector with nothing behind it: no item, no bidder, no inventory used.
      const headline = {
        resurrection: 'RESURRECTION! THIS AUCTION IS BACK!',
        final_call: 'FINAL CALL! +30 SECONDS!',
        knockout: 'KNOCKOUT! BIDDING CLOSED!',
        block: 'BLOCKED! Bidder #1042 is locked out for 30 seconds',
        back_in: 'BACK IN! Bidder #1042 is back in the game',
      }[b.code]
      await tx(async (c) => {
        await announce(c, { eventId: ev.id, kind: `powerup.${b.code}`, headline, body: 'TEST — not a real Power-Up', payload: { code: b.code, test: true }, interrupt: true })
      })
      return { ok: true }
    }
    case 'chili-state':
      await setChiliState(ev.id, b.state, admin.id)
      return { ok: true }
    case 'commercial-stop':
      await tx(async (c) => {
        await c.query('update events set commercial_started_at = null where id = $1', [ev.id])
        await notify(c, { t: 'game' })
      })
      return { ok: true }
  }
})

/** The host console's own data: the queue, recent bids and who is waiting — beyond the public snapshot. */
export const GET = route(async () => {
  await requireAdmin('host')
  const ev = await getEvent()
  const queue = await query(`select id, item_number, title, starting_bid_cents, min_qualifying_bid_cents from auction_items where event_id = $1 and kind = 'live' and status = 'upcoming' order by coalesce(live_order, 9999), item_number`, [ev.id])
  const silent = await query(`select id, item_number, title from auction_items where event_id = $1 and kind = 'silent' and status = 'open' order by item_number`, [ev.id])
  const pending = await query(
    `select r.id, r.amount_cents, b.bidder_number, b.name from live_bid_requests r join bidders b on b.id = r.bidder_id join auction_items i on i.id = r.item_id
      where i.event_id = $1 and r.status = 'pending' order by r.amount_cents desc limit 10`,
    [ev.id],
  )
  const recentActs = await query(
    `select d.name, b.bidder_number, i.item_number, a.created_at from powerup_activations a join powerup_defs d on d.code = a.powerup_code
       join bidders b on b.id = a.bidder_id join auction_items i on i.id = a.item_id where a.event_id = $1 order by a.created_at desc limit 8`,
    [ev.id],
  )
  const rooms = await query('select code, name, enabled, config from room_event_defs order by code')
  const pies = { ...(await pieSummary(ev.id)), line: (await pieLine(ev.id)).slice(0, 12).map((p) => ({ bidderNumber: p.bidderNumber, name: p.name, size: p.size, code: p.code })) }
  return Response.json({ queue, silent, pending, recentActs, rooms, pies, wheelbarrow: await wheelbarrow(ev.id) }, { headers: { 'Cache-Control': 'no-store' } })
})
