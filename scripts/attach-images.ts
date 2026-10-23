/**
 * Attaches photos to items. Put files in a folder named by ITEM NUMBER (1.jpg, 2.png, 101.jpg …) and run:
 *   npm run attach:images                 → dry run: shows which photo goes to which item (writes nothing)
 *   npm run attach:images -- --apply      → shrinks each photo (max 1600 px JPEG), uploads it to photo storage, attaches it
 *   --dir <folder>   (default data/images)      --replace   also replace photos items already have
 * Needs the same AUCTION_DATABASE_URL as the import, plus SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your shell
 * (or none of them when pointed at a local database). Safe to re-run: items that already have a photo are skipped.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { one, pool, dbUrl } from '../src/lib/db'
import { saveImage, storageBackend } from '../src/lib/storage'
import { audit } from '../src/lib/audit'

async function main() {
  const apply = process.argv.includes('--apply')
  const replace = process.argv.includes('--replace')
  const di = process.argv.indexOf('--dir')
  const dir = di >= 0 ? process.argv[di + 1] : 'data/images'

  const parsed = new URL(dbUrl())
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)
  console.log(`Database host : ${parsed.hostname}\nDatabase user : ${decodeURIComponent(parsed.username)}   (on Supabase, the part after the dot is the project ID)`)
  console.log(`Photo storage : ${storageBackend() === 'supabase' ? 'Supabase Storage' : 'local folder (development only)'}`)
  if (!local && storageBackend() !== 'supabase') {
    throw new Error('This database is hosted but SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in this window, so photos would not be stored anywhere real. Set both and re-run.')
  }

  const ev = await one<{ id: string; name: string; is_demo: boolean }>('select id, name, is_demo from events order by created_at desc limit 1')
  if (!ev) throw new Error('No event exists yet.')
  console.log(`Event         : ${ev.name}${ev.is_demo ? '  (DEMO)' : ''}\nFolder        : ${dir}\nMode          : ${apply ? 'APPLY (writing)' : 'dry run (nothing is written)'}\n`)

  const files = readdirSync(dir)
    .map((f) => ({ f, m: /^(\d+)\.(jpe?g|png|webp)$/i.exec(f) }))
    .filter((x) => x.m)
    .map((x) => ({ file: x.f, n: parseInt(x.m![1], 10) }))
    .sort((a, b) => a.n - b.n)
  if (!files.length) throw new Error(`No photos named like 12.jpg found in ${dir}.`)

  let attached = 0, skipped = 0, missing = 0
  for (const { file, n } of files) {
    const item = await one<{ id: string; title: string; image_path: string | null }>('select id, title, image_path from auction_items where event_id = $1 and item_number = $2', [ev.id, n])
    if (!item) { console.log(`  #${String(n).padStart(3)} ${file}: no item with that number — skipped`); missing++; continue }
    if (item.image_path && !replace) { console.log(`  #${String(n).padStart(3)} ${item.title}: already has a photo — skipped`); skipped++; continue }
    if (!apply) { console.log(`  #${String(n).padStart(3)} ${file} → ${item.title}`); attached++; continue }

    const out = await sharp(readFileSync(path.join(dir, file))).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()
    const name = await saveImage(out)
    await one('update auction_items set image_path = $2, updated_at = now() where id = $1', [item.id, name])
    await audit({ eventId: ev.id, actorType: 'system', action: 'item.image_attached', entityType: 'auction_item', entityId: item.id, details: { itemNumber: n, kb: Math.round(out.length / 1024) } })
    console.log(`  #${String(n).padStart(3)} ${item.title}: attached (${Math.round(out.length / 1024)} KB)`)
    attached++
  }
  console.log(`\n${apply ? 'Attached' : 'Would attach'} ${attached} · already had a photo ${skipped} · no matching item ${missing}`)
  if (!apply) console.log('Dry run only. Re-run with --apply to upload and attach.')
}

main()
  .then(() => pool().end())
  .catch((e) => {
    console.error(e.message ?? e)
    process.exit(1)
  })
