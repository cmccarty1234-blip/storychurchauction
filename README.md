# StoryChurch Auction

A simple, mobile-first auction app for the StoryChurch fundraiser: a **silent auction** (guests bid from their phones, live updates), a **live auction** (physical paddles plus phone bid requests, run by a clerk), and **in-person checkout** (cash, check, card terminal). No online payments, no paid services.

> **Status: working local MVP.** Built and tested locally only. It has **not** been deployed, no hosted database or domain exists, and nothing connects to any other StreamHome system. Read [Known limitations](#known-limitations) before relying on it for a real event, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for what is needed first.

The seeded data is **DEMO data** (clearly labelled in the UI). Never seed it into a real event database.

## Quick start (Windows, local)

Requirements: Node 20+ and a PostgreSQL 14+ install (the dev scripts use the Postgres binaries at `PG_BIN`).

```bash
npm install
cp .env.example .env.local        # then edit if needed (PG_BIN etc.)
npm run db:init                   # creates the local cluster in ./.pgdata (once)
npm run db:start                  # starts Postgres on 127.0.0.1:54329
node scripts/pg.mjs createdb storychurch storychurch_test storychurch_sim
npm run db:migrate                # applies db/migrations/*.sql
npm run db:seed                   # demo event: 20 silent + 5 live items, 45 bidders, sample bids
npm run dev                       # http://localhost:3000
```

Demo staff logins (seeded, **demo only**): `admin@storychurch.test` and `volunteer@storychurch.test`, password `auction-demo-123` (override with `SEED_ADMIN_PASSWORD` when seeding).

Guest sign-up: register at `/register` with a name plus phone *or* email. You get a bidder number and a 4-digit PIN straight away (shown once; take a screenshot) and stay signed in on that phone. To sign back in on another phone, use bidder number + PIN; a volunteer can reset a lost PIN from the bidder's page in the staff area.

To try it on a phone on the same Wi-Fi, set `NEXT_PUBLIC_APP_URL=http://<your-PC-LAN-IP>:3000` in `.env.local`, restart, and open that address (QR codes use the same variable).

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Dev server / production build / serve the build |
| `npm test` | 55 automated tests (registration, silent, live, checkout) against `storychurch_test` |
| `npm run sim` | 250-bidder full-event simulation over HTTP against a production build (run `npm run build` first) |
| `npm run db:seed -- --reset` | Wipe the dev database and re-create the demo event |
| `npm run setup -- --event … --admin-email …` | First-time setup of a **real** database (event + administrator); refuses demo databases |
| `npm run typecheck` / `npm run lint` | Static checks |
| `npm run db:stop` | Stop the local Postgres |

> **Gotcha:** this project reads `AUCTION_DATABASE_URL` / `AUCTION_TEST_DATABASE_URL`, deliberately **not** `DATABASE_URL`. A `DATABASE_URL` for another project (a hosted Supabase one was found set in this machine's shell) can therefore never be picked up by accident. Tests and the simulator refuse to run unless the database name ends in `_test` / `_sim`.

## What it does

**Guests** (`/`): register with name + phone *or* email → bidder number (e.g. *Bidder #1042*, also their paddle number) and a 4-digit PIN. No codes, no texts, no email. Browse items, bid, see live updates, get a clear success/failure message (the page never says "bid placed" until the server confirms). `/my-bids`, `/my-wins`.

**Silent auction:** server-enforced start/close times, minimum increments, stale-bid detection, one atomic transaction per bid, integer cents everywhere, every accepted bid kept permanently. Winner = highest bid, recorded automatically at the closing time.

**Live auction** (`/admin/live`): one item "on the block" at a time. The clerk types the paddle number and amount (Enter to record). Guests' phone bids arrive as **requests** that are *not* bids until the clerk accepts them. Open / pause / close, undo last bid (void, with reason), finalize winner (close and finalize both need explicit confirmation), reopen (administrators only, with a reason). All accepted bids, paddle and phone, share one history. Program order can be changed with up/down buttons.

**Guests without smartphones:** volunteers register them as *assisted bidders* (issue a paddle) and can place silent bids for them; the record keeps both the guest and the volunteer.

**Checkout** (`/admin/checkout`): search by name/number; every item won, total, paid, balance; cash / check / card terminal; partial payments; payments can be voided by an administrator (history kept, reason + audit entry); items can't be released until paid unless an administrator records an exception with a reason; printable summary; CSV exports (results, payments, balances).

**Dashboard:** commitments (leading bids, finalized wins, outstanding) are shown separately from payments actually received.

**QR labels:** `/admin/labels` — printable StoryChurch-branded labels (item number, title, QR, "Scan to Bid"), generated locally with the free `qrcode` package.

## Routes

Guest: `/` · `/register` · `/auction` · `/auction/[itemId]` · `/my-bids` · `/my-wins` · `/i/[number]` (short QR link)
Staff: `/admin/login` · `/admin` · `/admin/items` (+ `/new`, `/[id]`) · `/admin/bidders` (+ `/[id]`) · `/admin/bids` (history + audit log) · `/admin/live` · `/admin/checkout` (+ `/[bidderId]`, `/print`) · `/admin/labels` · `/admin/settings`

Staff roles: **volunteer** (live console, record bids/payments, register guests, release paid items) and **administrator** (also: void payments, reopen items, release unpaid, settings, staff accounts). Authorization is enforced server-side in every page and API route.

## Branding & design

Bold, light, modern: warm ivory pages, white cards, black Archivo Black headlines, Inter body text, **Story Yellow** buttons, and sparing gold accents. The homepage leads with the slogan **YOUR STORY MATTERS.** The palette, type scale, component rules and the (few) places the implementation deviates from the spec are in [docs/DESIGN.md](docs/DESIGN.md); the colors are the approved *working* palette, not verified official brand hex codes. The logos in `public/brand/` are the white banner and icon from storychurch.co, shown solid black on the white header. **Please have the church confirm the logo files.** Demo item "photos" are generated placeholder art labelled *DEMO IMAGE*. Screenshots are in `docs/screenshots/`.

## More documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — decisions, schema, auth flow, **how race conditions are prevented**
- [docs/DESIGN.md](docs/DESIGN.md) — design tokens, components, accessibility audit, deviations
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — preparing for Vercel + Supabase, costs and plan restrictions
- [docs/TEST-REPORT.md](docs/TEST-REPORT.md) — what was tested and the actual results

## Known limitations

These are real and matter for a live event:

1. **Not Supabase locally.** Docker Desktop would not start on this machine, so the local Supabase stack (and Supabase Realtime) could not be used. The app runs on plain PostgreSQL with the same SQL schema, and realtime uses Postgres `LISTEN/NOTIFY` → Server-Sent Events, with polling as a fallback. The SQL is plain Postgres and should run on Supabase unchanged, **but that has not been tested**, and Supabase Realtime is not implemented.
2. **No identity verification, by design.** Phone/email are contact records only. Identity on a phone is its session; getting back in elsewhere needs bidder number + PIN (5 wrong PINs lock that bidder for 15 minutes; volunteers can reset). Consequences you should accept knowingly: anyone who learns a guest's PIN can bid as them, and whoever registers a phone/email first owns it. There is no SMS and no email sending, so no email provider or limits to manage.
3. **Photos use Supabase Storage in production (private bucket, server-side key).** Written and unit-tested with a mocked network, but not yet run against a real Supabase project.
4. **Realtime through a pooled database connection:** `LISTEN` doesn't work through transaction-mode poolers. The client then polls (every ~8–10 s), so updates still arrive, just slower.
5. Public bid history shows bidder *numbers* (never names or contact info). Staff see everything.
6. Accessibility was designed in (labels, focus rings, contrast, keyboard use, live regions) but **not audited** with assistive technology or an automated checker.
7. Visual checks were done in the in-app browser (phone width for guest pages, tablet for the live console, desktop for admin) — not on real phones or other browsers — and print output (labels, checkout summary) was checked on screen only.
8. No automatic extension of the silent auction (by design for the MVP), no notifications to winners, no drag-and-drop live ordering (up/down buttons instead).
