/**
 * Runs every preset through the real engine (Inlay, via the worker's own
 * runTrace), so a change to the option mapping that breaks a preset fails
 * here rather than in the browser.
 */
import { describe, expect, it } from 'vitest'
import { runTrace } from './run'
import { PRESETS, settingsFor, toTraceOptions, type TraceOptions } from './presets'
import { parseTrace } from '../lib/svg'
import { inksOf } from '../lib/doc'
import { peakPalette } from 'inlaytrace'

/** A 96×64 test card: background, a red disc, a blue bar, a dark outline, and noise. */
function testCard() {
  const w = 96
  const h = 64
  const px = new Uint8ClampedArray(w * h * 4)
  let seed = 7
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % 9) - 4
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c = [246, 242, 234]
      if ((x - 30) ** 2 + (y - 32) ** 2 < 18 ** 2) c = [214, 64, 32]
      if (x > 58 && x < 86 && y > 16 && y < 48) c = [40, 80, 200]
      if (x === 4 || x === 91 || y === 4 || y === 59) c = [20, 18, 16]
      if (x === 3 && y < 4) c = [133, 130, 125] // a few anti-aliased edge pixels (0.1%)
      px.set([c[0] + noise(), c[1] + noise(), c[2] + noise(), 255], (y * w + x) * 4)
    }
  return { px: new Uint8Array(px.buffer), w, h }
}

/** The worker's own entry point; it may flip pixels in place, so it gets a copy. */
const trace = (px: Uint8Array, w: number, h: number, options: TraceOptions) => parseTrace(runTrace(px.slice(), w, h, options))

describe('presets against the real engine', () => {
  const { px, w, h } = testCard()

  for (const preset of PRESETS) {
    it(`${preset.label} produces a usable trace`, () => {
      const t = trace(px, w, h, toTraceOptions(settingsFor(preset.id)))
      expect(t.width).toBe(w)
      expect(t.paths.length).toBeGreaterThan(0)
      const inks = inksOf(t).length
      if (preset.id === 'lineart') expect(inks).toBe(1)
      else expect(inks).toBeLessThanOrEqual(preset.defaults.colors)
    })
  }

  it('line art with light ink traces the light shapes, not the dark background', () => {
    // A light disc on a dark card: dark ink would trace the card around the hole;
    // light ink should trace the disc itself, which is one compact shape.
    const w = 64
    const h = 64
    const card = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = (x - 32) ** 2 + (y - 32) ** 2 < 14 ** 2 ? 240 : 12
        card.set([v, v, v, 255], (y * w + x) * 4)
      }
    const light = { ...settingsFor('lineart'), lightInk: true }
    const opts = toTraceOptions(light)
    expect(opts.invert).toBe(true)
    const t = trace(card, w, h, opts)
    // Every traced shape starts on the disc (x, y ≥ 18), not at the card's corner.
    for (const p of t.paths) {
      const [x, y] = p.d.match(/^M\s*([\d.]+)[ ,]([\d.]+)/)!.slice(1).map(Number)
      expect(Math.min(x, y)).toBeGreaterThan(10)
    }
    // And the control: dark ink on the same card does trace from the corner.
    const dark = trace(card, w, h, toTraceOptions(settingsFor('lineart')))
    const edge = (d: string) => d.match(/^M\s*([\d.]+)[ ,]([\d.]+)/)!.slice(1).map(Number).some((v) => v === 0 || v === w)
    expect(dark.paths.some((p) => edge(p.d))).toBe(true) // starts on the card's edge
    expect(toTraceOptions(settingsFor('lineart')).invert).toBeUndefined()
  })

  it('the colour cap is honoured', () => {
    const s = { ...settingsFor('illustration'), colors: 3 }
    expect(inksOf(trace(px, w, h, toTraceOptions(s))).length).toBeLessThanOrEqual(3)
  })
})

describe('peak palette', () => {
  const { px } = testCard()

  it('returns the flat colours, not their anti-aliased blends', () => {
    const palette = peakPalette(px, 8)
    // Background, red, blue and the dark outline; the grey edge shade is too rare to count.
    expect(palette).toHaveLength(4)
    const near = (hex: string, [r, g, b]: number[]) =>
      Math.abs(parseInt(hex.slice(1, 3), 16) - r) + Math.abs(parseInt(hex.slice(3, 5), 16) - g) + Math.abs(parseInt(hex.slice(5, 7), 16) - b) < 12
    for (const c of [[246, 242, 234], [214, 64, 32], [40, 80, 200], [20, 18, 16]]) expect(palette.some((h) => near(h, c))).toBe(true)
  })

  it('respects the cap, most common first', () => {
    expect(peakPalette(px, 2)).toHaveLength(2)
    expect(peakPalette(px, 2)[0].startsWith('#f')).toBe(true)
  })
})
