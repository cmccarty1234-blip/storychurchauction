/**
 * Commercial breaks the host can play on the projector. Each is a YouTube video shown full-screen in a retro TV frame,
 * with a banner promoting an item. `promote` is a piece of that item's TITLE (not its number, which can change); it is looked up
 * when the commercial is played, and the host can still pick a different item. `autoOnStart` plays the clip automatically when
 * the host starts that LIVE item, and bidding opens when the clip ends (see commercial-start.ts).
 * `seconds` is how long the takeover stays up — the video's length plus a moment. The projector needs internet to play it.
 */
export type Commercial = { key: string; title: string; youtubeId: string; seconds: number; tagline: string; promote?: string; autoOnStart?: boolean }

export const COMMERCIALS: Commercial[] = [
  { key: 'ihop-passport', title: 'IHOP International Passport Breakfast', youtubeId: 'iawBwfVtopA', seconds: 33, tagline: 'A word from our sponsors…', promote: 'IHOP' },
  { key: 'chickfila-honest-1', title: 'If Chick-fil-A Commercials Were Honest (pt 1) — for the 2nd package', youtubeId: 'fwi1rMr9oko', seconds: 32, tagline: 'A word from our sponsors…', promote: 'Sandwiches (2 of 2)' },
  { key: 'chickfila-honest', title: 'If Chick-fil-A Commercials Were Honest (pt 2) — for the 1st package', youtubeId: 'LXdxNhv4eXw', seconds: 32, tagline: 'A word from our sponsors…', promote: 'Sandwiches (1 of 2)' },
  { key: 'broadmoor', title: 'The Broadmoor Hotel: Legendary. Historic. Timeless.', youtubeId: 'KLWjfvweSA4', seconds: 32, tagline: 'A word from our sponsors…', promote: 'Broadmoor Stay', autoOnStart: true },
]

export const commercialByKey = (key: string | null | undefined) => COMMERCIALS.find((c) => c.key === key) ?? null
