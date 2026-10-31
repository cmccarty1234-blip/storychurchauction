import { pool, one, query } from '@/lib/db'
import { createAdminUser } from '@/lib/auth-core'

export async function resetDb() {
  await pool().query(`
    truncate chili_hearts, chili_votes, chili_entries, payment_allocations, payments, item_collections, winning_results, live_bid_voids,
             live_accepted_bids, live_bid_requests, silent_bids, auction_items,
             bidder_sessions, bidders, admin_sessions, admin_users, audit_logs, events restart identity cascade`)
}

export async function makeEvent(over: Record<string, unknown> = {}) {
  const close = new Date(Date.now() + 3600_000)
  return (await one<{ id: string }>(
    `insert into events (name, timezone, silent_start_at, silent_close_at, default_increment_cents)
     values ($1, 'America/Denver', now() - interval '1 hour', $2, 500) returning *`,
    ['Test Event', over.close ?? close],
  ))!
}

export async function makeAdmin(role: 'admin' | 'volunteer' = 'admin', email = `${role}@test.local`) {
  return (await createAdminUser({ email, name: `${role} user`, password: 'password123', role }))!
}

let n = 0
export async function makeItem(eventId: string, over: Partial<{ kind: string; status: string; start: number; inc: number; closes_at: Date | null; title: string; num: number }> = {}) {
  n++
  const kind = over.kind ?? 'silent'
  return (await one<{ id: string; item_number: number }>(
    `insert into auction_items (event_id, item_number, kind, title, starting_bid_cents, increment_cents, status, closes_at, live_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$2) returning *`,
    [eventId, over.num ?? 1000 + n, kind, over.title ?? `Item ${n}`, over.start ?? 5000, over.inc ?? 500, over.status ?? (kind === 'live' ? 'upcoming' : 'open'), over.closes_at ?? null],
  ))!
}

export async function makeBidders(eventId: string, count: number) {
  const rows: { id: string; bidder_number: number }[] = []
  for (let i = 0; i < count; i++) {
    const r = await one<{ id: string; bidder_number: number }>(
      `with nn as (update events set next_bidder_number = next_bidder_number + 1 where id = $1 returning next_bidder_number - 1 as num)
       insert into bidders (event_id, bidder_number, name, phone, assisted)
       select $1, num, $2, '+1719' || lpad(num::text, 7, '0'), false from nn returning id, bidder_number`,
      [eventId, `Test Bidder ${i + 1}`],
    )
    rows.push(r!)
  }
  return rows
}

export const key = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

export async function itemRow(id: string) {
  return (await one<any>('select * from auction_items where id = $1', [id]))!
}

export async function expectError(p: Promise<unknown>, code: string) {
  try {
    await p
  } catch (e: any) {
    if (e.code !== code) throw new Error(`expected error ${code}, got ${e.code ?? e.message}`)
    return e
  }
  throw new Error(`expected error ${code}, but call succeeded`)
}

export { query }
