// Builds the two one-page handouts as self-contained HTML + print-ready PDF (Letter).
//   node handouts/build.mjs            (needs Microsoft Edge; run from the project folder)
// Change SITE / CLOSE_TIME / CHURCH_PHONE below if the address or details change, then re-run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import QRCode from 'qrcode'

const SITE = process.env.HANDOUT_SITE ?? 'https://storychurchauction.vercel.app'
const CLOSE_TIME = '8:30 PM'
const CHURCH_PHONE = '719.776.0473'
const out = path.resolve('handouts/out')
mkdirSync(out, { recursive: true })

const logo = 'data:image/png;base64,' + readFileSync('public/brand/storychurch-banner.png').toString('base64')
const qr = (url) => QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#101010', light: '#ffffff' } })
const host = SITE.replace(/^https?:\/\//, '')

const css = `
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700;800&display=swap');
@page { size: Letter; margin: 0 }
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: 8.5in; height: 11in; background: #f7f5ef; color: #101010; font-family: Inter, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact }
.page { width: 8.5in; height: 11in; padding: 0.42in 0.5in 0.38in; display: flex; flex-direction: column; gap: 0.16in; position: relative; overflow: hidden }
.bar { position: absolute; left: 0; right: 0; top: 0; height: 0.12in; background: #f5c518 }
header { display: flex; align-items: center; justify-content: space-between; padding-top: 0.06in }
header img { height: 0.42in; filter: brightness(0) }
header .tag { font-weight: 700; font-size: 10pt; letter-spacing: .06em; text-transform: uppercase; color: #686868 }
h1 { font-family: 'Archivo Black', Impact, sans-serif; font-weight: 400; font-size: 40pt; line-height: .95; text-transform: uppercase }
.sub { font-size: 12.5pt; color: #292929; margin-top: 4px }
.panel { background: #fff; border: 1px solid #e7e4dd; border-radius: 12px; padding: 0.2in 0.24in; }
.pill { display: inline-block; font-weight: 800; font-size: 10pt; letter-spacing: .08em; text-transform: uppercase; padding: 4px 12px; border-radius: 999px }
.pill.y { background: #f5c518; color: #101010 } .pill.k { background: #101010; color: #f5c518 }
h2 { font-family: 'Archivo Black', Impact, sans-serif; font-weight: 400; font-size: 21pt; text-transform: uppercase; line-height: 1; margin: 7px 0 8px }
ol { list-style: none; counter-reset: s; display: grid; gap: 7px }
ol li { counter-increment: s; position: relative; padding-left: 36px; font-size: 11.6pt; line-height: 1.32 }
ol li::before { content: counter(s); position: absolute; left: 0; top: -1px; width: 25px; height: 25px; border-radius: 50%; background: #f5c518; color: #101010; font-weight: 800; font-size: 11.5pt; display: grid; place-items: center }
.k ol li::before, .dark ol li::before { background: #101010; color: #f5c518 }
b { font-weight: 700 }
.note { margin-top: 8px; padding: 7px 11px; border-radius: 8px; background: #f7f5ef; font-size: 10.6pt; line-height: 1.3 }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.18in }
.foot { display: flex; align-items: center; gap: 0.2in; margin-top: auto; background: #101010; color: #fff; border-radius: 12px; padding: 0.15in 0.22in }
.foot .q { background: #fff; padding: 6px; border-radius: 8px; width: 1.05in; height: 1.05in; flex: none } .foot .q svg { width: 100%; height: 100% }
.foot b.u { color: #f5c518; font-size: 14pt; display: block; word-break: break-all }
.foot p { font-size: 10.5pt; line-height: 1.35 }
.big li { font-size: 14pt !important; line-height: 1.34 }
.yellow { background: #f5c518 }
`

const head = (title, tag) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body><div class="page"><div class="bar"></div>
<header><img src="${logo}" alt="Story Church"><span class="tag">${tag}</span></header>`

// ───────────────── Sheet 1: How to bid ─────────────────
const bid = async () => `${head('How to bid', 'Community auction · Fri Oct 30')}
<div><h1>How to bid</h1><p class="sub">Two ways to bid tonight. Pick whichever fits the item &mdash; you can do both.</p></div>

<section class="panel">
  <span class="pill y">Silent auction</span> <span style="font-size:10.6pt;margin-left:8px">Bid on your phone any time until <b>${CLOSE_TIME}</b></span>
  <h2>Bid from your phone</h2>
  <ol>
    <li><b>Scan the QR code</b> on the item card, or open <b>${host}</b> and tap <b>Auction</b>.</li>
    <li>Check the <b>current bid</b> and the <b>minimum bid</b>. Type your amount, or tap a quick amount.</li>
    <li>Tap <b>Place bid</b>. <b>Wait for the green message</b> &mdash; &ldquo;Bid placed! You&rsquo;re the high bidder.&rdquo; No green message means no bid.</li>
    <li>Outbid? The page updates by itself and shows <b>&ldquo;You&rsquo;ve been outbid&rdquo;</b>. Bid again, or let it go.</li>
    <li>At <b>${CLOSE_TIME}</b> the highest bid wins. Check <b>My bids</b> and <b>My wins</b> on the site.</li>
  </ol>
  <p class="note"><b>No smartphone?</b> Fill in a bid slip and hand it to the <b>Bid Desk</b> &mdash; a volunteer will place your bid for you.</p>
</section>

<section class="panel">
  <span class="pill k">Live auction</span> <span style="font-size:10.6pt;margin-left:8px">Items come up one at a time, called by the auctioneer</span>
  <h2 style="font-size:18pt">Raise your paddle &mdash; or tap your phone</h2>
  <ol>
    <li>Your <b>bidder number is your paddle number</b>. Find it in your registration screenshot or on the site&rsquo;s <b>My bids</b> page.</li>
    <li><b>Raise your paddle</b> when the auctioneer calls a bid you want. The clerk records it.</li>
    <li>On your phone? Open the item that is <b>&ldquo;On the block now&rdquo;</b> and tap <b>Request bid</b>.</li>
    <li>A phone request is <b>not a bid until the clerk accepts it</b>. Watch for &ldquo;The clerk accepted your bid &mdash; you&rsquo;re leading!&rdquo; The auctioneer decides who wins.</li>
  </ol>
</section>

<div class="foot"><div class="q">${await qr(SITE + '/auction')}</div>
  <p><b class="u">${host}/auction</b>When you win: pay at the <b>checkout table</b> (cash, check or card), then pick up your item. Can&rsquo;t stay? Call the church at <b>${CHURCH_PHONE}</b>.</p></div>
</div></body></html>`

// ───────────────── Sheet 2: How to register ─────────────────
const reg = async () => `${head('How to register', 'Community auction · Fri Oct 30')}
<div><h1>How to<br>register</h1><p class="sub">It takes about one minute. No app to download, no email or text codes.</p></div>

<section class="panel">
  <ol class="big">
    <li><b>Scan the QR code</b> below with your phone camera, or open <b>${host}/register</b>.</li>
    <li>Type your <b>full name</b> and <b>one mobile number or email</b>. The church only uses it to reach you about your winnings and pickup &mdash; other guests never see it.</li>
    <li>Tap <b>Register &amp; start bidding</b>.</li>
    <li><b>Take a screenshot!</b> You&rsquo;ll see your <b>bidder number</b> and a <b>4-digit PIN</b> once. Your bidder number is also your <b>paddle number</b> for the live auction.</li>
    <li>Tap <b>Start bidding</b> and browse the items. You stay signed in on this phone.</li>
  </ol>
</section>

<div class="two">
  <section class="panel">
    <span class="pill y">Already registered?</span>
    <h2 style="font-size:16pt">Sign in again</h2>
    <p style="font-size:11pt;line-height:1.35">Open <b>${host}/register</b>, tap <b>&ldquo;Sign in with your PIN&rdquo;</b>, and enter your <b>bidder number</b> and <b>PIN</b>.</p>
    <p class="note"><b>Lost your PIN?</b> Ask any volunteer at the Registration Desk &mdash; we&rsquo;ll give you a new one.</p>
  </section>
  <section class="panel">
    <span class="pill k">No smartphone?</span>
    <h2 style="font-size:16pt">We&rsquo;ll register you</h2>
    <p style="font-size:11pt;line-height:1.35">Come to the <b>Registration Desk</b>. A volunteer will register you, hand you a <b>paddle</b>, and place <b>silent auction bids</b> for you at the <b>Bid Desk</b>. You can raise your paddle in the live auction.</p>
  </section>
</div>

<div class="foot"><div class="q">${await qr(SITE + '/register')}</div>
  <p><b class="u">${host}/register</b>Your bidder number and PIN are the only things you need tonight. Bids are binding, and you pay in person at checkout. Questions? Ask a volunteer, or call the church at <b>${CHURCH_PHONE}</b>.</p></div>
</div></body></html>`

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { readFileSync(p, { flag: 'r' }); return true } catch { return false } })
for (const [name, html] of [['How-To-Bid', await bid()], ['How-To-Register', await reg()]]) {
  const f = path.join(out, `${name}.html`)
  writeFileSync(f, html)
  const pdf = path.join(out, `${name}.pdf`)
  const r = spawnSync(edge ?? 'msedge', ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=15000', `--print-to-pdf=${pdf}`, 'file:///' + f.replace(/\\/g, '/')], { stdio: 'ignore' })
  console.log(`${name}: ${r.status === 0 ? 'pdf written' : 'pdf failed (' + r.status + ')'} → ${pdf}`)
}
