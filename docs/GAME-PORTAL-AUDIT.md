# Game Portal — Phase 1 audit, conflicts and architecture

Baseline before any change: **89 / 89 tests pass** (commit `eb8b8c3`). Nothing below has been built yet.

## 1. What exists and is reusable

| Need | Existing piece | Verdict |
|---|---|---|
| Atomic bid acceptance | `bidding.ts`: one transaction, `SELECT … FOR UPDATE` on `auction_items`, idempotency keys, stale-bid check | **Reuse as the one acceptance engine**; extend `lockItem` |
| Paddle bids | `recordPaddleBid` → `appendAcceptedBid` (immutable `live_accepted_bids`, voids as separate rows) | Reuse |
| Realtime | `pg_notify` → one LISTEN → SSE `/api/stream` → client refresh | Reuse for projector, host console, portal |
| Winners + money | `winning_results` → `payment_allocations` (FIFO) → `item_collections` | Reuse; Power-Up money goes in a **separate** ledger |
| Audit | `audit_logs` (append-only trigger) | Reuse for every transition / activation |
| Auth | Bidder session cookie; staff `admin`/`volunteer` | Reuse; add a `host` role (small CHECK change) |
| Bid Desk, Items table, QR, Live console | exist | Reuse; Live console is superseded by `/admin/show` but stays |

## 2. Conflicts with current behaviour (need your decision)

1. **Live bids are clerk-approved today.** A phone bid is only a *request*; the clerk taps Accept (`acceptLiveRequest`). The spec wants phone bids accepted automatically by the server, with the timer reacting to them. That removes the human from the loop for live items. *Recommendation:* make auto-accept a per-event switch (`auto_accept_live`), with paddle entry unchanged. `live_accepted_bids.entered_by_admin_id` becomes nullable and `source` gains no new value.
2. **Silent items finalize instantly at close** (winner + checkout record created at 8:30). The spec adds a 5-minute provisional window first, so silent winners would become final at ~8:35, and the printed handouts ("closes 8:30 PM") would be misleading. *Recommendation:* the provisional window is an **event setting, default OFF**. Turn it on only if you want it Oct 30 (then re-issue the handouts).
3. **Status model.** Current `status`: draft, upcoming, open, paused, closed, finalized. Spec: Draft, Scheduled, Active, Paused, Provisionally Closed, Reopened, Finalized, Cancelled. Mapping: draft→Draft, upcoming→Scheduled, open→Active; add `provisional`, `reopened`, `cancelled`; existing `closed` stays as "closed by admin, awaiting finalize". All transitions go through one validated transition table. The unique "one live item on the block" index only covers `open/paused`, which is correct (the next live item may start while the previous one sits in its 5-minute window).
4. **No background worker.** Vercel Hobby can't run per-second jobs. Timers can't "fire". *Design:* every deadline is a DB timestamp; any request (bid, tick, projector/host poll) first runs an idempotent `advance(item)` under the row lock that performs due transitions. The projector and host console call `/api/tick` every second or two, so transitions happen on time while those screens are open; finalization is idempotent so it is safe if several callers race. Cost: if no screen is open and nobody bids, a transition waits until the next request.
5. **Block & Back is not fair as specified** on silent items (no countdown exists, and a 30 s block can silently cost someone the item) and is the most "pay to hurt another guest" mechanic. *Safer alternative proposed:* live items only; blocking never takes effect inside the final-countdown or provisional window; **an active block holds the item's deadline open until the block ends + 15 s** so the blocked guest always gets a response window; Back-In clears it instantly; a guest can't be blocked twice per item; ships **disabled by default** until rehearsed.
6. **Power-Ups depend on new per-item settings:** `min_qualifying_bid_cents` (Knockout), live-timer parameters. Added as nullable columns on `auction_items`.
7. **Lightning Round** needs the increment to be time-dependent: `minNextBid` gets an optional override from an active Room Event session; leading bids untouched.
8. **Accounting.** `payments` only allocates to won items. Power-Up sales get their own tables (`powerup_purchases`, with method/amount/received-by/void) and their own totals; checkout statements keep showing only auction wins. Dashboard shows leading bids, finalized wins, Power-Up revenue, payments received and outstanding as separate lines so nothing double counts.

## 3. Risks

- **Timing:** the event is Oct 30; production runs real data on the current code. All migrations are **additive** (new tables/columns/CHECK widening); nothing is dropped; nothing is run against Supabase until you approve; everything ships behind an event-level `game_mode` flag, default off, so deployed code behaves exactly as today.
- **Scope vs. a week:** the engine (Phases 2–4) is where the risk is; projector/animations/Room Events are additive. A rehearsal with real phones is required before any game feature is used live.
- **Money rules:** Power-Ups are paid purchases of in-game privileges, not auction bids. Check with the church treasurer how to word receipts (donation vs. purchase). Mystery Jackpot is free-entry by design (no purchase) so it is not a paid raffle.
- **Projector** is a public read-only page showing bidder *numbers* only, never names/contacts.

## 4. New schema (migration `0003_game_portal.sql`, additive)

`events` (+`game_mode`, timer config, `auto_accept_live`, `provisional_enabled`, `provisional_seconds`), `auction_items` (+`min_qualifying_bid_cents`, `phase_deadline`, `phase`, `reopen_used`, `provisional_deadline`, `timer_paused_remaining`), `item_transitions` (append-only), `powerup_defs`, `powerup_purchases`, `powerup_inventory` (view), `powerup_activations`, `item_blocks`, `room_event_defs`, `room_event_sessions`, `room_teams`, `jackpot_draws`, `announcements`.

## 5. Phases

2 Lifecycle · 3 Power-Ups · 4 Live engine + host console · 5 Projector + portal · 6 Room Events · 7 Integration/sim. Each phase ends with tests green and a commit; nothing is pushed or deployed.
