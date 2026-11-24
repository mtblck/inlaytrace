import { describe, expect, it } from 'vitest'
import { deblur, edgeBlur } from './deblur'
import { trace } from './presets'

/** Erf, near enough (Abramowitz–Stegun 7.1.26), for drawing Gaussian-blurred edges. */
function erf(x: number) {
  const s = Math.sign(x)
  x = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * x)
  return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x))
}

/** How much of a hard edge at `at` a pixel centred on `x` covers, after a Gaussian blur of `sigma` (0 for none: pixel coverage). */
const cover = (x: number, at: number, sigma: number) => (sigma ? 0.5 * (1 + erf((x - at) / (sigma * Math.SQRT2))) : Math.min(1, Math.max(0, x + 0.5 - at)))

const toLight = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
const toStored = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

const NAVY = [40, 40, 70] as const
const PALE = [220, 220, 230] as const
const GREY = [130, 130, 150] as const
const W = 160
const H = 96

/**
 * Navy paper with a pale box from x 20.5 to 60.5, a 3 px pale line at x 78
 * and a mid-grey block from x 104.5 to the right edge, all blurred by `sigma`
 * with a little grain. The grey is what a pale-navy ramp passes through: the
 * colour a halo would be drawn in. `light` blurs as a lens does, in linear
 * light; otherwise the stored values are blurred, as a resize does. `redShift`
 * moves the red channel sideways, as a lens's colour fringe.
 */
function art(sigma: number, { light = false, redShift = 0 } = {}) {
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const grain = ((x * 7919 + y * 104729) % 5) - 2
      for (let c = 0; c < 3; c++) {
        const xx = c === 0 ? x - redShift : x
        const pale = Math.min(1, cover(xx, 20.5, sigma) - cover(xx, 60.5, sigma) + cover(xx, 76.5, sigma) - cover(xx, 79.5, sigma))
        const grey = cover(xx, 104.5, sigma)
        const mix = (a: number, b: number, k: number) => (light ? toStored(toLight(a) + (toLight(b) - toLight(a)) * k) : a + (b - a) * k)
        px[(y * W + x) * 4 + c] = mix(mix(NAVY[c]!, PALE[c]!, pale), GREY[c]!, grey) + grain
      }
      px[(y * W + x) * 4 + 3] = 255
    }
  return px
}

const row = (px: Uint8ClampedArray, y: number, c = 0) => Array.from({ length: W }, (_, x) => px[(y * W + x) * 4 + c]!)
/** Where a row first climbs past halfway from navy to pale, between pixels. */
const crossing = (r: number[], from: number) => {
  const mid = (NAVY[0] + PALE[0]) / 2
  let x = from
  while (r[x + 1]! < mid) x++
  return x + (mid - r[x]!) / (r[x + 1]! - r[x]!) + 0.5
}

describe('edgeBlur', () => {
  it('reads crisp art as under a pixel, and blurred art as about its blur', () => {
    expect(edgeBlur(art(0), W, H)).toBeLessThan(1)
    expect(edgeBlur(art(2), W, H)).toBeGreaterThan(1.6)
    expect(edgeBlur(art(2), W, H)).toBeLessThan(2.6)
    expect(edgeBlur(art(3), W, H)).toBeGreaterThan(edgeBlur(art(2), W, H))
  })

  it('is 0 for an image without edges', () => {
    expect(edgeBlur(new Uint8ClampedArray(20 * 20 * 4).fill(200), 20, 20)).toBe(0)
  })
})

