import { describe, expect, it } from 'vitest'
import { deblur, edgeBlur } from './deblur'
import { trace, traceAsync } from './presets'

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

/** Side of the picture `tilted` draws, the half-width of its square, and the square's turn (radians). */
const S = 128
const HALF = 34
const TILT = 0.35

/** Navy paper with a pale square turned by TILT about the middle, blurred by `sigma`, with random grain: no edge runs along the pixels. */
function tilted(sigma: number) {
  const px = new Uint8ClampedArray(S * S * 4)
  const c = Math.cos(TILT)
  const s = Math.sin(TILT)
  let seed = 7
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      // A blur is the same along any pair of axes, so along the square's own it is one blurred bar times another.
      const u = (x - 63.5) * c + (y - 63.5) * s
      const v = -(x - 63.5) * s + (y - 63.5) * c
      const k = (cover(u, -HALF, sigma) - cover(u, HALF, sigma)) * (cover(v, -HALF, sigma) - cover(v, HALF, sigma))
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      const grain = ((seed >>> 16) % 7) - 3
      for (let ch = 0; ch < 3; ch++) px[(y * S + x) * 4 + ch] = NAVY[ch]! + (PALE[ch]! - NAVY[ch]!) * k + grain
      px[(y * S + x) * 4 + 3] = 255
    }
  return px
}

/** Radius of the disc `disc` draws. */
const RADIUS = 40

/** Navy paper with a pale disc about the middle, blurred by `sigma` (near enough: the edge's own blur, which is all a disc this size shows), with random grain. */
function disc(sigma: number) {
  const px = new Uint8ClampedArray(S * S * 4)
  let seed = 11
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const k = 1 - cover(Math.hypot(x - 63.5, y - 63.5), RADIUS, sigma)
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      const grain = ((seed >>> 16) % 7) - 3
      for (let ch = 0; ch < 3; ch++) px[(y * S + x) * 4 + ch] = NAVY[ch]! + (PALE[ch]! - NAVY[ch]!) * k + grain
      px[(y * S + x) * 4 + 3] = 255
    }
  return px
}

/** How far from the middle of `tilted`'s picture, going out from (ox, oy) off it along (dx, dy), red falls halfway from pale to navy. */
function reach(px: Uint8ClampedArray, ox: number, oy: number, dx: number, dy: number, from: number) {
  const red = (x: number, y: number) => {
    const x0 = Math.floor(x - 0.5)
    const y0 = Math.floor(y - 0.5)
    const fx = x - 0.5 - x0
    const fy = y - 0.5 - y0
    const at = (xx: number, yy: number) => px[(yy * S + xx) * 4]!
    return at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) + at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
  }
  for (let r = from; r < from + 20; r += 0.05) if (red(64 + ox + r * dx, 64 + oy + r * dy) < (NAVY[0] + PALE[0]) / 2) return r
  return NaN
}

describe('deblur, on edges off the pixel grid', () => {
  const out = deblur(tilted(2.5), S, S)
  const c = Math.cos(TILT)
  const s = Math.sin(TILT)

  it('draws a slanted edge as a straight line where it was', () => {
    // Along each side, short of its corners: nowhere further than half a pixel or so from the true edge. The grain alone ripples a labelled edge by more.
    for (const [nx, ny] of [[c, s], [-s, c], [-c, -s], [s, -c]] as const)
      for (let t = -24; t <= 24; t += 2) expect(Math.abs(reach(out, -ny * t, nx * t, nx, ny, HALF - 8) - HALF)).toBeLessThan(0.6)
  })

  it('runs a straight side straight to its corners', () => {
    // To within 4 px of each corner: smoothing alone bends the last few pixels of a side in towards the corner it rounds, by half a pixel.
    for (const [nx, ny] of [[c, s], [-s, c], [-c, -s], [s, -c]] as const)
      for (let t = -30; t <= 30; t += 2) expect(Math.abs(reach(out, -ny * t, nx * t, nx, ny, HALF - 8) - HALF)).toBeLessThan(0.3)
  })

  it('leaves a round edge round', () => {
    // No stretch of a circle this size is a line: drawn as chords, it would sit half a pixel and more off its arc.
    const round = deblur(disc(2.5), S, S)
    for (let i = 0; i < 48; i++) {
      const a = (i * Math.PI) / 24
      expect(Math.abs(reach(round, 0, 0, Math.cos(a), Math.sin(a), RADIUS - 8) - RADIUS)).toBeLessThan(0.35)
    }
  })

  it('keeps a corner a corner', () => {
    // Out along each diagonal: the search alone rounds a corner off by a pixel and a half of the 48 to its point.
    for (const [dx, dy] of [[c - s, s + c], [-s - c, c - s], [s - c, -s - c], [s + c, s - c]] as const) {
      const off = reach(out, 0, 0, dx / Math.SQRT2, dy / Math.SQRT2, HALF) - HALF * Math.SQRT2
      expect(off).toBeGreaterThan(-1)
      expect(off).toBeLessThan(0.5)
    }
  })
})

