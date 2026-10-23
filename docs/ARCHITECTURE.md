# Architecture & decisions

## Stack (as built)

| Layer | Choice | Note |
|---|---|---|
| App | Next.js 16 (App Router) + TypeScript | `cacheComponents` turned off — every page is dynamic |
| UI | Tailwind CSS v4 + shadcn/ui (Base UI) + Lucide; Archivo Black + Inter | Design tokens in `globals.css` (see DESIGN.md) |
| Database | PostgreSQL 16 (local) | Plain SQL migrations in `db/migrations`; no extensions required |
| Data access | `pg` (server only) | All business rules live in `src/lib/*` and run in transactions |
| Realtime | `LISTEN/NOTIFY` → SSE (`/api/stream`) + polling fallback | **Deviation from the brief** (Supabase Realtime) — see README limitation 1 |
| Auth | Own sessions (httpOnly cookie, hashed token in DB) | Bidders: bidder number + 4-digit PIN. Staff: email + scrypt password |
| QR | `qrcode` (free, local) | |
| Tests | Vitest against a dedicated `*_test` database | |

## Where things are

```
db/migrations/0001_init.sql     schema, constraints, immutability triggers, RLS
src/lib/bidding.ts              silent + live engine (the atomic rules)
src/lib/checkout.ts             payments, balances, release
src/lib/auth-core.ts            codes, sessions, passwords      (no Next imports → unit-testable)
src/lib/session.ts              cookie bridge + requireAdmin/requireBidder
src/lib/realtime.ts             NOTIFY + shared LISTEN connection
src/app/api/**                  thin route handlers (validate → authorize → call lib)
tests/ · scripts/               unit/integration tests · seed, simulate, db helpers
```

## Schema

`events`, `bidders`, `admin_users`, `auction_items`, `silent_bids`, `live_bid_requests`, `live_accepted_bids`, `winning_results`, `payments`, `payment_allocations`, `item_collections`, `audit_logs` (the brief's list), plus `live_bid_voids` (clerk undo), `bidder_sessions`, `admin_sessions`. (Migration 0002 added PIN columns to `bidders` and dropped the unused `verification_codes` table.)

Key properties:

- **Integer cents** for every amount; `check (amount_cents > 0)`.
- **Foreign keys** everywhere; bid tables use `ON DELETE RESTRICT` semantics (no cascades) so history can't vanish.
- **Unique bidder numbers per event** (`unique (event_id, bidder_number)`); the number is allocated by `UPDATE events … RETURNING` which takes a row lock, so concurrent registrations get distinct, gapless numbers. The bidder number doubles as the paddle number.
- **Immutable records:** triggers reject `UPDATE`/`DELETE` on `silent_bids`, `live_accepted_bids`, `live_bid_voids`, `audit_logs`. A clerk's mistake is a *void row*, not an edit.
- **History-preserving corrections:** winning results are *voided* (`voided_at/by/reason`) on reopen; payments are *voided*, never deleted; contact corrections write before/after into the audit log.
- **Server timestamps** (`now()`); closing-time checks use the database clock inside the bid transaction, never the client's.
- **Time zones:** everything stored UTC; the event's IANA zone (`America/Denver`) is applied for input and display only (`src/lib/time.ts`).
- **One live item on the block**, enforced by a partial unique index (`one_live_item_on_block`).
- **Idempotency:** unique `(bidder_id, idempotency_key)` on silent bids and live requests; unique key on payments; paddle entries dedupe by key in the audit log.

## Row-level security

RLS is **enabled on every table with no policies**. The app only talks to Postgres from the server using the owner/service connection (which bypasses RLS), so the Supabase `anon`/`authenticated` roles — and anyone holding the public anon key — can read or write nothing. Bidder phone/email never leave the server: public pages show bidder *numbers* only, and no API returns contact details to guests.

## Authentication flow

1. **Register** (`POST /api/auth/register`): name + phone *or* email → bidder created with the next number (row-locked counter) → a random 4-digit PIN is generated, **only its scrypt hash is stored**, the PIN is returned **once** → session cookie (30 days, httpOnly, SameSite=Lax, `Secure` when the public URL is https). A phone/email that is already registered is refused (409) — the first registration owns it; the existing account is never modified.
2. **Sign back in** (`POST /api/auth/signin`): bidder number + PIN. Wrong or unknown combinations return the same error and cost the same time; 5 wrong PINs lock that bidder for 15 minutes.
3. **Volunteer reset**: staff can issue a new PIN (clears the lock, signs the guest out everywhere, audit-logged). Assisted bidders have no PIN until staff issue one.
4. Registrations are capped at 600/minute as a crude guard against burning bidder numbers.
5. **Staff**: `POST /api/admin/login` (scrypt password), 12-hour sessions; deactivating an account immediately invalidates its sessions. Every admin page and API route calls `requireAdmin(...)` server-side (authentication is checked before the request body is even parsed); the layout redirect is not the only gate. Mutating routes also reject cross-origin requests.

Trade-off (accepted): contact details are not verified, so anyone who learns a PIN can act as that guest, and the first person to register a phone/email owns it. Bids are binding but nothing here charges a card; payment is collected in person against the bidder's name and number.

## Preventing race conditions

Every mutation of an item's bidding state runs in **one transaction that first locks the `auction_items` row** (`SELECT … FOR UPDATE`). Postgres therefore serialises all bids, requests, acceptances, closes and finalizations *for that item*; each one validates against the true current state it just read under the lock.

| Risk | How it's prevented |
|---|---|
| Two simultaneous silent bids both "beating" the same current bid | Row lock; second bid is validated against the first's result. The client also sends the high bid it saw — a mismatch is rejected as **STALE** (with the real numbers) instead of silently accepted |
| Bid exactly at closing time | Close check uses DB `now()` inside the locked transaction; finalization takes the same lock, so every committed bid is counted or cleanly rejected |
| Double tap / network retry | Idempotency key → same result returned, no second bid |
| Two clerk screens accepting the same phone request | Request row locked; second sees `status ≠ pending` → `ALREADY_RESOLVED` |
| Accepting a request overtaken by a higher bid | Re-checked at acceptance: amount must exceed the current accepted bid, otherwise the request is expired as outbid |
| Bids after a live item is closed/finalized | Status checked under the lock; `finalized` items accept nothing |
| Two volunteers overpaying a balance | Per-bidder row lock; balance recomputed under the lock; overpayment rejected |
| Double payment submit | Unique idempotency key |
| Two admins finalizing at once | Lock + status re-check; unique partial index allows only one active winning result per item |
| Duplicate bidder numbers | Counter row locked on allocation + unique constraint |

Verified by automated tests (60 simultaneous silent bids, 8 simultaneous accepts of one request, racing payments, concurrent registrations) and by the HTTP simulation — see [TEST-REPORT.md](TEST-REPORT.md).

## Realtime design

Writers call `pg_notify('auction', …)` **inside** the transaction (delivered only on commit). One shared `LISTEN` connection per server process fans events out to open `/api/stream` connections. The event carries no data — just "something changed" — so each client re-renders its own, correctly authorized server view (`router.refresh()`), throttled to once per 1.5 s per device with random jitter. If the stream drops, or is open but silent, the client polls (8–10 s).

## Money & states cheat-sheet

- Silent item: `open` → (time passes or admin closes) → `finalized` (winner recorded automatically on the next page load/API call after the closing time).
- Live item: `upcoming` → `open` ⇄ `paused` → `closed` → `finalized`. Reopen (admin) → `paused`.
- Winning result → `item_collections` row (`pending` → `released`).
- Balance for a win = winning amount − allocations from non-voided payments.
