/**
 * Commercial breaks the host can play on the projector. Each is a YouTube video shown full-screen in a retro TV frame,
 * with a banner promoting an item. `promote` is a piece of that item's TITLE (not its number, which can change); it is looked up
 * when the commercial is played, and the host can still pick a different item. `autoOnStart` plays the clip automatically when
 * the host starts that LIVE item, and bidding opens when the clip ends (see commercial-start.ts).
 * `seconds` is the video's exact length. The projector ends the break the instant the video really finishes (YouTube tells the
 * page), so a slow-loading video — or one that starts with an ad — isn't cut short. GRACE_MS is only the outer limit for how long
 * the server keeps reporting a break past `seconds`.
 * The projector needs internet to play it.
 */
export type Commercial = { key: string; title: string; youtubeId: string; seconds: number; tagline: string; promote?: string; autoOnStart?: boolean }

export const COMMERCIALS: Commercial[] = [
  { key: 'ihop-passport', title: 'IHOP International Passport Breakfast', youtubeId: 'iawBwfVtopA', seconds: 30.9, tagline: 'A word from our sponsors…', promote: 'IHOP' },
  { key: 'chickfila-honest-1', title: 'If Chick-fil-A Commercials Were Honest (pt 1) — for the 2nd package', youtubeId: 'fwi1rMr9oko', seconds: 30, tagline: 'A word from our sponsors…', promote: 'Sandwiches (2 of 2)' },
  { key: 'chickfila-honest', title: 'If Chick-fil-A Commercials Were Honest (pt 2) — for the 1st package', youtubeId: 'LXdxNhv4eXw', seconds: 30, tagline: 'A word from our sponsors…', promote: 'Sandwiches (1 of 2)' },
  { key: 'royal-gorge', title: 'The Royal Gorge Route Railroad Experience', youtubeId: 'eeQusf7Gp0E', seconds: 30, tagline: 'A word from our sponsors…', promote: 'Royal Gorge Train', autoOnStart: true },
  { key: 'broadmoor', title: 'The Broadmoor Hotel: Legendary. Historic. Timeless.', youtubeId: 'KLWjfvweSA4', seconds: 30.2, tagline: 'A word from our sponsors…', promote: 'Broadmoor Stay', autoOnStart: true },
]

/** How long past `seconds` a break may stay up while waiting for the video to report that it finished. */
export const GRACE_MS = 45_000

export const commercialByKey = (key: string | null | undefined) => COMMERCIALS.find((c) => c.key === key) ?? null
