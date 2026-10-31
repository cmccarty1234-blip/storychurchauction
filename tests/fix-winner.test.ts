import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { one, pool, query } from '@/lib/db'
import { recordPaddleBid, setLiveRunState, startLiveItem } from '@/lib/bidding'
import { finalizeNow } from '@/lib/lifecycle'
import { key, makeBidders, makeEvent, makeItem, resetDb } from './helpers'

const sql = readFileSync('scripts/sql/fix-peppertree-109-winner.sql', 'utf8')

let ev: { id: string }
let admin: string
let dawn: { id: string; bidder_number: number }
let allison: { id: string; bidder_number: number }
let item: { id: string }
beforeEach(async () => {
  await resetDb()
  ev = await makeEvent()
  await query('update events set game_mode = true where id = $1', [ev.id])
  admin = (await query<{ id: string }>(`insert into admin_users (email, name, password_hash, role) values ('h@test', 'Host', 'x', 'host') returning id`))[0].id
  const bs = await makeBidders(ev.id, 3)
  await query('update bidders set bidder_number = 1045 where id = $1', [bs[0].id])
  await query('update bidders set bidder_number = 1031 where id = $1', [bs[1].id])
  dawn = { id: bs[0].id, bidder_number: 1045 }
  allison = { id: bs[1].id, bidder_number: 1031 }
  item = await makeItem(ev.id, { kind: 'live', num: 109, title: 'Peppertree: $300 Gift (1 of 2)', start: 20000, inc: 1000 })
  await startLiveItem(item.id, admin)
  await recordPaddleBid({ itemId: item.id, paddleNumber: 1031, amountCents: 30000, adminId: admin, idempotencyKey: key() })
  await recordPaddleBid({ itemId: item.id, paddleNumber: 1045, amountCents: 32000, adminId: admin, idempotencyKey: key() }) // the mistake
})
const top = () => one<{ current_bid_cents: number; current_bidder_id: string; bid_count: number }>('select current_bid_cents, current_bidder_id, bid_count from auction_items where id = $1', [item.id])
const wins = () => query<{ bidder_id: string; amount_cents: number; voided_at: Date | null }>('select bidder_id, amount_cents, voided_at from winning_results where item_id = $1 order by finalized_at, voided_at nulls last', [item.id])

describe('fix the #109 winner', () => {
  it('while the item is still open: Allison becomes the top bid at $320 and the wrong bid stays as a voided row', async () => {
    await pool().query(sql)
    expect(await top()).toEqual({ current_bid_cents: 32000, current_bidder_id: allison.id, bid_count: 2 })
    const bids = await query<{ bidder_id: string; amount_cents: number; voided: boolean }>(
      `select b.bidder_id, b.amount_cents, exists (select 1 from live_bid_voids v where v.accepted_bid_id = b.id) voided from live_accepted_bids b where b.item_id = $1 order by seq`, [item.id])
    expect(bids.map((b) => [b.bidder_id === dawn.id ? 'dawn' : 'allison', b.amount_cents, b.voided])).toEqual([['allison', 30000, false], ['dawn', 32000, true], ['allison', 32000, false]])
    expect((await query(`select 1 from audit_logs where action = 'live.winner_corrected'`)).length).toBe(1)
  })

  it('after the item was finalized: the old result is voided and Allison gets a new result and checkout record', async () => {
    await setLiveRunState(item.id, 'close', admin, true)
    await finalizeNow(item.id, admin) // game mode: close goes to the last-chance window, then finalize
    expect((await wins()).map((w) => [w.bidder_id === dawn.id, w.amount_cents])).toEqual([[true, 32000]])
    await pool().query(sql)
    const rows = await wins()
    const active = rows.filter((r) => !r.voided_at)
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({ bidder_id: allison.id, amount_cents: 32000 })
    expect(rows.find((r) => r.voided_at)!.bidder_id).toBe(dawn.id)
    expect((await query('select 1 from item_collections c join winning_results w on w.id = c.winning_result_id where w.item_id = $1 and w.voided_at is null', [item.id])).length).toBe(1)
  })

  it('refuses a second time (already fixed), and when a higher bid came after', async () => {
    await pool().query(sql)
    await expect(pool().query(sql)).rejects.toThrow(/nothing was changed/)
  })

  it('refuses when a higher bid exists after the $320', async () => {
    await recordPaddleBid({ itemId: item.id, paddleNumber: 1031, amountCents: 33000, adminId: admin, idempotencyKey: key() })
    await expect(pool().query(sql)).rejects.toThrow(/higher bid/)
  })
})
