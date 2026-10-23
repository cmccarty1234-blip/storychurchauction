/**
 * Full-event simulation over real HTTP against a running production server:
 *   250 guests register (dev codes) → silent bidding storm with stale/conflicting bids → silent close & winners →
 *   live auction (phone requests + paddle bids + clerk accepting concurrently) → in-person checkout payments.
 * Afterwards it audits the database for invariants and prints a report. Driven by scripts/sim-run.mjs.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { one, pool, query } from '../src/lib/db'

const BASE = process.env.SIM_BASE_URL ?? 'http://localhost:3100'
const N_BIDDERS = Number(process.env.SIM_BIDDERS ?? 250)
const STORM_SECONDS = Number(process.env.SIM_STORM_SECONDS ?? 25)

if (!/_sim(\?|$)/.test(process.env.AUCTION_DATABASE_URL ?? '')) throw new Error('simulate.ts only runs against a database whose name ends in _sim')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1))
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const key = () => Math.random().toString(36).slice(2) + Date.now().toString(36)

type Res = { status: number; json: any; cookies: string[] }
async function http(method: string, path: string, opts: { body?: unknown; cookie?: string } = {}): Promise<Res> {
  const res = await fetch(BASE + path, {
    method,
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, cookies: res.headers.getSetCookie?.() ?? [] }
}
const cookieOf = (r: Res) => r.cookies.map((c) => c.split(';')[0]).join('; ')

async function pool_(n: number, tasks: (() => Promise<void>)[]) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < tasks.length) { const t = tasks[i++]; await t() } }))
}

const report: Record<string, unknown> = {}
const failures: string[] = []
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failures.push(`${name} ${detail}`); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

type Guest = { n: number; id: string; cookie: string }

async function main() {
  console.log(`Simulation → ${BASE}  (${N_BIDDERS} bidders)`)
  const ev = (await one<{ id: string }>('select id from events order by created_at desc limit 1'))!

  // ─── Admin login ───
  const login = await http('POST', '/api/admin/login', { body: { email: 'admin@storychurch.test', password: process.env.SEED_ADMIN_PASSWORD ?? 'auction-demo-123' } })
  check('admin login', login.status === 200)
  const admin = cookieOf(login)

  // ─── Phase 1: registration over real HTTP (register → PIN → sign back in) ───
  const t0 = Date.now()
  const guests: Guest[] = []
  const regErrors: string[] = []
  const pins = new Map<number, string>()
  await pool_(30, Array.from({ length: N_BIDDERS }, (_, i) => async () => {
    const contact = i % 2 === 0 ? `719-555-${String(3000 + i).padStart(4, '0')}` : `sim.guest${i}@example.com`
    const r = await http('POST', '/api/auth/register', { body: { contact, name: `Sim Guest ${i}` } })
    if (r.status !== 200) return void regErrors.push(`register ${r.status} ${JSON.stringify(r.json)}`)
    pins.set(r.json.bidderNumber, r.json.pin)
    guests.push({ n: r.json.bidderNumber, id: '', cookie: cookieOf(r) })
  }))
  const dbBidders = await query<{ id: string; bidder_number: number }>('select id, bidder_number from bidders where event_id = $1 and name like $2', [ev.id, 'Sim Guest %'])
  const byNum = new Map(dbBidders.map((b) => [b.bidder_number, b.id]))
  guests.forEach((g) => (g.id = byNum.get(g.n)!))
  report.registration = { requested: N_BIDDERS, registered: guests.length, errors: regErrors.length, seconds: (Date.now() - t0) / 1000 }
  check('every guest received a 4-digit PIN', [...pins.values()].every((p) => /^\d{4}$/.test(p)) && pins.size === guests.length)
  check('250 registrations succeed', guests.length === N_BIDDERS, `${guests.length}/${N_BIDDERS}, errors=${regErrors.length}`)
  check('bidder numbers unique', new Set(guests.map((g) => g.n)).size === guests.length)
  // PIN sign-in on a "new device", wrong PIN, duplicate registration
  const g0 = guests[0]
  const si = await http('POST', '/api/auth/signin', { body: { bidderNumber: g0.n, pin: pins.get(g0.n) } })
  check('sign back in with bidder number + PIN', si.status === 200 && si.cookies.length > 0)
  const wrongPin = pins.get(g0.n) === '0000' ? '1111' : '0000'
  const bad = await http('POST', '/api/auth/signin', { body: { bidderNumber: g0.n, pin: wrongPin } })
  check('wrong PIN rejected (401)', bad.status === 401)
  const dup = await http('POST', '/api/auth/register', { body: { contact: '719-555-3000', name: 'Impersonator' } })
  check('registering with an existing contact is refused (409)', dup.status === 409)
  // session persistence + unauthorised access
  const me = await http('GET', '/my-bids', { cookie: guests[0].cookie })
  check('session persists (my-bids loads)', me.status === 200)
  const anon = await http('GET', '/my-bids')
  check('anonymous /my-bids redirects to register', anon.status === 307)
  const noAuthBid = await http('POST', '/api/bids/silent', { body: { itemId: '00000000-0000-0000-0000-000000000000', amountCents: 5000, expectedCurrentCents: null, idempotencyKey: key() + 'xxxx' } })
  check('anonymous bid rejected (401)', noAuthBid.status === 401)
  const guestAdmin = await http('POST', '/api/admin/live', { cookie: guests[0].cookie, body: { action: 'pause', itemId: '00000000-0000-0000-0000-000000000000' } })
  check('guest cannot call admin API (401)', guestAdmin.status === 401)

  // ─── Phase 2: silent bidding storm ───
  await query(`update events set silent_close_at = now() + ($2 || ' seconds')::interval, silent_start_at = now() - interval '1 hour' where id = $1`, [ev.id, String(STORM_SECONDS + 20)])
  const silent = await query<{ id: string; item_number: number; starting_bid_cents: number; increment_cents: number }>(`select id, item_number, starting_bid_cents, increment_cents from auction_items where event_id = $1 and kind = 'silent' and status = 'open'`, [ev.id])
  const outcome: Record<string, number> = {}
  const tally = (k: string) => (outcome[k] = (outcome[k] ?? 0) + 1)

  // realtime listener
  let sseEvents = 0
  const sseAbort = new AbortController()
  const sseP = fetch(BASE + '/api/stream', { signal: sseAbort.signal }).then(async (r) => {
    const reader = r.body!.getReader(); const dec = new TextDecoder()
    for (;;) { const { value, done } = await reader.read(); if (done) break; sseEvents += (dec.decode(value).match(/^data:/gm) ?? []).length }
  }).catch(() => {})

  const seedBids = (await one<{ n: number }>('select count(*)::int n from silent_bids'))!.n // demo seed history, not part of the storm
  const stormEnd = Date.now() + STORM_SECONDS * 1000
  let requests = 0
  const t1 = Date.now()
  await Promise.all(guests.map(async (g) => {
    while (Date.now() < stormEnd) {
      const it = pick(silent)
      const cur = await one<{ current_bid_cents: number | null }>('select current_bid_cents from auction_items where id = $1', [it.id])
      const expected = cur!.current_bid_cents
      const min = expected == null ? it.starting_bid_cents : expected + it.increment_cents
      const roll = Math.random()
      // 70% bid the exact minimum; 15% a jump bid; 10% too low (invalid increment); 5% claim a stale current bid
      const amount = roll < 0.7 ? min : roll < 0.85 ? min + it.increment_cents * rnd(1, 4) : roll < 0.95 ? Math.max(100, min - 100) : min
      const claimed = roll >= 0.95 && expected != null ? Math.max(0, expected - it.increment_cents) : expected
      const r = await http('POST', '/api/bids/silent', { cookie: g.cookie, body: { itemId: it.id, amountCents: amount, expectedCurrentCents: claimed, idempotencyKey: key() + key() } })
      requests++
      tally(r.status === 200 ? 'accepted' : r.json?.error?.code ?? `http_${r.status}`)
      await sleep(rnd(150, 700))
    }
  }))
  const stormSeconds = (Date.now() - t1) / 1000
  await sleep(1500)
  sseAbort.abort(); await sseP
  report.silentStorm = { seconds: stormSeconds, requests, requestsPerSecond: +(requests / stormSeconds).toFixed(1), outcomes: outcome, sseEventsReceived: sseEvents }
  check('silent storm produced accepted bids and correct rejections', (outcome.accepted ?? 0) > 100 && (outcome.STALE ?? 0) + (outcome.TOO_LOW ?? 0) > 0, JSON.stringify(outcome))
  check('realtime stream delivered events during storm', sseEvents >= (outcome.accepted ?? 0) * 0.5, `${sseEvents} events for ${outcome.accepted} accepted bids`)
  check('no unexpected server errors', !Object.keys(outcome).some((k) => /SERVER_ERROR|http_5/.test(k)), JSON.stringify(outcome))

  // Invariants for every silent item
  let invOk = true
  const invDetail: string[] = []
  for (const it of silent) {
    const bids = await query<{ amount_cents: number; bidder_id: string; created_at: Date }>('select amount_cents, bidder_id, created_at from silent_bids where item_id = $1 order by amount_cents', [it.id])
    const row = (await one<any>('select current_bid_cents, current_bidder_id, bid_count from auction_items where id = $1', [it.id]))!
    const top = bids[bids.length - 1]
    if (bids.length === 0) { if (row.current_bid_cents != null || row.bid_count !== 0) { invOk = false; invDetail.push(`#${it.item_number} empty mismatch`) } continue }
    if (row.current_bid_cents !== top.amount_cents || row.current_bidder_id !== top.bidder_id || row.bid_count !== bids.length) { invOk = false; invDetail.push(`#${it.item_number} leader mismatch`) }
    if (bids[0].amount_cents < it.starting_bid_cents) { invOk = false; invDetail.push(`#${it.item_number} below start`) }
    for (let i = 1; i < bids.length; i++) if (bids[i].amount_cents - bids[i - 1].amount_cents < it.increment_cents) { invOk = false; invDetail.push(`#${it.item_number} increment violated ${bids[i - 1].amount_cents}->${bids[i].amount_cents}`) }
    // time order must agree with amount order (each accepted bid beat the then-current bid)
    const byTime = [...bids].sort((a, b) => +a.created_at - +b.created_at || a.amount_cents - b.amount_cents)
    for (let i = 1; i < byTime.length; i++) if (byTime[i].amount_cents <= byTime[i - 1].amount_cents) { invOk = false; invDetail.push(`#${it.item_number} out-of-order accept`) }
  }
  check('silent invariants (leader = max bid, count, increments, ordering)', invOk, invDetail.slice(0, 3).join('; '))
  const totalSilentBids = (await one<{ n: number }>('select count(*)::int n from silent_bids'))!.n
  check('every HTTP-accepted bid is in the database exactly once', totalSilentBids - seedBids === (outcome.accepted ?? 0), `db=${totalSilentBids - seedBids} (excluding ${seedBids} seeded) http=${outcome.accepted}`)

  // ─── Phase 3: close & winners ───
  const waitMs = Math.max(0, +new Date((await one<{ t: Date }>('select silent_close_at t from events where id = $1', [ev.id]))!.t) - Date.now()) + 1500
  console.log(`waiting ${(waitMs / 1000).toFixed(0)}s for the silent auction to close…`)
  await sleep(waitMs)
  const late: Record<string, number> = {}
  await pool_(25, guests.slice(0, 100).map((g) => async () => {
    const it = pick(silent)
    const r = await http('POST', '/api/bids/silent', { cookie: g.cookie, body: { itemId: it.id, amountCents: 9_000_000 > 5_000_000 ? 4_000_000 : 1, expectedCurrentCents: null, idempotencyKey: key() + key() } })
    const k = r.json?.error?.code ?? `http_${r.status}`
    late[k] = (late[k] ?? 0) + 1
  }))
  check('100 bids after closing are all rejected', (late.CLOSED ?? 0) === 100 || Object.keys(late).every((k) => ['CLOSED', 'STALE'].includes(k)) && (late.CLOSED ?? 0) > 0 && !late.accepted, JSON.stringify(late))
  check('no late bid was stored', (await one<{ n: number }>('select count(*)::int n from silent_bids'))!.n === totalSilentBids)
  const settle = await http('GET', '/admin', { cookie: admin }) // loading the dashboard finalizes due items
  check('dashboard loads after close', settle.status === 200)
  const results = await query<{ item_id: string; bidder_id: string; amount_cents: number }>(`select item_id, bidder_id, amount_cents from winning_results where voided_at is null`)
  let winnersOk = true
  for (const it of silent) {
    const top = await one<{ bidder_id: string; amount_cents: number }>('select bidder_id, amount_cents from silent_bids where item_id = $1 order by amount_cents desc limit 1', [it.id])
    const w = results.filter((r) => r.item_id === it.id)
    if (top ? !(w.length === 1 && w[0].bidder_id === top.bidder_id && w[0].amount_cents === top.amount_cents) : w.length !== 0) winnersOk = false
  }
  const withBids = (await one<{ n: number }>('select count(distinct item_id)::int n from silent_bids'))!.n
  check('silent winners = highest bid, exactly one per item with bids', winnersOk && results.length === withBids, `${results.length} winners / ${withBids} items with bids`)
  report.silentResults = { items: silent.length, itemsWithBids: withBids, winners: results.length, lateBidOutcomes: late }

  // ─── Phase 4: live auction ───
  const liveItems = await query<{ id: string; item_number: number; starting_bid_cents: number; increment_cents: number }>(`select id, item_number, starting_bid_cents, increment_cents from auction_items where kind = 'live' order by item_number`)
  const liveReport: any[] = []
  for (const li of liveItems.slice(0, 3)) {
    const st = await http('POST', '/api/admin/live', { cookie: admin, body: { action: 'start', itemId: li.id } })
    check(`live #${li.item_number} started`, st.status === 200, JSON.stringify(st.json))
    const lo: Record<string, number> = {}
    const lt = (k: string) => (lo[k] = (lo[k] ?? 0) + 1)
    let stop = false
    // clerk loop: accept highest pending request / take paddle bids, concurrently with guests
    const clerk = (async () => {
      while (!stop) {
        const pend = await query<{ id: string; amount_cents: number }>(`select id, amount_cents from live_bid_requests where item_id = $1 and status = 'pending' order by amount_cents desc`, [li.id])
        if (pend.length) {
          // two clerk screens racing to accept the same request
          const [a, b] = await Promise.all([0, 1].map(() => http('POST', '/api/admin/live', { cookie: admin, body: { action: 'accept', requestId: pend[0].id } })))
          lt(a.status === 200 ? 'accepted_mobile' : `accept_${a.json?.error?.code}`); lt(b.status === 200 ? 'accepted_mobile' : `accept_${b.json?.error?.code}`)
        }
        if (Math.random() < 0.5) {
          const cur = (await one<{ c: number | null }>('select current_bid_cents c from auction_items where id = $1', [li.id]))!.c
          const r = await http('POST', '/api/admin/live', { cookie: admin, body: { action: 'paddle', itemId: li.id, paddleNumber: pick(guests).n, amountCents: (cur ?? li.starting_bid_cents - li.increment_cents) + li.increment_cents * rnd(1, 2), idempotencyKey: key() + key() } })
          lt(r.status === 200 ? 'paddle_accepted' : `paddle_${r.json?.error?.code}`)
        }
        if (Math.random() < 0.3 && pend.length) await http('POST', '/api/admin/live', { cookie: admin, body: { action: 'reject', requestId: pick(pend).id } })
        await sleep(rnd(60, 200))
      }
    })()
    const until = Date.now() + 8000
    await Promise.all(guests.slice(0, 120).map(async (g) => {
      while (Date.now() < until) {
        const cur = (await one<{ c: number | null }>('select current_bid_cents c from auction_items where id = $1', [li.id]))!.c
        const min = cur == null ? li.starting_bid_cents : cur + li.increment_cents
        const r = await http('POST', '/api/bids/live-request', { cookie: g.cookie, body: { itemId: li.id, amountCents: min + li.increment_cents * rnd(0, 2), idempotencyKey: key() + key() } })
        lt(r.status === 200 ? 'request_sent' : `request_${r.json?.error?.code}`)
        await sleep(rnd(200, 900))
      }
    }))
    stop = true
    await clerk
    const noClose = await http('POST', '/api/admin/live', { cookie: admin, body: { action: 'close', itemId: li.id, confirmed: false } })
    check(`live #${li.item_number} close needs confirmation`, noClose.status === 400)
    await http('POST', '/api/admin/live', { cookie: admin, body: { action: 'close', itemId: li.id, confirmed: true } })
    const fin = await http('POST', '/api/admin/live', { cookie: admin, body: { action: 'finalize', itemId: li.id, confirmed: true } })
    const afterReq = await http('POST', '/api/bids/live-request', { cookie: guests[0].cookie, body: { itemId: li.id, amountCents: 4_000_000, idempotencyKey: key() + key() } })
    // invariants
    const acc = await query<{ seq: number; amount_cents: number; bidder_id: string; request_id: string | null }>('select seq, amount_cents, bidder_id, request_id from live_accepted_bids where item_id = $1 order by seq', [li.id])
    const ok = acc.length > 0 && acc.every((a, i) => a.seq === i + 1 && (i === 0 || a.amount_cents > acc[i - 1].amount_cents))
    const dupReq = new Set(acc.filter((a) => a.request_id).map((a) => a.request_id)).size === acc.filter((a) => a.request_id).length
    const wr = await query<any>('select bidder_id, amount_cents from winning_results where item_id = $1 and voided_at is null', [li.id])
    const last = acc[acc.length - 1]
    const winnerOk = wr.length === 1 && wr[0].bidder_id === last.bidder_id && wr[0].amount_cents === last.amount_cents
    const pendingLeft = (await one<{ n: number }>(`select count(*)::int n from live_bid_requests where item_id = $1 and status = 'pending'`, [li.id]))!.n
    check(`live #${li.item_number}: accepted bids strictly increasing, gapless seq`, ok, `${acc.length} accepted`)
    check(`live #${li.item_number}: no request accepted twice`, dupReq)
    check(`live #${li.item_number}: winner = last accepted bid`, winnerOk && fin.status === 200, JSON.stringify(wr))
    check(`live #${li.item_number}: nothing pending after close; late request refused`, pendingLeft === 0 && afterReq.status === 409, `pending=${pendingLeft} late=${afterReq.status}`)
    liveReport.push({ item: li.item_number, outcomes: lo, acceptedBids: acc.length, winningCents: last.amount_cents })
  }
  report.live = liveReport

  // ─── Phase 5: checkout ───
  const winners = await query<{ bidder_id: string; owed: number }>(`select bidder_id, sum(amount_cents)::int owed from winning_results where voided_at is null group by bidder_id`)
  const payOutcome: Record<string, number> = {}
  const pt = (k: string) => (payOutcome[k] = (payOutcome[k] ?? 0) + 1)
  let expectedPaid = 0
  await pool_(20, winners.map((w, idx) => async () => {
    // pay a partial amount for ~2/3 of winners, in full for the rest; double-submit every payment (same key) and try overpaying
    const amount = idx % 3 === 0 ? w.owed : Math.max(100, Math.floor(w.owed / 2 / 100) * 100)
    const k = key() + key()
    const rs = await Promise.all([0, 1, 2].map(() => http('POST', '/api/admin/checkout', { cookie: admin, body: { action: 'pay', bidderId: w.bidder_id, method: pick(['cash', 'check', 'card_terminal']), amountCents: amount, idempotencyKey: k } })))
    rs.forEach((r) => pt(r.status === 200 ? (r.json.replay ? 'replay' : 'recorded') : r.json?.error?.code))
    if (rs.some((r) => r.status === 200 && !r.json.replay)) expectedPaid += amount
    const over = await http('POST', '/api/admin/checkout', { cookie: admin, body: { action: 'pay', bidderId: w.bidder_id, method: 'cash', amountCents: w.owed * 2, idempotencyKey: key() + key() } })
    pt(`overpay_${over.json?.error?.code ?? over.status}`)
  }))
  const dash = (await one<any>(`select
      (select coalesce(sum(amount_cents),0)::int from winning_results where voided_at is null) finalized,
      (select coalesce(sum(a.amount_cents),0)::int from payment_allocations a join payments p on p.id = a.payment_id where p.voided_at is null) allocated,
      (select coalesce(sum(amount_cents),0)::int from payments where voided_at is null) paid,
      (select count(*)::int from payments) payments`))!
  check('payments: duplicates collapse (one recorded per payment)', (payOutcome.recorded ?? 0) === winners.length && (payOutcome.replay ?? 0) === winners.length * 2, JSON.stringify(payOutcome))
  check('payments: every overpayment refused', (payOutcome.overpay_OVERPAYMENT ?? 0) + (payOutcome.overpay_INVALID_AMOUNT ?? 0) === winners.length)
  check('payments: allocations equal payments received', dash.allocated === dash.paid && dash.paid === expectedPaid, `paid=${dash.paid} allocated=${dash.allocated} expected=${expectedPaid}`)
  const neg = (await one<{ n: number }>(`select count(*)::int n from (select wr.id, wr.amount_cents - coalesce((select sum(a.amount_cents) from payment_allocations a join payments p on p.id = a.payment_id where a.winning_result_id = wr.id and p.voided_at is null),0) bal from winning_results wr where wr.voided_at is null) x where bal < 0`))!.n
  check('no item has a negative balance', neg === 0)
  const csv = await fetch(BASE + '/api/admin/export/balances', { headers: { Cookie: admin } }).then((r) => r.text())
  const csvRows = csv.trim().split('\r\n').slice(1).map((l) => l.split(','))
  const csvOwed = Math.round(csvRows.reduce((s, r) => s + parseFloat(r[2]) * 100, 0))
  const csvPaid = Math.round(csvRows.reduce((s, r) => s + parseFloat(r[3]) * 100, 0))
  check('CSV export totals match the database', csvOwed === dash.finalized && csvPaid === dash.paid, `csv owed=${csvOwed} paid=${csvPaid}; db owed=${dash.finalized} paid=${dash.paid}`)
  report.checkout = { winners: winners.length, finalizedCents: dash.finalized, collectedCents: dash.paid, outstandingCents: dash.finalized - dash.paid, outcomes: payOutcome }

  // ─── Final DB-level immutability spot check ───
  let immutable = false
  try { await query('update silent_bids set amount_cents = 1 where id = (select id from silent_bids limit 1)') } catch { immutable = true }
  check('accepted bids are immutable in the database', immutable)

  console.log('\n──────── REPORT ────────')
  console.log(JSON.stringify(report, null, 2))
  console.log(failures.length ? `\n${failures.length} FAILED:\n - ${failures.join('\n - ')}` : '\nALL CHECKS PASSED')
  await pool().end()
  process.exit(failures.length ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
