/**
 * Commercial breaks the host can play on the projector. Each is a YouTube video shown full-screen in a retro TV frame,
 * with a banner promoting a silent item the host picks at play time (item numbers can change, so they aren't stored here).
 * `seconds` is how long the takeover stays up — the video's length plus a moment. The projector needs internet to play it.
 */
export type Commercial = { key: string; title: string; youtubeId: string; seconds: number; tagline: string }

export const COMMERCIALS: Commercial[] = [
  { key: 'ihop-passport', title: 'IHOP International Passport Breakfast', youtubeId: 'iawBwfVtopA', seconds: 33, tagline: 'A word from our sponsors…' },
]

export const commercialByKey = (key: string | null | undefined) => COMMERCIALS.find((c) => c.key === key) ?? null
