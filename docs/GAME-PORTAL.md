# Game Portal — operator guide

Everything here is **off until an administrator turns on "Game mode"** (Admin → Power-Ups & game → Game settings). With it off, the auction behaves exactly as before.

## Screens
| Who | Address | What |
|---|---|---|
| Guests | `/play` (and a "Live ⚡" link in the header) | Live item + bid box, Last Chance board, My Power-Ups, Power-Up store |
| Projector | `/display` | Public, read-only, full-screen. Bidder numbers only. Mute + reduce-motion + full-screen buttons (bottom right) |
| Hosts | `/admin/show` | Start/pause/extend/end, paddle entry, Room Events, projector mode, announcements, Emergency stop. Hosts and admins only |
| Desk | `/admin/powerups` | Sell Power-Ups (volunteers OK); admins also configure prices, rules, Room Events, Knockout minimums |

## Rules (all enforced on the server, on the database clock)
- **Live timer:** 60 s opening period → 15 s inactivity countdown (every accepted bid resets it) → item enters the **5-minute last-chance window**. Nothing is final in the window: no winner or checkout record exists until it ends (or staff press "Finalize now").
- **Last-chance deadline never resets.** One Resurrection per item (60 s, or whatever is left; refused if under 10 s remain). One Challenge Flag per item (needs a qualifying bid; if the bid is refused the Flag is not used).
- **Final Call** +30 s (1 per guest per item, 2 per item). **Knockout** needs a per-item minimum (set on the Power-Ups page) and must be used before the countdown starts.
- **Block / Back-In** are built in the safer form and **disabled by default**: live items only, never during the countdown, the item is held open until the block ends, Back-In clears it. Enable both only after a rehearsal.
- **Pause** freezes the remaining time. **Emergency stop** freezes every clock and rejects all bids; releasing it pushes deadlines (and the silent closing time) back by the length of the stop.
- **Lightning Round:** $1 steps on chosen open silent items for 60 s. **Battle:** teams dealt alternately by bidder number; 10 points per accepted bid + 1 per $10 raised (game points, not dollars). **Jackpot:** one entry per registered guest, drawn with a cryptographic RNG over a stored snapshot; redraw needs a reason.
- **Money:** Power-Up sales are their own ledger (`powerup_purchases`), never added to a winning bid or checkout. Dashboards show leading bids, finalized wins, Power-Up sales, auction payments and outstanding separately.
- Live phone bids are accepted automatically (switchable). Silent items keep the instant close unless "Silent items also get the last-chance window" is ticked (then the handouts' 8:30 PM wording is no longer exact — winners are final ~8:35).

## Setup checklist
1. Apply `db/migrations/0003_game_portal.sql` once (locally: `npm run db:migrate`; Supabase: paste that single file into the SQL editor). It is additive.
2. Admin → Power-Ups & game: switch Game mode on; set prices; set **Knockout minimums**; leave Block/Back-In off.
3. Create host accounts (role `host`) — for now with `createAdminUser`; locally `npx tsx scripts/game-demo.ts` creates `host@demo.local` on the demo database only.
4. Open `/display` on the projector machine, click once for sound if wanted.
5. Rehearse with real phones before using any of it.

## Tests
`npm test` — 148 tests: lifecycle, Power-Ups (incl. concurrent activations), Room Events, accounting totals, and a 60-bidder simulated night.

## Known limitations
- No background worker: timers advance when any screen (projector, host console, phone) or bid hits the server. With nothing open and nobody bidding, a transition waits for the next request. Keep the projector or host console open during the event.
- The projector animation for Jackpot is cosmetic; the winner shown is the stored draw.
- Silent-item Final Call changes that item's own closing time; Block never applies to silent items.
- Tick polling is cached ~1 s per server instance; at 150+ phones watch Supabase connection counts.
- Not yet built: per-item timer overrides, scheduled (auto-start) Room Events, CSV export of Power-Up sales (the page lists them).
- Live item photos/Knockout minimums must be set before the event.
