/**
 * Seeds a clearly-labelled DEMO event: 20 silent items, 5 live items, sample bidders and bid history.
 *   npm run db:seed            (adds a demo event if the database is empty)
 *   npm run db:seed -- --reset (wipes ALL data in the target database first — demo databases only)
 * Refuses to run in production or against a database that holds a non-demo event.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import { one, pool, query } from '../src/lib/db'
import { createAdminUser, createBidder } from '../src/lib/auth-core'
import { placeSilentBid } from '../src/lib/bidding'
import { writeSeedSvg } from '../src/lib/storage'

const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'auction-demo-123'

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(20261114)
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]

// [title, donor, description, startDollars, incrementDollars, hue]
const SILENT: [string, string, string, number, number, number][] = [
  ['Handmade Heirloom Quilt', 'Sunday Morning Quilters', 'A queen-size patchwork quilt, hand-stitched over three months in warm autumn colors.', 150, 25, 14],
  ['Family Photo Session', 'Aspen Light Photography', 'A one-hour outdoor session for up to six people, plus 15 edited digital images.', 100, 25, 200],
  ['Gourmet Coffee Basket', 'Pikes Perk Roasters', 'Three bags of small-batch beans, a ceramic pour-over set, and two mugs.', 40, 5, 28],
  ['Date Night Dinner for Two', 'Trattoria Bellini', 'A three-course dinner with a bottle of wine at a downtown favorite. Dinner for two.', 80, 10, 350],
  ['Cog Railway Family Pack', 'Mountain Rail Co.', 'Four round-trip tickets to the summit. A Colorado classic.', 120, 20, 160],
  ['Custom Walnut Cutting Board', 'Jim & Carol Hendricks', 'Hand-finished end-grain walnut board with engraved family name.', 60, 10, 30],
  ['Kids’ Birthday Party Package', 'Jump Zone Springs', 'Two hours of bounce-house fun for up to 15 kids, with party host.', 90, 15, 285],
  ['Spring Garden Starter Basket', 'Walnut Street Garden Club', 'Seeds, gloves, tools, and a voucher for a raised-bed kit.', 35, 5, 120],
  ['Book Lover’s Bundle', 'Story Church Library Team', 'Ten hand-picked novels and a cozy reading blanket.', 45, 5, 255],
  ['Baseball Game Day Tickets', 'Anonymous Donor', 'Four lower-level seats for a summer home game, plus parking.', 160, 20, 5],
  ['Relaxing Spa Basket', 'Serenity Day Spa', 'Bath salts, candles, robe, and a gift card for a 60-minute massage.', 110, 15, 300],
  ['Yard Work Day Crew', 'Youth Group Volunteers', 'Our youth group will spend a Saturday morning on your yard. Mowing, raking, hauling.', 75, 10, 100],
  ['Four Home-Cooked Dinners', 'Church Kitchen Team', 'Four family-size dinners delivered to your door over a month.', 100, 20, 40],
  ['Hand-Thrown Pottery Set', 'Maria Lopez', 'Four dinner bowls and a serving platter in a speckled blue glaze.', 85, 10, 215],
  ['Brewery Tour & Tasting for 2', 'Front Range Brewing', 'Behind-the-scenes tour and flight tasting for two adults (21+).', 50, 10, 45],
  ['Guitar Lesson Pack', 'Daniel Reyes', 'Four private one-hour guitar lessons. Beginners welcome.', 70, 10, 330],
  ['Family Movie Night Basket', 'The Whitfield Family', 'Popcorn, candy, blankets, and a gift card for a streaming rental.', 30, 5, 345],
  ['Woodland Park Cabin Weekend', 'The Nguyen Family', 'Friday to Sunday in a cozy two-bedroom cabin with a hot tub. Sleeps six.', 250, 25, 140],
  ['Pie of the Month Club', 'Pastor Dave’s Kitchen', 'A homemade pie delivered fresh once a month for six months.', 90, 10, 20],
  ['Framed Colorado Landscape', 'Eleanor Brooks', 'Original watercolor of Garden of the Gods, framed 16×20.', 130, 20, 190],
]

const LIVE: [string, string, string, number, number, number][] = [
  ['Mountain Cabin Retreat — One Week', 'The Hendricks Family', 'Seven nights in a log cabin near Breckenridge. Sleeps eight. Summer or fall dates.', 500, 50, 150],
  ['Dinner with the Pastors', 'Pastor Dave & Pastor Anna', 'Dave and Anna will cook a full dinner in your home for up to eight guests.', 300, 50, 25],
  ['Hand-Built Adirondack Chairs (Pair)', 'Woodshop Ministry', 'Two cedar chairs and a side table, built and finished by our men’s shop group.', 250, 25, 35],
  ['Hot Air Balloon Ride for Two', 'Skyward Balloons', 'A sunrise flight over the Front Range with a champagne breakfast.', 400, 50, 200],
  ['Custom Family Portrait Painting', 'Eleanor Brooks', 'A commissioned oil portrait of your family, from a photo, 18×24.', 350, 50, 280],
]

function art(title: string, hue: number, label: string) {
  const c1 = `hsl(${hue} 70% 62%)`
  const c2 = `hsl(${(hue + 40) % 360} 65% 38%)`
  const words = title.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 22) {
      lines.push(cur)
      cur = w
    } else cur = (cur + ' ' + w).trim()
  }
  lines.push(cur)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const text = lines.slice(0, 3).map((l, i) => `<text x="400" y="${300 + i * 56}" text-anchor="middle" font-family="Arial,sans-serif" font-size="46" font-weight="700" fill="#fff">${esc(l)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="680" cy="110" r="150" fill="#fff" opacity=".12"/><circle cx="90" cy="540" r="190" fill="#fff" opacity=".10"/>${text}<text x="400" y="545" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" fill="#fff" opacity=".85">${esc(label)} · DEMO IMAGE — replace with a real photo</text></svg>`
}

const FIRST = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Elijah', 'Sophia', 'Mason', 'Isabella', 'Lucas', 'Mia', 'Ethan', 'Grace', 'Caleb', 'Hannah', 'Isaac', 'Ruth', 'Samuel', 'Naomi', 'Joshua', 'Lydia', 'Aaron', 'Esther', 'Daniel', 'Abigail']
const LAST = ['Anderson', 'Baker', 'Carter', 'Diaz', 'Evans', 'Foster', 'Garcia', 'Hughes', 'Ingram', 'Jensen', 'Kim', 'Lopez', 'Miller', 'Nguyen', 'Ortiz', 'Parker', 'Quinn', 'Reyes', 'Smith', 'Turner', 'Underwood', 'Vargas', 'Walker', 'Young']

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data with NODE_ENV=production')
  const reset = process.argv.includes('--reset')
  if (reset) {
    await pool().query(`truncate payment_allocations, payments, item_collections, winning_results, live_bid_voids, live_accepted_bids,
      live_bid_requests, silent_bids, auction_items, bidder_sessions, bidders, admin_sessions, admin_users, audit_logs, events restart identity cascade`)
  }
  const existing = await query<{ is_demo: boolean }>('select is_demo from events')
  if (existing.some((e) => !e.is_demo)) throw new Error('This database contains a real (non-demo) event. Refusing to seed.')
  if (existing.length) {
    console.log('A demo event already exists. Use `npm run db:seed -- --reset` to rebuild it.')
    return
  }

  const close = new Date('2026-11-14T20:00:00-07:00') // 8:00 PM Mountain
  const ev = (await one<{ id: string }>(
    `insert into events (name, event_date, timezone, silent_start_at, silent_close_at, default_increment_cents, pickup_instructions, contact_info, is_demo)
     values ($1,'2026-11-14','America/Denver', now() - interval '1 day', $2, 500, $3, $4, true) returning id`,
    [
      'StoryChurch Fundraiser Auction (DEMO)',
      close,
      'Pick up won items at the Welcome Table in the fellowship hall after checking out with a volunteer. Bring your paddle or bidder number.',
      'Story Church · 502 N Walnut Street, Colorado Springs, CO 80905 · 719.776.0473',
    ],
  ))!

  const admin = (await createAdminUser({ email: 'admin@storychurch.test', name: 'Demo Admin', password: SEED_PASSWORD, role: 'admin' }))!
  await createAdminUser({ email: 'volunteer@storychurch.test', name: 'Demo Volunteer', password: SEED_PASSWORD, role: 'volunteer' })

  // Items
  const items: { id: string; kind: string; start: number }[] = []
  for (const [kind, list, base] of [['silent', SILENT, 0], ['live', LIVE, 100]] as const) {
    for (const [i, [title, donor, desc, start, inc, hue]] of list.entries()) {
      const num = base + i + 1
      const img = `demo-${kind}-${num}.svg`
      await writeSeedSvg(img, art(title, hue, kind === 'live' ? 'LIVE AUCTION' : 'SILENT AUCTION'))
      const row = await one<{ id: string }>(
        `insert into auction_items (event_id, item_number, kind, title, description, donor_name, image_path, starting_bid_cents, increment_cents, status, live_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
        [ev.id, num, kind, title, `${desc} (Demo item — not a real offer.)`, donor, img, start * 100, inc * 100, kind === 'live' ? 'upcoming' : 'open', kind === 'live' ? num : null],
      )
      items.push({ id: row!.id, kind, start: start * 100 })
    }
  }

  // Bidders (fictional; 555-01xx style numbers)
  const bidders: { id: string; bidder_number: number }[] = []
  for (let i = 0; i < 45; i++) {
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`
    const assisted = i % 15 === 14
    const b = await createBidder(pool(), {
      eventId: ev.id,
      name,
      phone: `+1719555${String(100 + i).padStart(4, '0')}`,
      email: i % 3 === 0 ? `demo${i}@example.com` : null,
      assisted,
      adminId: assisted ? admin.id : undefined,
      verified: !assisted,
    })
    bidders.push(b)
  }

  // Sample bid history on silent items (items 15–20 intentionally get no bids)
  let bids = 0
  for (const [idx, it] of items.filter((x) => x.kind === 'silent').entries()) {
    if (idx >= 14) continue
    const rounds = 1 + Math.floor(rand() * 6)
    let current: number | null = null
    let leader = ''
    const meta = SILENT[idx]
    for (let r = 0; r < rounds; r++) {
      const b = pick(bidders.filter((x) => x.id !== leader))
      const amount: number = current == null ? it.start : current + meta[4] * 100 * (1 + Math.floor(rand() * 2))
      try {
        await placeSilentBid({ bidderId: b.id, itemId: it.id, amountCents: amount, expectedCurrentCents: current, idempotencyKey: `seed-${idx}-${r}` })
        current = amount
        leader = b.id
        bids++
      } catch (e) {
        console.warn('seed bid skipped', (e as Error).message)
      }
    }
  }

  console.log(`Seeded DEMO event: 20 silent + 5 live items, ${bidders.length} bidders, ${bids} silent bids.`)
  console.log(`Staff logins (demo only): admin@storychurch.test / volunteer@storychurch.test   password: ${SEED_PASSWORD}`)
}

main()
  .then(() => pool().end())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
