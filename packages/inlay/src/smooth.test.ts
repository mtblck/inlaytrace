import { describe, expect, it } from 'vitest'
import { boostLines, smoothShading } from './smooth'

/** A w × h image, each pixel's colour from `f`. */
function image(w: number, h: number, f: (x: number, y: number) => [number, number, number, number?]) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = f(x, y)
      px.set([r, g, b, a], (y * w + x) * 4)
    }
  return px
}

const spread = (px: Uint8ClampedArray, w: number, x0: number, x1: number, y0: number, y1: number) => {
  let lo = 255
  let hi = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      lo = Math.min(lo, px[(y * w + x) * 4])
      hi = Math.max(hi, px[(y * w + x) * 4])
    }
  return hi - lo
}

describe('smoothShading', () => {
  // Skin (light) beside a dark coat, both with ±12 levels of noise.
  const noise = (x: number, y: number) => (((x * 7919 + y * 104729) % 25) - 12)
  const w = 40
  const h = 30
  const src = image(w, h, (x, y) => {
    const v = (x < 20 ? 230 : 40) + noise(x, y)
    return [v, v, v]
  })
  const out = smoothShading(src, w, h)

  it('evens out the noise inside a colour', () => {
    expect(spread(src, w, 4, 16, 4, 26)).toBeGreaterThan(20)
    expect(spread(out, w, 4, 16, 4, 26)).toBeLessThan(8)
  })

  it('keeps the edge between colours sharp', () => {
    for (let y = 4; y < 26; y++) {
      expect(out[(y * w + 19) * 4]).toBeGreaterThan(200)
      expect(out[(y * w + 20) * 4]).toBeLessThan(70)
    }
  })

  it('leaves transparent pixels alone and out of the average', () => {
    const cut = image(10, 10, (x) => (x < 5 ? [200, 100, 50] : [0, 0, 0, 0]))
    const smoothed = smoothShading(cut, 10, 10)
    expect([...smoothed]).toEqual([...cut])
  })
})

describe('boostLines', () => {
  // A dark scene: two near-equal greys (40 and 44) parted by a faint line 2 px wide at 32,
  // with a lone dark speck of the same depth in the left grey.
  const w = 60
  const h = 40
  const src = image(w, h, (x, y) => {
    const v = x === 29 || x === 30 ? 32 : x < 29 ? 40 : 44
    const speck = x >= 10 && x <= 11 && y >= 10 && y <= 11
    return speck ? [32, 32, 32] : [v, v, v]
  })
  const out = boostLines(src, w, h, 2)

  it('darkens a faint line that runs a long way, keeping its sides', () => {
    expect(out[(20 * w + 29) * 4]).toBeLessThan(20)
    expect(out[(20 * w + 20) * 4]).toBe(40)
    expect(out[(20 * w + 40) * 4]).toBe(44)
  })

  it('leaves short dark marks alone: texture, not lines', () => {
    expect(out[(10 * w + 10) * 4]).toBe(32)
  })

  it('darkens a strong line only a little, so it keeps its colour', () => {
    const brow = image(w, h, (x) => (x === 29 || x === 30 ? [140, 90, 58] : [243, 214, 164]))
    const r = boostLines(brow, w, h, 2)[(20 * w + 29) * 4]
    expect(r).toBeGreaterThan(90)
    expect(r).toBeLessThan(140)
  })
})
