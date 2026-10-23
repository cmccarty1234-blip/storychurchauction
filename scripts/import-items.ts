/**
 * Imports auction items from a reviewed CSV as HIDDEN DRAFTS (nothing becomes visible to guests until staff publish it).
 *   npm run import:items                       → dry run: shows the plan and which database it would write to
 *   npm run import:items -- --apply            → writes the items
 *   npm run import:items -- --file path.csv    → use another file (default data/auction-import.csv)
 * Columns used: title, kind (silent|live), start_usd, increment_usd, donor_name, description. Others are ignored.
 * Safe to re-run: an item whose title already exists (same type) is skipped. Refuses to touch the DEMO event.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { one, pool, query, tx, dbUrl } from '../src/lib/db'
import { audit } from '../src/lib/audit'

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let cur: string[] = [], field = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (c === '"') { q = false } else { field += c }
    } else if (c === '"') q = true
    else if (c === ',') { cur.push(field); field = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(field); field = ''; if (cur.some((x) => x !== '')) rows.push(cur); cur = [] }
    else field += c
  }
  if (field !== '' || cur.length) { cur.push(field); if (cur.some((x) => x !== '')) rows.push(cur) }
  const head = rows.shift()!.map((h) => h.replace(/^﻿/, '').trim())
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

async function main() {
  const apply = process.argv.includes('--apply')
  const fi = process.argv.indexOf('--file')
  const file = fi >= 0 ? process.argv[fi + 1] : 'data/auction-import.csv'
  const rows = parseCsv(readFileSync(file, 'utf8'))

  const problems: string[] = []
  const clean = rows.map((r, i) => {
    const start = Math.round(parseFloat(r.start_usd) * 100)
    const inc = Math.round(parseFloat(r.increment_usd) * 100)
    if (!r.title) problems.push(`row ${i + 2}: missing title`)
    if (r.kind !== 'silent' && r.kind !== 'live') problems.push(`row ${i + 2} (${r.title}): kind must be silent or live`)
    if (!(start >= 100)) problems.push(`row ${i + 2} (${r.title}): start_usd must be at least 1`)
    if (!(inc >= 100)) problems.push(`row ${i + 2} (${r.title}): increment_usd must be at least 1`)
    return { title: r.title, kind: r.kind as 'silent' | 'live', start, inc, donor: r.donor_name || null, description: r.description || '' }
  })
  if (problems.length) throw new Error('Fix these rows first:\n  ' + problems.join('\n  '))

  const parsed = new URL(dbUrl())
  const host = parsed.hostname
  const dbUser = decodeURIComponent(parsed.username) // on the Supabase pooler this is postgres.<project-id>
  console.log(`Database host : ${host}\nDatabase user : ${dbUser}   (on Supabase, the part after the dot is the project ID)`)
  const ev = await one<{ id: string; name: string; is_demo: boolean }>('select id, name, is_demo from events order by created_at desc limit 1')
  if (!ev) throw new Error('No event exists yet. Run `npm run setup` first.')
  if (ev.is_demo) throw new Error(`The event on ${host} is the DEMO event. Refusing to import real items into it.`)
  console.log(`Event         : ${ev.name}\nFile          : ${file} (${clean.length} rows)\nMode          : ${apply ? 'APPLY (writing)' : 'dry run (nothing is written)'}\n`)

  const existing = new Set((await query<{ t: string }>(`select kind || ':' || lower(title) as t from auction_items where event_id = $1`, [ev.id])).map((r) => r.t))
  const todo = clean.filter((r) => !existing.has(`${r.kind}:${r.title.toLowerCase()}`))
  const skipped = clean.length - todo.length
  const by = (k: string) => todo.filter((r) => r.kind === k).length
  console.log(`To import: ${todo.length} (${by('silent')} silent, ${by('live')} live) · already present, skipped: ${skipped}`)
  if (!apply) {
    for (const r of todo) console.log(`  ${r.kind.padEnd(6)} start $${(r.start / 100).toFixed(0).padStart(4)} +$${(r.inc / 100).toFixed(0).padStart(3)}  ${r.title}${r.donor ? `  — ${r.donor}` : ''}`)
    console.log('\nDry run only. Re-run with --apply to write these as hidden drafts.')
    return
  }

  await tx(async (c) => {
    let silentNo = (await one<{ n: number }>(`select coalesce(max(item_number), 0) n from auction_items where event_id = $1 and kind = 'silent'`, [ev.id], c))!.n
    let liveNo = (await one<{ n: number }>(`select coalesce(max(item_number), 100) n from auction_items where event_id = $1 and kind = 'live'`, [ev.id], c))!.n
    for (const r of todo) {
      const no = r.kind === 'live' ? ++liveNo : ++silentNo
      const row = await one<{ id: string }>(
        `insert into auction_items (event_id, item_number, kind, title, description, donor_name, starting_bid_cents, increment_cents, status, live_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9) returning id`,
        [ev.id, no, r.kind, r.title, r.description, r.donor, r.start, r.inc, r.kind === 'live' ? no : null],
        c,
      )
      await audit({ eventId: ev.id, actorType: 'system', action: 'item.imported', entityType: 'auction_item', entityId: row!.id, details: { itemNumber: no, title: r.title } }, c)
    }
  })
  console.log(`\nImported ${todo.length} hidden draft items. Review them in Staff → Items, add photos, then show them to guests.`)
}

main()
  .then(() => pool().end())
  .catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
