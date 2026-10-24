/**
 * LOCAL ONLY. Prepares the local DEMO database for trying the game portal by hand:
 *   npx tsx scripts/game-demo.ts            → turns game mode on, makes sure a live item is queued, prints logins
 * Refuses to run against a database whose event is not marked demo.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { one, query, pool } from '../src/lib/db'
import { createAdminUser } from '../src/lib/auth-core'

async function main() {
  const ev = await one<{ id: string; is_demo: boolean; name: string }>('select id, is_demo, name from events order by created_at desc limit 1')
  if (!ev) throw new Error('No event. Run: npm run db:reset')
  if (!ev.is_demo) throw new Error(`Event "${ev.name}" is not a demo event — refusing to touch it.`)
  await query('update events set game_mode = true, auto_accept_live = true where id = $1', [ev.id])
  await query(`update auction_items set status = 'upcoming' where event_id = $1 and kind = 'live' and status in ('closed','finalized','open','paused','provisional','reopened')`, [ev.id]).catch(() => {})
  const live = await query<{ item_number: number; title: string; status: string }>(`select item_number, title, status from auction_items where event_id = $1 and kind = 'live' order by item_number`, [ev.id])
  const host = await createAdminUser({ email: 'host@demo.local', name: 'Demo Host', password: 'demo-host-pass', role: 'host' }).catch(() => null)
  console.log('Game mode ON for demo event:', ev.name)
  console.log('Live items:', live.map((l) => `#${l.item_number} ${l.title} (${l.status})`).join(' | '))
  console.log(host ? 'Created host login host@demo.local / demo-host-pass' : 'Host login host@demo.local already exists')
}
main().then(() => pool().end()).catch((e) => { console.error(e.message ?? e); process.exit(1) })
