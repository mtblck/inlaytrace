import { describe, expect, it } from 'vitest'
import { edgeBlur, sharpenEdges } from './sharpen'

/** Erf, near enough (Abramowitz–Stegun 7.1.26), for drawing Gaussian-blurred edges. */
function erf(x: number) {
  const s = Math.sign(x)
  x = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * x)
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x))
}

/** How much of a hard edge at `at` a pixel centred on `x` covers, after a Gaussian blur of `sigma` (0 for none: pixel coverage). */
const cover = (x: number, at: number, sigma: number) => (sigma ? 0.5 * (1 + erf((x - at) / (sigma * Math.SQRT2))) : Math.min(1, Math.max(0, x + 0.5 - at)))

/**
 * A w × h image: navy paper (40, 40, 70) with a light grey (220, 220, 230)
 * rectangle from x0 to x1 and, if `line`, a 3 px light line on the paper at
 * x 60, all blurred by `sigma`, with a little grain.
 */
function art(sigma: number, { w = 96, h = 40, x0 = 20.5, x1 = 44.5, line = true } = {}) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const box = cover(x, x0, sigma) - cover(x, x1, sigma)
      const stripe = line ? cover(x, 58.5, sigma) - cover(x, 61.5, sigma) : 0
      const k = Math.min(1, box + stripe)
      const grain = ((x * 7919 + y * 104729) % 7) - 3
      px.set([40 + 180 * k + grain, 40 + 180 * k + grain, 70 + 160 * k + grain, 255], (y * w + x) * 4)
    }
  return px
}

const row = (px: Uint8ClampedArray, w: number, y: number) => Array.from({ length: w }, (_, x) => px[(y * w + x) * 4]!)

describe('edgeBlur', () => {
  it('reads crisp art as under a pixel, and blurred art as about its blur', () => {
    expect(edgeBlur(art(0), 96, 40)).toBeLessThan(1)
    expect(edgeBlur(art(2), 96, 40)).toBeGreaterThan(1.6)
    expect(edgeBlur(art(2), 96, 40)).toBeLessThan(2.6)
    expect(edgeBlur(art(3), 96, 40)).toBeGreaterThan(edgeBlur(art(2), 96, 40))
  })

  it('is 0 for an image without edges', () => {
    expect(edgeBlur(new Uint8ClampedArray(20 * 20 * 4).fill(200), 20, 20)).toBe(0)
  })
})

describe('sharpenEdges', () => {
  const w = 96
  const h = 40

  it('copies crisp art unchanged', () => {
    const crisp = art(0)
    expect([...sharpenEdges(crisp, w, h)]).toEqual([...crisp])
  })

  it('turns a blurred edge back into a step, with no colour of its own between', () => {
    const before = row(art(2.5), w, 20)
    const after = row(sharpenEdges(art(2.5), w, h), w, 20)
    // Pixels partway (more than 30 levels from both navy and grey) across the box's left edge.
    const between = (r: number[]) => r.slice(10, 32).filter((v) => v > 70 && v < 190).length
    expect(between(before)).toBeGreaterThanOrEqual(4)
    expect(between(after)).toBeLessThanOrEqual(1)
    // The step stays where the edge was.
    expect(after[18]).toBeLessThan(70)
    expect(after[23]).toBeGreaterThan(190)
  })

  it('keeps a thin line, as one flat band where it was', () => {
    // Blurred, the 3 px line is a bump peaking at about half its contrast; the peak isn't worn down.
    const after = row(sharpenEdges(art(2.5), w, h), w, 20)
    const band = after.slice(57, 63)
    expect(Math.min(...band)).toBeGreaterThan(95)
    expect(Math.max(...band) - Math.min(...band)).toBeLessThan(6)
    // Paper on both sides of it.
    expect(after[53]).toBeLessThan(60)
    expect(after[67]).toBeLessThan(60)
  })

  it('never darkens an edge with the black under transparency', () => {
    // Cut out through the box's blurred left edge: canvases keep RGB 0 under alpha 0.
    const px = art(2.5)
    for (let y = 0; y < h; y++) for (let x = 0; x < 20; x++) px.set([0, 0, 0, 0], (y * w + x) * 4)
    const out = sharpenEdges(px, w, h, 2.5)
    // Every opaque pixel ends as the paper or the box (or between), never darker than the paper.
    for (let y = 2; y < h - 2; y++) for (let x = 20; x < 30; x++) expect(out[(y * w + x) * 4]).toBeGreaterThan(36)
  })

  it('takes an enlarged image as softer by its scale', () => {
    // Blur 2.5 is soft at its own size, but 2× enlarging alone would soften crisp art that much.
    const px = art(2.5)
    expect([...sharpenEdges(px, w, h, 2.5, 2)]).toEqual([...px])
    expect([...sharpenEdges(px, w, h, 2.5, 1)]).not.toEqual([...px])
  })

  it('leaves transparent pixels alone', () => {
    const px = art(2.5)
    for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) px[(y * w + x) * 4 + 3] = 0
    const out = sharpenEdges(px, w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < 8; x++) expect([...out.slice((y * w + x) * 4, (y * w + x) * 4 + 4)]).toEqual([...px.slice((y * w + x) * 4, (y * w + x) * 4 + 4)])
  })
})
