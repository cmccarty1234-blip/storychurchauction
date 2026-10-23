# Deploying (Vercel + Supabase)

The code is ready; the hosted pieces are created by you in the Vercel and Supabase dashboards. Never paste secret keys into chat or commit them.

## Environment variables (set in Vercel → Project → Settings → Environment Variables)

| Name | Required | Value |
|---|---|---|
| `AUCTION_DATABASE_URL` | yes | Supabase → Connect → **Session pooler** connection string (the app needs a *session* connection so live updates can use `LISTEN`; transaction-mode would fall back to polling). TLS is handled automatically. |
| `SUPABASE_URL` | yes (photos) | Project URL, e.g. `https://abcd1234.supabase.co` (Project Settings → API) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes (photos) | The `service_role` secret (Project Settings → API Keys). **Server-only. Never put it in a `NEXT_PUBLIC_` variable.** |
| `NEXT_PUBLIC_APP_URL` | no | Only if you add a custom domain. On Vercel the app uses `VERCEL_PROJECT_PRODUCTION_URL` (e.g. `https://storychurchauction.vercel.app`) automatically for QR codes and secure cookies. If you set it, redeploy afterwards (it is read at build time). |
| `AUCTION_DB_POOL_MAX` | no | Connections per serverless instance (default 3 on Vercel). Lower it if Supabase reports "max clients reached". |
| `SUPABASE_STORAGE_BUCKET` | no | Default `item-images` (a private bucket, created automatically on first upload) |

Not needed: SMS or email settings (there is none), `AUTH_SECRET`, `ALLOW_DEV_CODES`, `UPLOAD_DIR`.

## One-time database setup

1. **Tables:** Supabase → SQL Editor → New query → paste the entire contents of [`db/supabase-setup.sql`](../db/supabase-setup.sql) → Run. Run it **once** on the empty project. (It's generated from `db/migrations` by `npm run db:bundle`; it creates no demo data and turns on row-level security so the public API key can read/write nothing.)
2. **Event + first administrator** (run on your computer so the password never leaves it). PowerShell, in the project folder:
   ```powershell
   $env:AUCTION_DATABASE_URL = "<paste the same Session pooler string>"
   npm run setup -- --event "StoryChurch Fundraiser 2026" --date 2026-11-14 --close "2026-11-14T20:00" --admin-email you@church.org --admin-name "Your Name" --admin-password "<a long password>"
   ```
   It refuses to run against a database that holds the demo event.
3. Deploy (Vercel builds from the GitHub `main` branch), open `/admin/login`, finish **Settings**, add volunteer accounts, then create items (or run the donor-list import once it exists).
4. **Rehearse on real phones** over the real URL before the event: register, bid, a live request, checkout, a photo upload.

## What was adjusted for Vercel

- Hosted Postgres needs TLS; `src/lib/pgconfig.ts` enables it automatically for any non-local host.
- Photos go to a private Supabase Storage bucket via `src/lib/storage.ts`. Guests load them through `/api/uploads/…` (cached by Vercel's CDN), so the service key never reaches a browser. In production without these settings, uploads fail with a clear message rather than writing to Vercel's temporary disk.
- Vercel limits request bodies to ~4.5 MB, so photos are shrunk in the browser (≤1600 px) before upload, which also makes them load faster on phones.
- The live-update stream is capped at 60 s per connection (Hobby-safe) and reconnects automatically; the page also polls slowly as a safety net.
- Each serverless instance keeps a small connection pool (3) so the pooler isn't exhausted.

## Limits and costs to keep an eye on

- **Vercel Hobby** is described by Vercel as for personal, non-commercial use; you've decided that's fine for now — recheck their current terms. Free-tier request/bandwidth/duration limits apply; the app throttles each phone to one refresh per 1.5 s.
- **Supabase Free** projects have historically paused after about a week of inactivity (open the project the day before the event and test), and have connection, storage and bandwidth limits. Watch the session pooler's client limit if many phones are connected at once.
- **Domain:** `*.vercel.app` is free; a custom domain costs money.

## Demo data

The seed script refuses to run when `NODE_ENV=production` or when the database holds a non-demo event. Never point it at the production database.
