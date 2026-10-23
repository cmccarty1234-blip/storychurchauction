/**
 * First-time setup for a REAL (non-demo) database: creates the event (if none) and an administrator.
 *   npm run setup -- --event "StoryChurch Fundraiser 2026" --date 2026-11-14 --close "2026-11-14T20:00" \
 *                    --admin-email you@church.org --admin-name "Your Name" --admin-password "a-long-password"
 * `--close` is the silent auction closing time in the event time zone (default America/Denver). Run against the
 * database named by AUCTION_DATABASE_URL. Never creates demo data.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { one, pool, dbUrl } from '../src/lib/db'
import { createAdminUser } from '../src/lib/auth-core'
import { localInputToUtc } from '../src/lib/time'

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const email = arg('admin-email')
  const name = arg('admin-name')
  const password = arg('admin-password')
  if (!email || !name || !password) throw new Error('Required: --admin-email, --admin-name, --admin-password (and --event on first run)')

  const u = new URL(dbUrl())
  console.log(`Database host : ${u.hostname}\nDatabase user : ${decodeURIComponent(u.username)}   (on Supabase, the part after the dot is the project ID)`)
  const existing = await one<{ id: string; is_demo: boolean }>('select id, is_demo from events order by created_at desc limit 1')
  if (existing?.is_demo) throw new Error('This database holds the DEMO event. Use a fresh database for a real event.')
  if (!existing) {
    const eventName = arg('event')
    if (!eventName) throw new Error('No event exists yet: pass --event "Name"')
    const tz = arg('tz') ?? 'America/Denver'
    const close = arg('close') ? localInputToUtc(arg('close')!, tz) : null
    await pool().query(
      `insert into events (name, event_date, timezone, silent_start_at, silent_close_at, is_demo) values ($1,$2,$3, now(), $4, false)`,
      [eventName, arg('date') ?? null, tz, close],
    )
    console.log(`Created event "${eventName}" (${tz}).`)
  }
  try {
    const admin = await createAdminUser({ email, name, password, role: 'admin' })
    console.log(`Created administrator ${admin!.email}.`)
  } catch (e) {
    if ((e as { code?: string }).code === 'DUPLICATE') console.log(`An administrator with ${email} already exists — kept as is (password unchanged).`)
    else throw e
  }
}

main()
  .then(() => pool().end())
  .catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
