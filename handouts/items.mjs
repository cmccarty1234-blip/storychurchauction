// Builds a table-top catalog of the SILENT auction items (photo, number, name, details, QR) as HTML + print-ready PDF.
//   node handouts/items.mjs
// Reads data/auction-import.csv (item numbers = order of the silent rows, exactly as imported) and data/images/<n>.*
// Items whose price is still a placeholder (needs_price = YES) print a blank "Starting bid" line to fill in by hand.
// To print from live data later, update the CSV (or ask for a database-driven version).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import QRCode from 'qrcode'
import sharp from 'sharp'

const SITE = process.env.HANDOUT_SITE ?? 'https://auction.storychurch.co'
const CLOSE_TIME = '8:30 PM'
const out = path.resolve('handouts/out')
mkdirSync(out, { recursive: true })

// ── tiny CSV parser (quoted fields, commas, newlines) ──
function parseCsv(text) {
  const rows = []
  let row = [], cur = '', q = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') { q = false } else { cur += c }
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = [] }
    else cur += c
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row) }
  const head = rows.shift()
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

const MODE = process.argv[2] === 'live' ? 'live' : 'silent'
const ITEMS_FILE = process.env.ITEMS_FILE ?? 'data/production-items.csv' // the live-site export (or its renumbered version)
const PROD = existsSync(ITEMS_FILE)
const all = parseCsv(readFileSync(PROD ? ITEMS_FILE : 'data/auction-import.csv', 'utf8'))
// Numbers come from the item_no column (the item numbers on the live site), so moving an item never renumbers the others.
// From the live-site export, hidden drafts are left off the SILENT table catalog (live items are all listed).
const silent = all.filter((r) => r.kind === MODE && !(PROD && MODE === 'silent' && r.status === 'draft')).map((r, i) => ({ ...r, n: r.item_no ? parseInt(r.item_no, 10) : (MODE === 'live' ? 102 : 1) + i })).sort((x, y) => x.n - y.n)

