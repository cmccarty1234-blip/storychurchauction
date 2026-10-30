// Builds the one-page handouts (guest + volunteer + host) as self-contained HTML + print-ready PDF (Letter).
//   node handouts/build.mjs            (needs Microsoft Edge; run from the project folder)
// Change SITE / CLOSE_TIME / CHURCH_PHONE below if the address or details change, then re-run.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import QRCode from 'qrcode'

const SITE = process.env.HANDOUT_SITE ?? 'https://auction.storychurch.co'
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
table.t { width: 100%; border-collapse: collapse; font-size: 11pt } table.t th { text-align: left; font-size: 9.5pt; letter-spacing: .06em; text-transform: uppercase; color: #686868; padding: 4px 8px 4px 0; border-bottom: 2px solid #101010 }
table.t td { padding: 6px 8px 6px 0; border-bottom: 1px solid #e7e4dd; vertical-align: top } table.t td.p { font-weight: 800; white-space: nowrap }
.rule { background: #101010; color: #fff; border-radius: 12px; padding: 0.14in 0.2in; font-size: 11.4pt; line-height: 1.35 } .rule b { color: #f5c518 }
.chk li { list-style: none; padding-left: 26px; position: relative; margin: 5px 0; font-size: 11.2pt; line-height: 1.3 } .chk li::before { content: ''; position: absolute; left: 0; top: 2px; width: 15px; height: 15px; border: 2px solid #101010; border-radius: 3px }
.slips { display: grid; grid-template-columns: 1fr 1fr; gap: 0.12in; flex: 1 } .slip { border: 2px dashed #101010; border-radius: 10px; padding: 0.12in 0.16in; background: #fff; display: flex; flex-direction: column; gap: 5px }
.slip h3 { font-family: 'Archivo Black', Impact, sans-serif; font-weight: 400; font-size: 13pt; text-transform: uppercase } .slip .f { display: flex; align-items: flex-end; gap: 6px; font-size: 10pt; font-weight: 700 } .slip .f i { flex: 1; border-bottom: 1.5px solid #101010; height: 17px }
.slip small { font-size: 8.5pt; color: #686868 }
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
    <li><b>Raise your paddle</b> to bid. The clerk enters it, and the big screen shows the new bid.</li>
    <li>On your phone? Tap <b>Live &#9889;</b> at the top of the site, type your bid and tap <b>Bid</b>. Wait for <b>&ldquo;Accepted! You lead.&rdquo;</b></li>
    <li>Watch the <b>countdown</b>. Every new bid restarts it. When it hits zero the item closes into a <b>5-minute Last Chance window</b> &mdash; it isn&rsquo;t final until that ends. <b>Power-Ups</b> can change the ending (ask for the Power-Ups sheet).</li>
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


const POWERUPS = [
  ['Resurrection', '$30', 'Live items only. Brings an item in its Last Chance window back for 60 seconds, once per item. Add your own bid to take the lead.'],
  ['Final Call', '$15', 'Adds 30 seconds to a running timer.'],
  ['The Knockout', '$30', 'Ends bidding now; the leader becomes the provisional winner. Only on items with a Knockout minimum.'],
]
const PIES = [
  ['Pie Brandon: small', '$100', 'Sign up to throw a small pie at the finale.'],
  ['Pie Brandon: LARGE', '$200', 'Sign up to throw a LARGE pie at the finale.'],
]
const pieRows = PIES.map(([n, p, d]) => `<tr><td class="p">${n}</td><td class="p">${p}</td><td>${d}</td></tr>`).join('')
const puRows = POWERUPS.map(([n, p, d]) => `<tr><td class="p">${n}</td><td class="p">${p}</td><td>${d}</td></tr>`).join('')

// ───────────────── Bid Desk (volunteers) ─────────────────
const bidDesk = async () => `${head('Bid Desk', 'Volunteer guide · Bid Desk')}
<style>.page{gap:0.1in;padding-bottom:0.3in} ol li{font-size:10.6pt;line-height:1.28} .panel{padding:0.13in 0.2in} h1{font-size:32pt}</style>
<div><h1>Bid Desk</h1><p class="sub">The <b>Bid Desk is home base</b>. For guests <b>without a smartphone</b>, you place their silent-auction bids on your phone &mdash; at the desk, or walking the room.</p></div>
<section class="panel"><span class="pill y">Placing a bid</span>
  <ol style="margin-top:8px">
    <li>Sign in at <b>${host}/admin</b> on your phone. Tap <b>Bid desk</b> in the menu.</li>
    <li>Type the guest&rsquo;s <b>paddle number</b>. Confirm the <b>name</b> that appears &mdash; say it back to them.</li>
    <li>Type the <b>item number</b> (on the item card). The <b>minimum bid</b> is filled in. Change it to the amount the guest wants.</li>
    <li>Tap <b>Place bid</b> and wait for the <b>green confirmation</b>. Tell the guest: &ldquo;You&rsquo;re the high bidder at $___.&rdquo;</li>
    <li>Outbid? The guest&rsquo;s page lists every item they&rsquo;ve been <b>outbid</b> on with the new minimum. Ask: &ldquo;Want to raise?&rdquo; One tap pre-fills it.</li>
  </ol></section>
<div class="two">
  <section class="panel"><span class="pill k">Keep it fast</span>
    <ul class="chk" style="margin-top:8px"><li>Guests can come to the <b>Bid Desk</b>, and runners also take bids <b>on the spot</b> with their phone.</li><li>Paper slips are only a backup. A runner collects them <b>every 3 minutes</b>.</li><li>Silent bidding <b>closes at ${CLOSE_TIME}</b>. The system refuses anything later.</li><li><b>Slip cutoff: 8:20 PM.</b> After that, bid only on the spot.</li><li><b>Power-Ups and Pie Brandon sign-ups are sold here too</b> (Power-Ups are also sold online from 5:00 PM) &mdash; see the &ldquo;Selling Power-Ups&rdquo; sheet.</li><li><b>Chili votes</b> are on the guest&rsquo;s own phone at <b>${host}/chili</b> &mdash; you don&rsquo;t take that money here.</li></ul></section>
  <section class="panel"><span class="pill y">If something goes wrong</span>
    <ul class="chk" style="margin-top:8px"><li>No green message = <b>no bid</b>. Try again; it never double-bids.</li><li>&ldquo;Bid just changed&rdquo;: someone beat it. Show the guest the new minimum.</li><li>Wrong guest or amount? Tell <b>Brandon or Dee</b>. Don&rsquo;t retype it.</li></ul></section>
</div>
<p class="rule"><b>Never</b> bid without the guest telling you the amount, and never bid for yourself. Bids are binding, and every bid you place is recorded under your name.</p>
<div class="foot"><p><b class="u">Paddle number lost?</b>Look the guest up under <b>Bidders</b> in the menu by name. Don&rsquo;t guess.</p></div>
</div></body></html>`

// ───────────────── Bid slips ─────────────────
const slip = () => `<div class="slip"><h3>Silent auction bid slip</h3>
 <div class="f">Paddle #<i></i> Item #<i></i></div><div class="f">Item name<i></i></div><div class="f">My bid: $<i></i></div>
 <div class="f">Name<i></i></div><div class="f">Volunteer<i></i> Time<i></i></div><small>Bids are binding. Minimum bid is on the item card. Silent auction closes at ${CLOSE_TIME}.</small></div>`
const slips = async () => `${head('Bid slips', 'Cut along the dashed lines')}
<div><h1 style="font-size:28pt">Bid slips</h1></div>
<div class="slips">${Array.from({ length: 8 }, slip).join('')}</div>
</div></body></html>`

// ───────────────── Selling Power-Ups at the Bid Desk (volunteers) ─────────────────
const puDesk = async () => `${head('Selling Power-Ups', 'Volunteer guide · Bid Desk')}
<style>.page{gap:0.09in;padding-bottom:0.28in} ol li{font-size:10.2pt;line-height:1.26} .panel{padding:0.1in 0.2in} h1{font-size:28pt} table.t{font-size:9.8pt} .note{font-size:9.4pt} .rule{font-size:10pt;padding:0.1in 0.18in} .foot{padding:0.1in 0.2in} .foot p{font-size:9.8pt}</style>
<div><h1>Selling<br>Power-Ups</h1><p class="sub"><b>Pie Brandon sign-ups</b> are sold <b>only at the Bid Desk</b>. <b>Power-Ups</b> are sold here too, and from <b>5:00 PM</b> guests can also buy them online. Here, you take the money, record it, and it is added to the guest&rsquo;s account.</p></div>
<section class="panel"><span class="pill y">Selling one</span>
  <ol style="margin-top:8px">
    <li>Sign in at <b>${host}/admin</b>. Tap <b>Power-Ups</b>.</li>
    <li>Type the guest&rsquo;s <b>paddle number</b>. Check that the <b>name</b> shown matches the person in front of you.</li>
    <li>Choose the <b>Power-Up or pie</b>, the <b>quantity</b> and <b>how they paid</b> (cash, check, or <b>card terminal</b> &mdash; the on-site kiosk, only after it says <b>Approved</b>).</li>
    <li><b>Take the payment first.</b> Then tick <b>&ldquo;I have received $__&rdquo;</b> and tap <b>Record sale</b>.</li>
    <li>It shows in the guest&rsquo;s <b>My Power-Ups</b> instantly. Tell them: &ldquo;Use it from the <b>Live &#9889;</b> page.&rdquo;</li>
  </ol></section>
<section class="panel"><span class="pill k">What they&rsquo;re buying</span>
  <table class="t" style="margin-top:8px"><tr><th>Item</th><th>Price</th><th>What it is</th></tr>${puRows}${pieRows}</table>
  <p class="note"><b>Bought online?</b> A guest who paid in the app already has them in <b>My Power-Ups</b> &mdash; don&rsquo;t sell them again. Not showing after a few minutes? Get <b>Brandon or Dee</b>. An online sale you void must be refunded in Square by hand. An administrator can change prices. A Power-Up is used <b>once</b> and is not refunded after use. <b>Pies:</b> the host calls people up in the order they signed up.</p></section>
<p class="rule"><b>Never</b> add a Power-Up without receiving payment. Wrong guest or quantity? Tell <b>Brandon or Dee</b> &mdash; sales are corrected with a record, never erased. Power-Up and pie money is counted <b>separately</b> from auction winnings and is <b>not</b> added to anyone&rsquo;s checkout.</p>
<div class="foot"><p><b class="u">Count your cash drawer</b>At the end of the night the <b>Power-Ups</b> page shows total sales by cash / check / card. Your drawer should match.</p></div>
</div></body></html>`

// ───────────────── Power-Ups (guests) ─────────────────
const puGuest = async () => `${head('Power-Ups', 'Community auction · Fri Oct 30')}
<div><h1>Power-Ups</h1><p class="sub">Change how an auction ends. Buy them <b>in the app from 5:00 PM</b>, or at the <b>Bid Desk</b>, and use them from your phone.</p></div>
<section class="panel"><table class="t"><tr><th>Power-Up</th><th>Price</th><th>What it does</th></tr>${puRows}</table></section>
<section class="panel"><span class="pill y">How to use one</span>
  <ol style="margin-top:8px">
    <li>Buy it <b>online from 5:00 PM</b>: open <b>Live &#9889;</b> &rarr; <b>Power-Up store</b> &rarr; <b>Buy online</b> and pay by card. Or buy at the <b>Bid Desk</b> (cash, check or card) and tell the volunteer your <b>paddle number</b>. Either way it&rsquo;s added to your account right away.</li>
    <li>On your phone, tap <b>Live &#9889;</b>. Your Power-Ups are under <b>My Power-Ups</b>.</li>
    <li>When one can be used, a <b>&ldquo;Use &hellip;&rdquo;</b> button appears. Tap it to see <b>exactly what will happen</b>, then confirm.</li>
  </ol>
  <p class="note"><b>Last Chance:</b> when a live item&rsquo;s countdown ends, it enters a <b>5-minute window</b>. Nothing is final yet &mdash; this is when Resurrection works. A Power-Up never makes you the winner by itself: you still have to out-bid.</p>
  <p class="note"><b>Pie Brandon sign-ups</b> are sold <b>only at the Bid Desk</b> &mdash; not online.</p></section>
<div class="foot"><div class="q">${await qr(SITE + '/play')}</div><p><b class="u">${host}/play</b>Every guest can use these. Ask a volunteer if you&rsquo;re not sure.</p></div>
</div></body></html>`

// ───────────────── Checkout table (volunteers) ─────────────────
const checkout = async () => `${head('Checkout', 'Volunteer guide · Checkout table')}
<style>.page{gap:0.1in;padding-bottom:0.3in}</style>
<div><h1 style="font-size:28pt">Checkout table</h1><p class="sub">Nobody leaves with an item until it is <b>paid and released</b>. <b>Always trust the Checkout screen &mdash; not a phone screenshot.</b></p></div>
<section class="panel" style="padding:0.1in 0.2in"><span class="pill y">Step 1 &middot; every guest</span>
  <p style="margin-top:6px;font-size:11.4pt;line-height:1.35">Sign in at <b>${host}/admin</b> &rarr; <b>Checkout</b> &rarr; search by <b>name or bidder number</b> &rarr; open the guest. You&rsquo;ll see everything they won and the <b>balance due</b>.</p></section>
<div class="two" style="gap:0.14in">
  <section class="panel" style="padding:0.1in 0.18in"><span class="pill k">A &middot; Paid in the app (best)</span>
    <ol style="margin-top:6px;gap:5px"><li style="font-size:10.2pt">Guest opens <b>My wins</b> &rarr; <b>Pay now</b> &rarr; pays with a credit or debit card.</li><li style="font-size:10.2pt">They show you their <b>receipt</b>. You open their page &mdash; it says <b>Paid online (Square)</b> and the balance is <b>$0</b>.</li><li style="font-size:10.2pt">Balance $0? <b>Release</b> each item and hand it over.</li></ol>
    <p class="note" style="font-size:9.4pt">Screen still shows a balance? <b>Refresh</b> and wait a minute. Still not there? Get <b>Brandon or Dee</b> &mdash; don&rsquo;t release yet.</p></section>
  <section class="panel" style="padding:0.1in 0.18in"><span class="pill k">B &middot; Paid at the kiosk</span>
    <ol style="margin-top:6px;gap:5px"><li style="font-size:10.2pt">Guest pays the <b>full balance</b> at the card kiosk and waits for <b>Approved</b>.</li><li style="font-size:10.2pt">The kiosk does <b>not</b> tell the app. On the guest&rsquo;s page, record a payment: method <b>Card terminal</b>, the <b>same amount</b>, and the kiosk receipt number as the reference.</li><li style="font-size:10.2pt">Balance $0? <b>Release</b> and hand over.</li></ol>
    <p class="note" style="font-size:9.4pt"><b>Record it once.</b> If they already paid in the app, don&rsquo;t record the kiosk too.</p></section>
</div>
<div class="two" style="gap:0.14in">
  <section class="panel" style="padding:0.1in 0.18in"><span class="pill y">C &middot; Cash or check</span>
    <ol style="margin-top:6px;gap:5px"><li style="font-size:10.2pt">Count it. Record the payment: <b>Cash</b> or <b>Check</b> + amount (check number as the reference).</li><li style="font-size:10.2pt">Partial payments are fine &mdash; the balance stays on screen. <b>Release</b> only fully paid items.</li></ol></section>
  <section class="panel" style="padding:0.1in 0.18in"><span class="pill y">Chili cook-off votes</span>
    <p style="margin-top:6px;font-size:10.2pt;line-height:1.32">If the guest voted, a <b>Chili cook-off votes</b> box appears on their page. It is <b>separate</b> from their items and is <b>not</b> paid in the app. Collect it, then tap <b>Cash</b>, <b>Check</b> or <b>Card terminal</b>. Mistaken tap? <b>Remove</b> (unpaid votes only).</p></section>
</div>
<div class="two" style="gap:0.14in">
  <section class="panel" style="padding:0.1in 0.18in"><span class="pill k">Good to know</span>
    <ul class="chk" style="margin-top:6px"><li style="font-size:10pt">Items in a <b>Last Chance</b> window aren&rsquo;t won yet &mdash; they appear when final.</li><li style="font-size:10pt"><b>Power-Ups and pies</b> were paid for already (in the app or at the Bid Desk) &mdash; not at checkout.</li></ul></section>
  <section class="panel" style="padding:0.1in 0.18in"><span class="pill y">Can&rsquo;t stay tonight?</span>
    <p style="margin-top:6px;font-size:10.2pt;line-height:1.32">Guests call the church at <b>${CHURCH_PHONE}</b>. We&rsquo;ll call back and set a pickup time. Don&rsquo;t promise a time yourself.</p></section>
</div>
<p class="rule" style="font-size:10.2pt"><b>Paid twice, paid too much, or wrong item?</b> Stop and get <b>Brandon or Dee</b>. Mistakes are corrected by <b>voiding with a reason</b> &mdash; never deleted. A guest who overpaid online shows a <b>refund due</b> alert: Brandon or Dee refunds them in Square.</p>
</div></body></html>`

// ───────────────── Host guide (2 pages): run of show, the block, commercials, emergency card ─────────────────
const hostSheet = async () => `${head('Host guide', 'Host guide · 1 of 2')}
<style>
html,body{height:auto} .page{height:11in;break-after:page;gap:0.1in;padding-bottom:0.3in} .page:last-of-type{break-after:auto}
.page ol li{font-size:10.4pt;line-height:1.27} .panel{padding:0.1in 0.2in} .chk li{font-size:10.2pt;margin:3px 0} .note{font-size:9.4pt;margin-top:6px} table.t{font-size:9.8pt} .rule{font-size:10pt;padding:0.09in 0.18in} h1{font-size:28pt}
</style>
<div><h1>Host guide</h1><p class="sub">You run the room; the system runs the clocks. Open <b>${host}/admin/show</b> on your tablet or phone. The projector is <b>${host}/display</b>.</p></div>
<section class="panel"><span class="pill y">Before doors</span>
  <ul class="chk" style="margin-top:6px;columns:2;column-gap:0.25in"><li>Projector open on <b>/display</b>, full screen, set to <b>Welcome</b>.</li><li><b>One click</b> on the projector page so videos have sound.</li><li>Game mode <b>on</b>; goal and prices set.</li><li>Items shown to guests; desks stocked.</li><li>Test on a real phone: register, bid, buy a Power-Up.</li></ul></section>
<section class="panel"><span class="pill k">Running a live item &mdash; &ldquo;On the block&rdquo;</span>
  <ol style="margin-top:7px">
    <li>Introduce the item. Under <b>Up next</b>, tap <b>Start</b> (the top one is gold).</li>
    <li><b>Every live item plays a commercial first</b> &mdash; its own clip, or a 12-second spot with its photo and opening bid. <b>Bidding opens when it ends</b> (or tap <b>Skip it &amp; open bidding</b>).</li>
    <li>The clock starts with a <b>60-second opening period</b>. After that, <b>every bid restarts a 15-second countdown</b>.</li>
    <li><b>Phone bids</b> arrive by themselves. For a <b>paddle bid</b> from the room: type the <b>paddle #</b> and the <b>amount</b>, tap <b>Enter paddle bid</b>.</li>
        <li>At zero the item goes into <b>Last Chance</b> for 5 minutes (<b>Last-chance window</b> panel). It is <b>not final</b> until the timer ends, or you tap <b>Finalize now</b> (tap twice). Then <b>Start</b> the next item.</li>
  </ol></section>
<div class="two" style="gap:0.14in">
  <section class="panel"><span class="pill y">Buttons on the block</span>
    <table class="t" style="margin-top:5px"><tr><td class="p">Pause / Resume</td><td>Holds <b>this item&rsquo;s</b> time. <b>+15 s</b> adds time.</td></tr><tr><td class="p">End bidding</td><td>Tap twice. Starts Last Chance now.</td></tr><tr><td class="p">Emergency stop</td><td>Freezes <b>everything</b>. See below.</td></tr></table></section>
  <section class="panel"><span class="pill y">The screen calls it for you</span>
    <ul class="chk" style="margin-top:5px"><li><b>10 s</b> GOING ONCE &middot; <b>5 s</b> GOING TWICE &middot; <b>2 s</b> FINAL CALL</li><li>Each higher bid flashes <b>+$</b> with a <b>ka-ching</b>.</li><li><b>3+ bids in 20 s</b> shows a <b>BIDDING WAR</b> banner.</li></ul></section>
</div>
<section class="panel"><span class="pill k">Last Chance &amp; Power-Ups</span>
  <p style="margin-top:6px;font-size:10.2pt;line-height:1.32">Guests buy Power-Ups <b>online from 5:00 PM</b> or at the Bid Desk, and play them from <b>Live &#9889;</b> on their phone. <b>Resurrection</b> (live items only) works during Last Chance, and a Power-Up never wins by itself &mdash; they still have to out-bid.</p></section>
<section class="panel" style="border:3px solid #b3261e"><span class="pill" style="background:#b3261e;color:#fff">Something is wrong</span>
  <ul class="chk" style="margin-top:6px"><li><b>Emergency stop</b> freezes ALL bidding and clocks (fire alarm, fight, medical). Tap twice and say why. <b>Resume bidding</b> gives everyone back the time lost, silent closing time too.</li><li><b>Wi-Fi trouble?</b> Phones reconnect by themselves; paddle bids still work. <b>Wrong bid?</b> <b>Undo</b> with a reason in the Live console.</li></ul></section>
</div>
<div class="page"><div class="bar"></div>
<header><img src="${logo}" alt="Story Church"><span class="tag">Host guide · 2 of 2</span></header>
<div><h1 style="font-size:26pt">Commercials, chili &amp; the screen</h1></div>
<section class="panel"><span class="pill k">Commercial breaks</span>
  <ol style="margin-top:7px">
    <li>On the host page, find <b>Commercial breaks</b>. The projector needs <b>internet</b>.</li>
    <li>Pick the <b>silent item to promote</b> (it shows underneath the clip with a QR code), or leave it on <b>Auto</b> &mdash; the clips are already linked to their items. Tap <b>Play</b>.</li>
    <li>The projector becomes a retro TV and the break lasts <b>exactly as long as the clip</b>. Then it returns by itself.</li>
    <li><b>Stop it</b> ends one early. Clips linked to a live item show <b>Skip it &amp; open bidding</b> instead.</li>
  </ol>
  <p class="note"><b>No sound?</b> Click once anywhere on the projector page (a &ldquo;Click here for sound&rdquo; chip shows). You can&rsquo;t start a break during an Emergency stop or while another is playing. <b>Live items</b> start their commercial on their own when you tap Start (Broadmoor and Royal Gorge have clips; the rest get the 12-second spot). The <b>Chick-fil-A</b> clips and <b>IHOP</b> promote silent items &mdash; you play those.</p></section>
<div class="two" style="gap:0.14in">
  <section class="panel"><span class="pill y">Chili cook-off</span>
    <ol style="margin-top:6px;gap:4px"><li style="font-size:10pt">Under <b>Chili cook-off</b>, tap <b>Open voting</b>. Guests vote at <b>/chili</b>: <b>$1 = 1 vote</b>.</li><li style="font-size:10pt">Tap <b>Show the chili board</b> to put the standings on the projector.</li><li style="font-size:10pt">Tap <b>Close voting</b>, then show the board. Most dollars wins.</li></ol>
    <p class="note" style="font-size:9.2pt">Chili money is paid at checkout and counted <b>separately</b>.</p></section>
  <section class="panel"><span class="pill y">Room Events</span>
    <p style="margin-top:6px;font-size:10pt;line-height:1.3"><b>&#9889; Lightning Round:</b> $1 bids on every open silent item for 60 s. <b>Battle of the Room:</b> teams are dealt automatically. <b>Mystery Jackpot:</b> type the prize, tap it, then <b>Draw winner</b> (a random registered guest; <b>Redraw</b> needs a reason). <b>End it now</b> stops any of them.</p></section>
</div>
<section class="panel"><span class="pill k">Projector screens &mdash; tap to switch</span>
  <table class="t" style="margin-top:5px"><tr><td class="p">Welcome</td><td>Doors open. QR to register.</td><td class="p">Chili board</td><td>Chili standings.</td></tr>
  <tr><td class="p">Auction</td><td>Totals, closing clock, spotlight.</td><td class="p">Pie finale</td><td>Pie Brandon in the Face.</td></tr>
  <tr><td class="p">Live item</td><td>Forces the item view.</td><td class="p">Thank you</td><td>Total raised, pickup info.</td></tr>
  <tr><td class="p">Automatic</td><td>Hands control back to the system.</td><td class="p">Flash it / Pin</td><td>Type an announcement; <b>Flash</b> shows it briefly, <b>Pin</b> keeps it.</td></tr></table></section>
<section class="panel"><span class="pill y">Pie Brandon in the Face (finale)</span>
  <p style="margin-top:6px;font-size:10.2pt;line-height:1.32">Tap <b>Show the pie screen</b>. People are called up <b>in the order they signed up</b> (the top row says <b>NEXT</b>). Tap <b>Splat!</b> as each pie is thrown &mdash; it can&rsquo;t be thrown twice.</p></section>
<div class="foot"><p><b class="u">Silent auction closes ${CLOSE_TIME}.</b>Switch to <b>Thank you</b> when checkout opens. Church phone: ${CHURCH_PHONE}.</p></div>
</div></body></html>`

const edge = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => { try { readFileSync(p, { flag: 'r' }); return true } catch { return false } })
for (const [name, html] of [['How-To-Bid', await bid()], ['How-To-Register', await reg()], ['How-To-Use-Power-Ups', await puGuest()], ['Volunteer-Bid-Desk', await bidDesk()], ['Volunteer-Bid-Slips', await slips()], ['Volunteer-Bid-Desk-Selling-Power-Ups', await puDesk()], ['Volunteer-Checkout-Table', await checkout()], ['Host-Run-Of-Show', await hostSheet()]]) {
  const f = path.join(out, `${name}.html`)
  writeFileSync(f, html)
  const pdf = path.join(out, `${name}.pdf`)
  const r = spawnSync(edge ?? 'msedge', ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=15000', `--print-to-pdf=${pdf}`, 'file:///' + f.replace(/\\/g, '/')], { stdio: 'ignore' })
  console.log(`${name}: ${r.status === 0 ? 'pdf written' : 'pdf failed (' + r.status + ')'} → ${pdf}`)
}