describe('deblur', () => {
  it('copies crisp art unchanged', () => {
    const crisp = art(0)
    expect([...deblur(crisp, W, H)]).toEqual([...crisp])
  })

  it('turns a blurred edge back into a step, with no halo of the colour between', () => {
    const before = row(art(2.5), 24)
    const after = row(deblur(art(2.5), W, H), 24)
    // Pixels across the box's left edge that are nearer the grey than the navy or the pale.
    const halo = (r: number[]) => r.slice(10, 32).filter((v) => v > 85 && v < 175).length
    expect(halo(before)).toBeGreaterThanOrEqual(3)
    expect(halo(after)).toBeLessThanOrEqual(1)
    // The step stays where the edge was.
    expect(Math.abs(crossing(after, 10) - 20.5)).toBeLessThan(1)
    // And the grey block is still grey, flat to its edge.
    expect(after.slice(108, W).every((v) => Math.abs(v - GREY[0]) < 8)).toBe(true)
  })

  it('makes every area one flat colour', () => {
    const out = deblur(art(2.5), W, H)
    const seen = new Set<number>()
    for (let y = 4; y < H - 4; y++) for (const x of [8, 40, 68, 90, 130]) seen.add(out[(y * W + x) * 4]!)
    // Navy, pale and grey, each a single value: the grain is gone.
    expect(seen.size).toBe(3)
  })

  it('keeps a thin line, as one flat band where it was', () => {
    // Blurred, the 3 px line is a bump peaking at about half its contrast: a grey line, to a labeller.
    const after = row(deblur(art(2.5), W, H), 24)
    expect(Math.min(...after.slice(77, 80))).toBeGreaterThan(190)
    // Paper on both sides of it.
    expect(after[72]).toBeLessThan(60)
    expect(after[84]).toBeLessThan(60)
  })

  it('puts an edge back where it was, whichever way it was blurred', () => {
    // Blurred as light, white outweighs navy: the stored ramp's middle sits well inside the navy.
    const lens = art(3, { light: true })
    expect(crossing(row(lens, 24), 10)).toBeLessThan(19.4)
    expect(Math.abs(crossing(row(deblur(lens, W, H), 24), 10) - 20.5)).toBeLessThan(1)
    // Blurred as stored, it sits on the edge already.
    expect(Math.abs(crossing(row(deblur(art(3), W, H), 24), 10) - 20.5)).toBeLessThan(1)
  })

  it('takes out a colour fringe', () => {
    // Red 2 px to the right: every pale edge has a cyan rim on one side and a red one on the other.
    const fringed = art(2.5, { redShift: 2 })
    const rim = (px: Uint8ClampedArray) => {
      let most = 0
      for (let x = 10; x < 95; x++) most = Math.max(most, Math.abs(px[(24 * W + x) * 4]! - px[(24 * W + x) * 4 + 1]!))
      return most
    }
    expect(rim(fringed)).toBeGreaterThan(40)
    expect(rim(deblur(fringed, W, H))).toBeLessThan(8)
  })

  it('never darkens an edge with the black under transparency', () => {
    // Cut out through the box's blurred left edge: canvases keep RGB 0 under alpha 0.
    const px = art(2.5)
    for (let y = 0; y < H; y++) for (let x = 0; x < 20; x++) px.set([0, 0, 0, 0], (y * W + x) * 4)
    const out = deblur(px, W, H, 2.5)
    for (let y = 2; y < H - 2; y++) for (let x = 20; x < 30; x++) expect(out[(y * W + x) * 4]).toBeGreaterThan(36)
  })

  it('takes an enlarged image as softer by its scale', () => {
    // Blur 2.5 is soft at its own size, but 2× enlarging alone would soften crisp art that much.
    const px = art(2.5)
    expect([...deblur(px, W, H, 2.5, 2)]).toEqual([...px])
    expect([...deblur(px, W, H, 2.5, 1)]).not.toEqual([...px])
  })

  it('leaves alpha alone', () => {
    const px = art(2.5)
    for (let y = 0; y < H; y++) for (let x = 0; x < 8; x++) px[(y * W + x) * 4 + 3] = 0
    const out = deblur(px, W, H)
    for (let p = 0; p < W * H; p++) expect(out[p * 4 + 3]).toBe(px[p * 4 + 3])
  })

  it('leaves alone an image it finds no flat colours in', () => {
    // A soft gradient with one blurred edge: nothing to solve for.
    const px = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set([x * 2, x * 2, x * 2, 255], (y * W + x) * 4)
    expect([...deblur(px, W, H, 3)]).toEqual([...px])
  })
})

describe('trace, with deblur', () => {
  it('draws blurred art as the shapes crisp art has, without the bands between', () => {
    const shapes = (sigma: number, deblur: boolean) => trace({ data: art(sigma), width: W, height: H }, { preset: 'logo', deblur }).paths.length
    // Box, line and block, and the paper in three parts between them.
    expect(shapes(0, false)).toBe(6)
    expect(shapes(2.5, false)).toBeGreaterThan(6)
    expect(shapes(2.5, true)).toBe(6)
  })

  it('leaves pixel art alone', () => {
    const image = { data: art(2.5), width: W, height: H }
    expect(trace(image, { preset: 'pixel', deblur: true }).paths).toEqual(trace(image, { preset: 'pixel' }).paths)
  })
})
