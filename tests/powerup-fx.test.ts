import { describe, expect, it } from 'vitest'
import { POWERUP_FX, powerupFx } from '@/lib/powerup-fx'

describe('Power-Up screen effects', () => {
  it('has an effect for every Power-Up that can be played, and none for other announcements', () => {
    for (const code of ['resurrection', 'final_call', 'knockout', 'block', 'back_in']) expect(powerupFx(`powerup.${code}`), code).not.toBeNull()
    expect(powerupFx('item.sold')).toBeNull()
    expect(powerupFx('room.jackpot.winner')).toBeNull()
  })

  it('gives each one its own colour, icon and sound, with sensible notes', () => {
    const all = Object.values(POWERUP_FX)
    expect(new Set(all.map((f) => f.accent)).size).toBe(all.length)
    expect(new Set(all.map((f) => f.icon)).size).toBe(all.length)
    expect(new Set(all.map((f) => JSON.stringify(f.sound))).size).toBe(all.length)
    for (const f of all) {
      expect(f.ms).toBeGreaterThanOrEqual(5500) // stays up at least as long as the plain overlay
      for (const n of f.sound) {
        expect(n.f).toBeGreaterThan(20)
        expect(n.ms).toBeGreaterThan(0)
        expect(n.at).toBeGreaterThanOrEqual(0)
        expect(n.at + n.ms).toBeLessThan(f.ms) // the sound is over before the overlay is
        expect(n.vol ?? 0.1).toBeLessThanOrEqual(0.4)
      }
    }
  })
})
