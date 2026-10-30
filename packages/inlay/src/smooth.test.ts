import { describe, expect, it } from 'vitest'
import { smoothShading } from './smooth'

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
