// LOCAL TEST ONLY: runs renumber-items.sql against the local database inside a transaction, shows the result, and ROLLS BACK.
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { pgConfig } from '../../src/lib/pgconfig'

async function main() {
  const url = process.env.AUCTION_DATABASE_URL!
  if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('Refusing: not a local database')
  const c = new pg.Client(pgConfig(url))
  await c.connect()
  try {
    await c.query('begin')
    await c.query(readFileSync('scripts/sql/renumber-items.sql', 'utf8'))
    const r = await c.query(`select kind, item_number, title from auction_items order by kind, item_number`)
    const sil = r.rows.filter((x) => x.kind === 'silent').map((x) => x.item_number)
    const live = r.rows.filter((x) => x.kind === 'live').map((x) => x.item_number)
    console.log('silent numbers contiguous from 1:', sil.every((n, i) => n === i + 1), `(${sil.length})`)
    console.log('live numbers:', live.join(','))
  } finally {
    await c.query('rollback')
    await c.end()
    console.log('rolled back — nothing was saved')
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