describe('deblur, on a large image', () => {
  it('keeps a thin line that the work scale leaves a pixel wide', () => {
    // Over 420,000 pixels, so solved at half size, where this 2 px line is one pixel of the grey it fades to: as thin as the slivers that are given away, but with one colour all round it is no gap between shapes.
    const BW = 900
    const BH = 480
    const px = new Uint8ClampedArray(BW * BH * 4)
    let seed = 5
    for (let y = 0; y < BH; y++) {
      const tall = cover(y, 100.5, 1.8) - cover(y, BH - 100.5, 1.8)
      for (let x = 0; x < BW; x++) {
        const pale = Math.min(1, cover(x, 100.5, 1.8) - cover(x, 300.5, 1.8) + (cover(x, 400.5, 1.8) - cover(x, 402.5, 1.8)) * tall)
        const grey = cover(x, 600.5, 1.8)
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        const grain = ((seed >>> 16) % 7) - 3
        for (let c = 0; c < 3; c++) {
          const v = NAVY[c]! + (PALE[c]! - NAVY[c]!) * pale
          px[(y * BW + x) * 4 + c] = v + (GREY[c]! - v) * grey + grain
        }
        px[(y * BW + x) * 4 + 3] = 255
      }
    }
    const out = deblur(px, BW, BH)
    const at = (x: number) => out[(240 * BW + x) * 4]!
    // The line is there, if in the grey, with paper either side.
    expect(Math.max(at(400), at(401), at(402))).toBeGreaterThan(110)
    expect(at(392)).toBeLessThan(60)
    expect(at(410)).toBeLessThan(60)
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

  it('pauses while it deblurs, so an async trace reports it and can be stopped there', async () => {
    // Not the picture above: the last deblurred image is remembered, and answers without a deblur stage.
    const image = { data: art(3), width: W, height: H }
    const controller = new AbortController()
    const seen: string[] = []
    const stopped = traceAsync(image, {
      preset: 'logo',
      deblur: true,
      signal: controller.signal,
      onProgress: (s) => {
        seen.push(s.stage)
        if (s.stage === 'deblur' && s.done > 0) controller.abort(new Error('stop'))
      },
    })
    await expect(stopped).rejects.toThrow('stop')
    expect(seen).toEqual(['deblur', 'deblur'])
    // Left to finish, it pauses many times on the way and gives what trace gives.
    const stages: string[] = []
    const r = await traceAsync(image, { preset: 'logo', deblur: true, onProgress: (s) => stages.push(s.stage) })
    expect(stages.filter((s) => s === 'deblur').length).toBeGreaterThan(5)
    expect(stages.indexOf('palette')).toBe(stages.lastIndexOf('deblur') + 1)
    expect(r).toEqual(trace(image, { preset: 'logo', deblur: true }))
  })

  it('leaves pixel art alone', () => {
    const image = { data: art(2.5), width: W, height: H }
    expect(trace(image, { preset: 'pixel', deblur: true }).paths).toEqual(trace(image, { preset: 'pixel' }).paths)
  })
})