const imgDir = 'data/images'
const photoFiles = new Map(readdirSync(imgDir).filter((f) => /^\d+\.(jpe?g|png|webp)$/i.test(f)).map((f) => [parseInt(f, 10), f]))
const normT = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '')
const credits = existsSync(path.join(imgDir, 'credits.csv')) ? parseCsv(readFileSync(path.join(imgDir, 'credits.csv'), 'utf8')) : []
const creditNo = new Map(credits.map((c) => [normT(c.title), parseInt(c.item_number, 10)]))
const photoFor = (it) => {
  if (!PROD) return photoFiles.get(it.n)
  const k = normT(it.title)
  let no = creditNo.get(k)
  if (no == null && k.length >= 8) for (const [ck, cn] of creditNo) if (ck.length >= 8 && (k.startsWith(ck) || ck.startsWith(k))) { no = cn; break }
  return no != null ? photoFiles.get(no) : undefined
}
const photo = async (it) => {
  const f = photoFor(it)
  if (!f) return null
  const buf = await sharp(path.join(imgDir, f)).rotate().resize({ width: 700, height: 460, fit: 'cover' }).jpeg({ quality: 78 }).toBuffer()
  return 'data:image/jpeg;base64,' + buf.toString('base64')
}
const logo = 'data:image/png;base64,' + readFileSync('public/brand/storychurch-banner.png').toString('base64')
const qr = (url) => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#101010', light: '#ffffff' } })
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const usd = (v) => (v === '' || v == null ? null : '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }))

const css = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&display=swap');
@page { size: Letter; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { background: #fff; color: #101010; font-family: Inter, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 8.5in; height: 11in; padding: 0.38in 0.4in 0.3in; display: flex; flex-direction: column; gap: 0.1in; position: relative; overflow: hidden; page-break-after: always; break-after: page }
.page:last-child { page-break-after: auto; break-after: auto }
.bar { position: absolute; left: 0; right: 0; top: 0; height: 0.1in; background: #f5c518 }
header { display: flex; align-items: center; justify-content: space-between; padding-top: 0.04in }
header img { height: 0.34in; filter: brightness(0) }
header .t { font-weight: 800; font-size: 10pt; letter-spacing: .08em; text-transform: uppercase; color: #686868 }
.grid { flex: 1; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); gap: 0.12in; min-height: 0 }
.card { border: 2px solid #101010; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; background: #fff; min-height: 0 }
.ph { position: relative; height: 1.4in; background: #101010; flex: none; display: grid; place-items: center }
.ph img.p { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover }
.ph .noimg img { height: 0.42in; opacity: .9 }
.num { position: absolute; left: 0; top: 0; background: #f5c518; color: #101010; font-family: 'Archivo Black', Impact, sans-serif; font-size: 17pt; line-height: 1; padding: 6px 12px 5px; border-bottom-right-radius: 12px }
.body { padding: 0.09in 0.13in 0.08in; display: flex; flex-direction: column; gap: 3px; flex: 1; min-height: 0 }
h2 { font-family: 'Archivo Black', Impact, sans-serif; font-weight: 400; font-size: 14.5pt; line-height: 1.04; text-transform: uppercase }
.desc { flex: none; font-size: 8.8pt; line-height: 1.28; color: #292929; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }
.donor { font-size: 8pt; color: #686868; font-weight: 600 }
.meta { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px }
.price b { font-size: 11pt; font-weight: 800 } .price span { display: block; font-size: 8.3pt; color: #444; line-height: 1.3 }
.blank { display: inline-block; width: 0.7in; border-bottom: 1.5px solid #101010; height: 12px; vertical-align: bottom }
.qr { width: 0.56in; height: 0.56in; flex: none } .qr svg { width: 100%; height: 100% }
footer { display: flex; justify-content: space-between; font-size: 8.5pt; color: #555; font-weight: 600 }
`

const card = async (it) => {
  const p = await photo(it)
  const start = usd(it.start_usd)
  const val = usd(it.value_usd)
  const needs = !PROD && it.needs_price === 'YES'
  return `<div class="card">
  <div class="ph">${p ? `<img class="p" src="${p}" alt="">` : `<div class="noimg"><img src="${logo}" alt=""></div>`}<div class="num">#${it.n}</div></div>
  <div class="body">
    <h2>${esc(it.title)}</h2>
    ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ''}
    ${it.donor_name ? `<p class="donor">Donated by ${esc(it.donor_name)}</p>` : ''}
    <div class="meta">
      <div class="price">
        <b>${needs ? 'Starting bid $<i class="blank"></i>' : `Starting bid ${start}`}</b>
        <span>${needs ? '' : `Raise by ${usd(it.increment_usd)}`}${val && !needs ? ` · Value ${val}` : ''}</span>
      </div>
      <div class="qr">${await qr(`${SITE}/i/${it.n}`)}</div>
    </div>
  </div>
</div>`
}

const PER = 6
const pages = []
for (let i = 0; i < silent.length; i += PER) {
  const chunk = silent.slice(i, i + PER)
  const cards = await Promise.all(chunk.map(card))
  const first = chunk[0].n, last = chunk.at(-1).n
  pages.push(`<div class="page"><div class="bar"></div>
<header><img src="${logo}" alt="Story Church"><span class="t">${MODE === 'live' ? 'Live auction' : 'Silent auction'} · items ${first}–${last}</span></header>
<div class="grid">${cards.join('')}</div>
<footer><span>${MODE === 'live' ? `Live items are called from the stage — raise your paddle or tap Live on your phone (${SITE.replace(/^https?:\/\//, '')})` : `Scan a code or visit ${SITE.replace(/^https?:\/\//, '')} to bid · Silent auction closes ${CLOSE_TIME}`}</span><span>Your story matters.</span></footer></div>`)
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${MODE === 'live' ? 'Live' : 'Silent'} auction items</title><style>${css}</style></head><body>${pages.join('\n')}</body></html>`
const base = (MODE === 'live' ? 'Live-Auction-Items' : 'Silent-Auction-Items') + (process.env.OUT_SUFFIX ?? '')
const f = path.join(out, `${base}.html`)
writeFileSync(f, html)
const pdf = path.join(out, `${base}.pdf`)
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { readFileSync(p, { flag: 'r' }); return true } catch { return false } })
const r = spawnSync(edge ?? 'msedge', ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=20000', `--print-to-pdf=${pdf}`, 'file:///' + f.replace(/\\/g, '/')], { stdio: 'ignore' })
console.log(`${silent.length} ${MODE} items, ${pages.length} pages, ${silent.filter((i) => photoFor(i)).length} with photos → ${r.status === 0 ? pdf : 'PDF FAILED'}`)
