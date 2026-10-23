# Test report

Run on 2026-10-23, Windows 11, Node 24, PostgreSQL 16.15 (local), Next.js 16.4.3.

## 1. Automated tests — `npm test`

**55 tests, 4 files, all passing** (~50 s) against a dedicated `storychurch_test` database.

| File | Tests | Covers |
|---|---|---|
| `registration.test.ts` | 14 | phone/email parsing; register with name+phone and name+email (bidder #1001 + 4-digit PIN + session); PIN stored only as a hash; invalid contact/name; duplicate contact refused and first account untouched; number alone / wrong PIN / unknown number cannot sign in; sign back in on a new device; lock after 5 wrong PINs; volunteer PIN reset (signs out everywhere, clears lock, audited); assisted bidders; 20 concurrent registrations get unique numbers; admin login (wrong/unknown/inactive identical); bidder token ≠ admin session |
| `silent.test.ts` | 14 | valid/low/stale/self-outbid/junk bids; idempotent double-tap; before-start and after-close rejection; draft/closed/live items; assisted bid records guest + volunteer; DB immutability; **60 simultaneous bids → exactly 1 accepted, 59 STALE**; 40 retrying clients converge with every increment respected; 25 identical bids → 1 wins; winner = highest bid, finalized once even with 3 concurrent finalizers; admin close/reopen with reason, old result voided not deleted |
| `live.test.ts` | 17 | one item on the block; refusal when not open/paused/closed; request ≠ bid until accepted; below-minimum and leader requests refused; reject; duplicate submissions; superseding requests; **8 simultaneous accepts of one request → 1 bid**; 30 simultaneous requests, accepting the top expires the rest; overtaken request refused; paddle ordering rules; paddle double-tap; undo last bid; close/finalize need confirmation; nothing accepted after finalize; unsold item; reopen with reason + audit |
| `checkout.test.ts` | 10 | totals across silent + live wins; partial payments allocated oldest-first with exact balances; overpayment/invalid input; double-submit; **racing payments can't overpay**; void keeps history + audit + restores balance; no payment deletion; release blocked until paid, volunteers can't override, admin exception needs a reason; voiding reports already-released items; reopen blocked while payments exist |

Static checks: `tsc --noEmit` clean, `eslint` clean (the `no-explicit-any` rule is off — database rows are loosely typed), `next build` succeeds.

## 2. Full-event simulation — `npm run sim`

250 guests over **real HTTP** against the **production build** (`NODE_ENV=production`, separate `storychurch_sim` database): **44 checks, all passed** (latest run, after the PIN and redesign changes).

| Phase | Result |
|---|---|
| Registration | 250/250 registered via `/api/auth/register` in ~6 s, each with a 4-digit PIN and unique bidder number; sign back in with number + PIN works; wrong PIN → 401; re-registering an existing contact → 409; anonymous bid → 401; guest calling an admin API → 401; anonymous `/my-bids` → redirect |
| Silent storm | 25.8 s, 250 guests × 20 items, **7,118 requests (≈276/s)**: 954 accepted, 6,059 STALE, 102 TOO_LOW, 3 ALREADY_LEADING, **0 server errors**. SSE delivered 954 events for 954 accepted bids |
| Silent invariants | all 20 items: leader = max bid, count correct, every increment ≥ minimum, time order = amount order, HTTP-accepted bids = rows in the database |
| Closing | 100 bids after closing: all `CLOSED`, none stored; 20/20 items got exactly one winner = highest bid |
| Live (3 items, ~1,000 phone requests each + paddle bids + two clerk screens racing to accept) | 51 / 53 / 59 accepted bids; gapless `seq`, strictly increasing amounts; no request accepted twice (each racing double-accept: 1 success, 1 `ALREADY_RESOLVED`); close needs confirmation; winner = last accepted bid; nothing pending after close; late request refused (409) |
| Checkout | 23 winners; each payment submitted 3× → 1 recorded + 2 replays; every overpayment refused; allocations = payments = $22,766.00 collected of $37,465.00 finalized ($14,699.00 outstanding); no negative balances; CSV totals match the database exactly; accepted bids immutable at the database |

Counts vary run to run. The simulation's contention is far harsher than a real event (every guest bidding every ~0.4 s on 20 items), which is why STALE rejections dominate. The first PIN-era run exposed a real flaw — a 120-registrations-per-minute guard rejected 147 of 250 simultaneous sign-ups — so the guard was raised to 600/minute and the run repeated.

## 3. Manual checks (in-app browser, local dev server)

- Guest: real registration through the UI (name + email → bidder #1048 + PIN screen), session persisted, first bid placed (confirmation shown only after the server replied); page flipped to "You've been outbid" with a new minimum **without a reload** when another guest bid, and back to "high bidder" after an assisted bid.
- Staff: sign-in, dashboard, live console (bring to block → paddle bid → phone request appears live → accept → close → finalize), checkout ledger, partial payment, QR label page, CSV exports. Unauthenticated access to every `/admin` page redirects; every admin API returns 401 without a session.
- QR code decoded with OpenCV → the correct item URL; `/i/101` redirects to the item.
- Viewports: phone (375), tablet (768), desktop (1024) on the main screens.

## 4. Not tested / known gaps

- Real phones, other browsers, assistive technology or automated accessibility tooling.
- Printing (label sheets, checkout summary) beyond on-screen layout.
- Sign-in on a second physical device with a PIN (covered by unit tests and the simulator, not clicked through in the UI).
- Supabase (hosted or local), Vercel, and Supabase Realtime — none were available/used.
- Concurrency beyond one server process (multiple instances share the database, so the row-lock guarantees hold, but this wasn't exercised).
- Staff UI flows for voiding payments, unrelease, reopening, assisted registration and settings were tested via the engine tests and API, but only some were clicked through in the browser.

## 5. Redesign verification (visual-only pass, spec v1.1)

- No bidding, auth-flow, schema, or data changes in the redesign. The only schema change in this round is migration 0002 (PIN columns), approved separately.
- Automated in-browser audit (`scripts/a11y-audit.js`) on the homepage, auction list, item/bid page, My bids (phone width) and dashboard, items, live console, checkout, settings (desktop): **0 text elements below WCAG AA contrast**, **0 horizontal overflow**, and every guest-facing control ≥ 44 px after fixes (the audit found and I fixed: a decorative yellow period at 1.5:1, 38 px quick-bid chips, a 24 px logo link, 20 px reorder arrows, 36 px filter pills). Remaining sub-44 px controls are dense staff-table actions at 40 px (documented in DESIGN.md).
- Fresh-tab console: no errors on `/`, `/auction`, item page.
- Not done: screen-reader testing, real phones, Windows high-contrast mode.
