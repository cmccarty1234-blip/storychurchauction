import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { one, pool, query } from '@/lib/db'
import { startItemWithCommercial } from '@/lib/commercial-start'
import { recordPaddleBid, startLiveItem } from '@/lib/bidding'
import { key, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

const sql = readFileSync('scripts/sql/reset-live-item-105.sql', 'utf8')

let ev: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  await query('update events set game_mode = true where id = $1', [ev.id])
})
const admin = async () => (await query<{ id: string }>(`insert into admin_users (email, name, password_hash, role) values ('h@test', 'Host', 'x', 'host') returning id`))[0]
const state = async (id: string) => one<{ status: string; timed: boolean; deadline_at: Date | null; started_at: Date | null; timer_phase: string | null }>('select status, timed, deadline_at, started_at, timer_phase from auction_items where id = $1', [id])

describe('reset live item #105 SQL', () => {
  it('puts a started item back in the queue and cancels its pending commercial', async () => {
    const a = await admin()
    const it = await makeItem(ev.id, { kind: 'live', num: 105, title: 'Royal Gorge Train: 2 Experience Tickets', start: 15000, inc: 2500 })
    await startItemWithCommercial(it.id, a.id) // house/clip spot first: the item waits as upcoming
    await startLiveItem(it.id, a.id).catch(() => {}) // (host then skipped ahead) - may or may not apply while the spot is pending
    await query(`update events set commercial_started_at = now() where id = $1`, [ev.id])
    const started = await state(it.id)
    expect(started!.status === 'open' || started!.status === 'upcoming').toBe(true)

    await pool().query(sql)

    expect(await state(it.id)).toMatchObject({ status: 'upcoming', timed: false, deadline_at: null, started_at: null, timer_phase: null })
    const e = await one<{ commercial_started_at: Date | null; commercial_start_item_id: string | null }>('select commercial_started_at, commercial_start_item_id from events where id = $1', [ev.id])
    expect(e!.commercial_start_item_id).toBeNull()
    expect(e!.commercial_started_at).toBeNull()
    expect((await query(`select 1 from audit_logs where action = 'live.reset'`)).length).toBe(1)
  })

  it('can then be started again normally', async () => {
    const a = await admin()
    const it = await makeItem(ev.id, { kind: 'live', num: 105, title: 'Royal Gorge Train: 2 Experience Tickets', start: 15000, inc: 2500 })
    await startLiveItem(it.id, a.id)
    expect((await state(it.id))!.status).toBe('open')
    await pool().query(sql)
    expect((await state(it.id))!.status).toBe('upcoming')
    await startLiveItem(it.id, a.id)
    expect((await state(it.id))!.status).toBe('open')
  })

  it('refuses when someone has already bid, and changes nothing', async () => {
    const a = await admin()
    const [g] = await makeBidders(ev.id, 1)
    const it = await makeItem(ev.id, { kind: 'live', num: 105, title: 'Royal Gorge Train: 2 Experience Tickets', start: 15000, inc: 2500 })
    await startLiveItem(it.id, a.id)
    await recordPaddleBid({ itemId: it.id, paddleNumber: g.bidder_number, amountCents: 15000, adminId: a.id, idempotencyKey: key() })
    const before = await state(it.id)
    expect((await query('select 1 from live_accepted_bids where item_id = $1', [it.id])).length).toBe(1)
    await expect(pool().query(sql)).rejects.toThrow(/nothing was changed/)
    expect(await state(it.id)).toEqual(before)
  })

  it('does nothing when there is no item #105 titled Royal Gorge Train', async () => {
    await makeItem(ev.id, { kind: 'live', num: 105, title: 'Something else' })
    await expect(pool().query(sql)).rejects.toThrow(/nothing was changed/)
  })
})
