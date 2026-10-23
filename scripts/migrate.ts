import { config } from 'dotenv'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'

config({ path: '.env.local' })

export async function migrate(url: string, opts: { quiet?: boolean } = {}) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
    const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name))
    const dir = path.resolve(process.cwd(), 'db/migrations')
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue
      await client.query('begin')
      try {
        await client.query(readFileSync(path.join(dir, f), 'utf8'))
        await client.query('insert into schema_migrations(name) values ($1)', [f])
        await client.query('commit')
        if (!opts.quiet) console.log('applied', f)
      } catch (e) {
        await client.query('rollback')
        throw e
      }
    }
  } finally {
    await client.end()
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  const url = process.argv[2] ?? process.env.AUCTION_DATABASE_URL
  if (!url) throw new Error('AUCTION_DATABASE_URL not set')
  migrate(url).then(() => console.log('migrations up to date'), (e) => { console.error(e); process.exit(1) })
}
