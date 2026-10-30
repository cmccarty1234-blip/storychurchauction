/**
 * Commercial breaks the host can play on the projector. Each is a YouTube video shown full-screen in a retro TV frame,
 * with a banner promoting an item. `promote` is a piece of that item's TITLE (not its number, which can change); it is looked up
 * when the commercial is played, and the host can still pick a different item. `autoOnStart` plays the clip automatically when
 * the host starts that LIVE item, and bidding opens when the clip ends (see commercial-start.ts).
 * `seconds` is the video's exact length. The projector ends the break the instant the video really finishes (YouTube tells the
 * page), so a slow-loading video — or one that starts with an ad — isn't cut short. GRACE_MS is only the outer limit for how long
 * the server keeps reporting a break past `seconds`.
 * `fixed` means the break is deliberately not the video's length (IHOP: 30 s video, 35 s break; the long clips are cut to their first
 * 15 s), so the projector ends it at `seconds` and stops the video there (`end=`); `startAt` is the second it begins from, instead of waiting for the video to report it finished.
 * The projector needs internet to play it.
 */
export type Commercial = { key: string; title: string; youtubeId: string; seconds: number; tagline: string; promote?: string; autoOnStart?: boolean; fixed?: boolean; startAt?: number }

export const COMMERCIALS: Commercial[] = [
  { key: 'ihop-passport', title: 'IHOP International Passport Breakfast', youtubeId: 'iawBwfVtopA', seconds: 35, tagline: 'A word from our sponsors…', promote: 'IHOP', fixed: true },
  { key: 'chickfila-honest-1', title: 'If Chick-fil-A Commercials Were Honest (pt 1) — for the 2nd package', youtubeId: 'fwi1rMr9oko', seconds: 30, tagline: 'A word from our sponsors…', promote: 'Sandwiches (2 of 2)' },
  { key: 'chickfila-honest', title: 'If Chick-fil-A Commercials Were Honest (pt 2) — for the 1st package', youtubeId: 'LXdxNhv4eXw', seconds: 30, tagline: 'A word from our sponsors…', promote: 'Sandwiches (1 of 2)' },
  { key: 'royal-gorge', title: 'The Royal Gorge Route Railroad Experience', youtubeId: 'eeQusf7Gp0E', seconds: 30, tagline: 'A word from our sponsors…', promote: 'Royal Gorge Train', autoOnStart: true },
  { key: 'mercyme', title: 'MercyMe — Coming November 5, 2026 (Broadmoor World Arena)', youtubeId: 'OG7-gbbOj8I', seconds: 30.4, tagline: 'A word from our sponsors…', promote: 'Mercy Me', autoOnStart: true },
  { key: 'horseback', title: 'Colorado Horseback Riding & Hot Springs Vacation', youtubeId: 'zQiW-GrNvQI', seconds: 15, tagline: 'A word from our sponsors…', promote: 'Horseback', autoOnStart: true, fixed: true },
  { key: 'fallen-heroes', title: 'Fallen Heroes Tattoo & Piercing', youtubeId: '7HfCnUoZApY', seconds: 15, tagline: 'A word from our sponsors…', promote: 'Fallen Heroes', autoOnStart: true, fixed: true },
  { key: 'peppertree', title: 'Peppertree Restaurant — Loving Living Local (FOX21)', youtubeId: 'IfczFda3wFg', seconds: 50, startAt: 6, tagline: 'A word from our sponsors…', promote: 'Peppertree', autoOnStart: true, fixed: true },
  { key: 'overdrive', title: 'Overdrive Raceway — 45MPH Karts in Colorado Springs', youtubeId: 'ghjuJzkiALg', seconds: 40, tagline: 'A word from our sponsors…', promote: 'Overdrive', autoOnStart: true, fixed: true },
  { key: 'broadmoor', title: 'The Broadmoor Hotel: Legendary. Historic. Timeless.', youtubeId: 'KLWjfvweSA4', seconds: 30.2, tagline: 'A word from our sponsors…', promote: 'Broadmoor Stay', autoOnStart: true },
]

/**
 * The built-in spot every LIVE item gets when it has no YouTube clip of its own (see autoCommercialFor): the item's photo, name,
 * donor and starting bid in the retro TV frame. It has no video (`youtubeId` is empty), so the projector ends it exactly at `seconds`.
 * It is not in COMMERCIALS, so it isn't offered in the host's list.
 */
export const HOUSE_COMMERCIAL: Commercial = { key: 'house', title: 'Up next on the block', youtubeId: '', seconds: 12, tagline: 'Brought to you by our generous neighbors…' }

/** How long past `seconds` a break may stay up while waiting for the video to report that it finished. */
export const GRACE_MS = 45_000

export const commercialByKey = (key: string | null | undefined) => [...COMMERCIALS, HOUSE_COMMERCIAL].find((c) => c.key === key) ?? null
