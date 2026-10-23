# Preparing for deployment (Vercel + Supabase)

**Nothing here has been done.** No Vercel project, hosted database or domain exists; that needs approval first. This is the checklist for when you decide to go.

## What the app needs

| Setting | Notes |
|---|---|
| `AUCTION_DATABASE_URL` | Postgres connection string. Use a **session-mode / direct** connection if possible (see "Realtime" below) |
| `NEXT_PUBLIC_APP_URL` | The public address, e.g. `https://storychurch-auction.vercel.app`. Used for QR codes and the Secure-cookie flag. Change it without touching code |
| `UPLOAD_DIR` | Local dev only — replaced by Supabase Storage in production (see "Photos") |

No `vercel.json` is required and none is included. Build: `npm run build`; start: `npm start`.

## Steps (when approved)

1. Create a **new, separate** Supabase project (not any existing StreamHome one) and a **new, separate** Vercel project.
2. Run `db/migrations/*.sql` against the new database in order (`npm run db:migrate` with `AUCTION_DATABASE_URL` pointing at it). Do **not** run the demo seed against it.
3. Create the real event and the first administrator on the new database (never the demo seed):
   `npm run setup -- --event "StoryChurch Fundraiser 2026" --date 2026-11-14 --close "2026-11-14T20:00" --admin-email you@church.org --admin-name "Your Name" --admin-password "<long password>"`
   (with `AUCTION_DATABASE_URL` pointing at the new database). It refuses to touch a database holding the demo event.
4. Sign in at `/admin/login`, finish the event in **Settings** (dates, pickup text, contact), add volunteer accounts, then create the items.
5. Set the env vars above in Vercel, deploy, set `NEXT_PUBLIC_APP_URL`, then reprint QR labels.
6. Do a full rehearsal on the real URL with real phones **before** the event (register, bid, live request, checkout).

## Things that will bite if not handled

- **Photos (decision: Supabase Storage):** Vercel's filesystem is not persistent, so `src/lib/storage.ts` (two functions: save, read) must be pointed at a Supabase Storage bucket before real photos are uploaded. *Not implemented yet — waiting for the new Supabase project.* Needs: a new, separate Supabase project created by you, then the project URL and a server-side service key stored only as a Vercel environment variable (never pasted into chat or committed).
- **Realtime & poolers:** `LISTEN/NOTIFY` needs a session connection. Supabase's transaction-mode pooler (port 6543) can't `LISTEN`; the app then falls back to polling every ~8–10 s (still works, slightly slower). Serverless functions also can't hold SSE streams forever (platform duration limits); the stream reconnects automatically. For truly instant updates on Vercel, implement Supabase Realtime (broadcast on bid) — *not implemented*.
- **Connection counts:** each serverless instance opens its own pool (`AUCTION_DB_POOL_MAX`, default 10). Use the pooler for request traffic and keep the pool small.
- **Row-level security** is enabled with no policies; the server must connect with the owner/service role. Never ship the Supabase anon key in the browser for this app.

## Plan restrictions and costs to check *before* the event

These change over time — **confirm on the vendors' current pricing/terms pages**:

- **Vercel Hobby (free)** is described by Vercel as for personal, non-commercial use. A church fundraiser may or may not fit; if in doubt, the paid Pro plan is a monthly cost. Free plans also have request, bandwidth and function-duration limits that a 250-person event with live refreshes could approach (the app throttles each phone to one refresh per 1.5 s to help).
- **Supabase Free** projects have historically been paused after about a week of inactivity (wake it up the day before and test), and have connection, storage and bandwidth limits. Realtime-style usage and many simultaneous connections may need a paid plan.
- **Domain:** `*.vercel.app` is free; a custom domain costs money (not purchased).

## Demo data

The seed script refuses to run when `NODE_ENV=production` or when the database holds a non-demo event. Demo rows are marked (`events.is_demo`), the UI shows a yellow DEMO banner, and demo items say "Demo item". Don't point the seed at the production database.
