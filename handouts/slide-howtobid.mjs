// One 16:9 slide that explains how to bid, for the host to talk through up front.
//   node handouts/slide-howtobid.mjs          (run from the project folder; needs Microsoft Edge)
// Writes handouts/out/Slide-How-To-Bid.html, .pdf and .png.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import QRCode from 'qrcode'

const SITE = process.env.HANDOUT_SITE ?? 'https://auction.storychurch.co'
const out = path.resolve('handouts/out')
mkdirSync(out, { recursive: true })
const logo = 'data:image/png;base64,' + readFileSync('public/brand/storychurch-banner.png').toString('base64')
const qr = await QRCode.toString(SITE + '/register', { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#101010', light: '#ffffff' } })

const CARDS = [
  { icon: '📱', name: 'Silent auction', price: '8:30', color: '#f5c518', tag: 'BID FROM YOUR PHONE',
    lines: ['<b>Scan the QR</b> on the item card, or open the site and tap <b>Auction</b>.', 'Check the <b>current bid</b> and the <b>minimum</b>, then tap <b>Place bid</b>. <b>Wait for the green message.</b>', '<span>Outbid? The page tells you. Bid again any time until 8:30 PM.</span>'] },
  { icon: '🙋', name: 'Live auction', price: 'LIVE', color: '#fb923c', tag: 'RAISE YOUR PADDLE',
    lines: ['Your <b>bidder number is your paddle number</b>. <b>Raise your paddle</b> and the clerk enters it.', 'Or tap <b>Live ⚡</b> on your phone, type your bid and tap <b>Bid</b>.', '<span>Every bid restarts the countdown. After zero, a 5-minute Last Chance window.</span>'] },
  { icon: '🤝', name: 'No phone? No problem', price: 'HELP', color: '#4ade80', tag: 'WE BID FOR YOU',
    lines: ['Go to the <b>Bid Desk</b>, or wave down a <b>runner</b>. A volunteer places your bid on their phone.', 'Tell them your <b>paddle number</b>, the <b>item number</b> and the <b>amount</b>.', '<span>Bids are binding. Check the green confirmation.</span>'] },
]

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>How to bid</title><style>
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;600;700;800&display=swap');
@page { size: 13.333in 7.5in; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: 13.333in; height: 7.5in; background: #101010; color: #fff; font-family: Inter, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.slide { width: 13.333in; height: 7.5in; padding: 0.36in 0.55in 0.3in; display: flex; flex-direction: column; gap: 0.16in; position: relative; overflow: hidden; background: radial-gradient(circle at 50% 0%, #2a2410, #101010 60%) }
.bar { position: absolute; left: 0; right: 0; top: 0; height: 0.12in; background: #f5c518 }
header { display: flex; align-items: center; justify-content: space-between; padding-top: 0.05in }
header img { height: 0.45in }
h1 { font-family: 'Archivo Black', Impact, sans-serif; font-weight: 400; font-size: 44pt; line-height: 0.95; text-transform: uppercase; color: #f5c518 }
.sub { font-size: 17pt; font-weight: 600; color: #ddd; margin-top: 4px }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.22in; flex: 1; min-height: 0 }
.card { border-radius: 18px; padding: 0.22in 0.28in; background: #191919; border: 3px solid var(--c); display: flex; flex-direction: column; gap: 0.08in; box-shadow: 0 0 40px color-mix(in srgb, var(--c) 35%, transparent) }
.top { display: flex; align-items: center; justify-content: space-between }
.icon { font-size: 44pt; line-height: 1 }
.price { font-family: 'Archivo Black', Impact, sans-serif; font-size: 34pt; color: var(--c) }
.tag { font-weight: 800; font-size: 11pt; letter-spacing: 0.22em; color: var(--c) }
.name { font-family: 'Archivo Black', Impact, sans-serif; font-size: 30pt; text-transform: uppercase; line-height: 1 }
.card p { font-size: 15pt; line-height: 1.3; color: #eee }
.card p b { color: var(--c) }
.card p span { font-size: 12.5pt; color: #bbb }
.foot { display: flex; align-items: center; gap: 0.3in; background: #f5c518; color: #101010; border-radius: 16px; padding: 0.1in 0.28in; flex: none }
.foot .q { background: #fff; padding: 5px; border-radius: 8px; width: 0.95in; height: 0.95in; flex: none } .foot .q svg { width: 100%; height: 100% }
.foot p { font-size: 15pt; line-height: 1.3; font-weight: 600 } .foot b { font-weight: 800 }
</style></head><body><div class="slide"><div class="bar"></div>
<header><div><h1>How to bid</h1><p class="sub">Two ways to bid tonight, and help if you don&rsquo;t have a phone.</p></div><img src="${logo}" alt="Story Church"></header>
<div class="cards">${CARDS.map((c) => `<div class="card" style="--c:${c.color}"><div class="top"><span class="icon">${c.icon}</span><span class="price">${c.price}</span></div><p class="tag">${c.tag}</p><p class="name">${c.name}</p>${c.lines.map((l) => `<p>${l}</p>`).join('')}</div>`).join('')}</div>
<div class="foot"><div class="q">${qr}</div><p><b>First, register:</b> scan the code or open <b>${SITE.replace(/^https?:\/\//, '')}/register</b> &rarr; you get a <b>bidder number and a PIN</b>. That&rsquo;s all you need tonight.<br>When you win, pay in the app or at the <b>checkout table</b> and pick up your item.</p></div>
</div></body></html>`

const f = path.join(out, 'Slide-How-To-Bid.html')
writeFileSync(f, html)
const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { readFileSync(p, { flag: 'r' }); return true } catch { return false } })
const url = 'file:///' + f.replace(/\\/g, '/')
const pdf = path.join(out, 'Slide-How-To-Bid.pdf')
const png = path.join(out, 'Slide-How-To-Bid.png')
spawnSync(edge ?? 'msedge', ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=15000', `--print-to-pdf=${pdf}`, url], { stdio: 'ignore' })
spawnSync(edge ?? 'msedge', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1280,720', '--virtual-time-budget=15000', `--screenshot=${png}`, url], { stdio: 'ignore' })
console.log('Slide-How-To-Bid: written to', out)
