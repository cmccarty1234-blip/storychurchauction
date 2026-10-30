/**
 * What the projector shows and plays when a Power-Up is used: a colour, an icon, a motion and a short synthesized sound for each one.
 * (Pure data, so it can be tested; projector.tsx draws it.) A kind that isn't listed here falls back to the plain yellow overlay.
 */
export type Note = { f: number; at: number; ms: number; type?: OscillatorType; vol?: number; to?: number }

export type PowerUpFx = {
  icon: string
  tag: string
  /** Text colour of the headline and the glow / background tint. */
  accent: string
  tint: string
  /** Class on the headline: how it arrives. */
  motion: string
  /** Class on the whole overlay (a shake, say). */
  shake: boolean
  /** Background layer: glyphs drifting up, or rings expanding from the middle. */
  layer: { kind: 'up' | 'rings'; glyph?: string; count: number }
  flash: boolean
  /** Slowly turning rays of light behind everything. */
  rays?: boolean
  /** A recorded sound in /public (played instead of the synthesized one). If it can't be played, the synthesized sound is used. */
  file?: string
  sound: Note[]
  /** How long it stays up, in ms. */
  ms: number
}

export const POWERUP_FX: Record<string, PowerUpFx> = {
  'powerup.resurrection': {
    file: '/sounds/resurrection.mp3',
    icon: '✝️', tag: 'POWER-UP · RESURRECTION', accent: '#fde68a', tint: 'rgba(250,204,21,0.3)', motion: 'sc-pop', shake: false, rays: true,
    layer: { kind: 'up', glyph: '✦', count: 26 }, flash: false, ms: 7000,
    // A soft choir-like swell (a C major chord building up), then bright bells on top.
    sound: [
      { f: 131, at: 0, ms: 3200, type: 'sine', vol: 0.1 }, { f: 262, at: 150, ms: 3000, type: 'triangle', vol: 0.07 },
      { f: 330, at: 450, ms: 2800, type: 'triangle', vol: 0.07 }, { f: 392, at: 750, ms: 2600, type: 'triangle', vol: 0.07 },
      { f: 523, at: 1050, ms: 2400, type: 'sine', vol: 0.08 },
      { f: 1047, at: 1500, ms: 900, type: 'sine', vol: 0.1 }, { f: 1319, at: 1800, ms: 900, type: 'sine', vol: 0.1 },
      { f: 1568, at: 2100, ms: 1400, type: 'sine', vol: 0.1 }, { f: 2093, at: 2300, ms: 1600, type: 'sine', vol: 0.05 },
    ],
  },
  'powerup.final_call': {
    icon: '🔔', tag: 'POWER-UP · FINAL CALL', accent: '#fb923c', tint: 'rgba(249,115,22,0.3)', motion: 'sc-pulse', shake: false,
    layer: { kind: 'rings', count: 4 }, flash: false, ms: 6000,
    sound: [0, 340, 680].flatMap((at) => [
      { f: 1568, at, ms: 700, type: 'triangle' as OscillatorType, vol: 0.16 },
      { f: 2349, at, ms: 500, type: 'sine' as OscillatorType, vol: 0.05 },
    ]),
  },
  'powerup.knockout': {
    icon: '🥊', tag: 'POWER-UP · KNOCKOUT', accent: '#f87171', tint: 'rgba(220,38,38,0.35)', motion: 'sc-slam', shake: true,
    layer: { kind: 'rings', count: 3 }, flash: true, ms: 6500,
    sound: [
      { f: 140, at: 0, ms: 450, type: 'sine', to: 40, vol: 0.4 },
      { f: 220, at: 0, ms: 260, type: 'square', to: 60, vol: 0.12 },
      { f: 90, at: 20, ms: 520, type: 'sawtooth', to: 30, vol: 0.12 },
      { f: 1568, at: 460, ms: 600, type: 'triangle', vol: 0.12 },
      { f: 1976, at: 620, ms: 700, type: 'triangle', vol: 0.12 },
    ],
  },
  'powerup.block': {
    icon: '🛑', tag: 'POWER-UP · BLOCK', accent: '#c084fc', tint: 'rgba(147,51,234,0.32)', motion: 'sc-shake', shake: false,
    layer: { kind: 'up', glyph: '✕', count: 18 }, flash: false, ms: 6000,
    sound: [
      { f: 392, at: 0, ms: 260, type: 'sawtooth', vol: 0.1 }, { f: 311, at: 290, ms: 260, type: 'sawtooth', vol: 0.1 },
      { f: 233, at: 580, ms: 520, type: 'sawtooth', vol: 0.1 }, { f: 80, at: 0, ms: 800, type: 'square', vol: 0.07 },
    ],
  },
  'powerup.back_in': {
    icon: '⚡', tag: 'POWER-UP · BACK-IN', accent: '#22d3ee', tint: 'rgba(6,182,212,0.3)', motion: 'sc-bounce-in', shake: false,
    layer: { kind: 'up', glyph: '⚡', count: 20 }, flash: false, ms: 6000,
    sound: [
      { f: 250, at: 0, ms: 450, type: 'sine', to: 1400, vol: 0.1 },
      { f: 784, at: 440, ms: 220, type: 'triangle' }, { f: 1047, at: 580, ms: 400, type: 'triangle' }, { f: 1319, at: 700, ms: 600, type: 'triangle' },
    ],
  },
}

export const powerupFx = (kind: string): PowerUpFx | null => POWERUP_FX[kind] ?? null
