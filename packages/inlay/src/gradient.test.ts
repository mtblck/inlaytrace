/**
 * Gradient fills: soft shading split into bands of tints is put back together
 * as one shape with a gradient, and nothing else is.
 */
import { describe, expect, it } from 'vitest'
import { colorAt, fitShading } from './gradient'
import { toSvg, trace } from './inlay'
import type { Rgb } from './palette'

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * Math.max(0, Math.min(1, t))) as Rgb
const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
const SKY_TOP: Rgb = [47, 111, 181]
const SKY_LOW: Rgb = [188, 217, 242]
const SUN_IN: Rgb = [246, 194, 107]
const SUN_OUT: Rgb = [192, 87, 28]

function image(w: number, h: number, paint: (x: number, y: number) => Rgb) {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = paint(x + 0.5, y + 0.5)
      px.set([...c.map(Math.round), 255], (y * w + x) * 4)
    }
  return px
}

/** Tints of a ramp, as a palette quantizer would pick them. */
const tints = (a: Rgb, b: Rgb, n: number) => Array.from({ length: n }, (_, i) => hex(mix(a, b, (i + 0.5) / n)))

describe('fitting', () => {
  it('finds a radial change of hue alone', () => {
    // Red to green at constant R + G + B: no change of brightness for the fit to follow.
    const xs: number[] = []
    const ys: number[] = []
    const cs: Rgb[] = []
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) {
        xs.push(x)
        ys.push(y)
        cs.push(mix([220, 20, 60], [20, 220, 60], Math.hypot(x - 30, y - 30) / 42))
      }
    const fit = fitShading(xs, ys, cs)!
    expect(fit.gradient.type).toBe('radial')
    expect(fit.rms).toBeLessThan(2)
  })

  it('finds a linear gradient', () => {
    const xs: number[] = []
    const ys: number[] = []
    const cs: Rgb[] = []
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 60; x++) {
        xs.push(x)
        ys.push(y)
        cs.push(mix(SKY_TOP, SKY_LOW, (x + y) / 98))
      }
    const fit = fitShading(xs, ys, cs)!
    expect(fit.gradient.type).toBe('linear')
    expect(fit.rms).toBeLessThan(1)
    for (const [x, y] of [
      [0, 0],
      [30, 20],
      [59, 39],
    ])
      expect(Math.hypot(...colorAt(fit.gradient, x, y).map((v, k) => v - mix(SKY_TOP, SKY_LOW, (x + y) / 98)[k]))).toBeLessThan(2)
  })

  it('finds a radial gradient and its centre', () => {
    const xs: number[] = []
    const ys: number[] = []
    const cs: Rgb[] = []
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 60; x++) {
        if (Math.hypot(x - 30, y - 30) > 28) continue
        xs.push(x)
        ys.push(y)
        cs.push(mix(SUN_IN, SUN_OUT, Math.hypot(x - 22, y - 24) / 40))
      }
    const fit = fitShading(xs, ys, cs)!
    expect(fit.gradient.type).toBe('radial')
    if (fit.gradient.type !== 'radial') return
    expect(Math.hypot(fit.gradient.cx - 22, fit.gradient.cy - 24)).toBeLessThan(1)
    expect(fit.rms).toBeLessThan(1.5)
  })
})

describe('tracing', () => {
  const W = 240
  const H = 180
  // A sky shading down to pale, a shaded sun in it, and a flat house.
  const sun = (x: number, y: number) => Math.hypot(x - 168, y - 60) < 36
  const house = (x: number, y: number) => x >= 40 && x < 100 && y >= 110 && y < 170
  const paint = (x: number, y: number): Rgb => (house(x, y) ? [243, 237, 225] : sun(x, y) ? mix(SUN_IN, SUN_OUT, Math.hypot(x - 156, y - 48) / 60) : mix(SKY_TOP, SKY_LOW, y / H))
  const px = image(W, H, paint)
  const palette = [...tints(SKY_TOP, SKY_LOW, 4), ...tints(SUN_IN, SUN_OUT, 3), '#f3ede1']
  const opts = { mode: 'palette' as const, palette, speckle: 2, tolerance: 0.75, cornerAngle: 60 }

  it('draws bands of tints as one shape each, with a gradient', () => {
    const banded = trace(px, W, H, opts)
    const shaded = trace(px, W, H, { ...opts, gradients: true })
    expect(banded.paths.length).toBeGreaterThanOrEqual(8)
    expect(shaded.paths.length).toBe(3)
    const kinds = shaded.paths.map((p) => p.gradient?.type ?? 'flat').sort()
    expect(kinds).toEqual(['flat', 'linear', 'radial'])
    // The flat house keeps its colour; a shaded shape's fill is its average colour.
    expect(shaded.paths.find((p) => !p.gradient)!.fill).toBe('#f3ede1')
    expect(shaded.paths.every((p) => /^#[0-9a-f]{6}$/.test(p.fill))).toBe(true)
  })

  it('writes the gradients into the SVG', () => {
    const svg = toSvg(trace(px, W, H, { ...opts, gradients: true }))
    const ids = [...svg.matchAll(/Gradient id="([^"]+)" gradientUnits="userSpaceOnUse"/g)].map((m) => m[1])
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(svg).toContain(`fill="url(#${id})"`)
    expect(svg).toMatch(/^<svg[^>]*>\n<defs>\n</)
    // Another drawing names its gradients differently, so both can sit in one page.
    const other = toSvg(trace(image(W, H, (x, y) => mix(SKY_TOP, SKY_LOW, x / W)), W, H, { ...opts, gradients: true }))
    const otherIds = [...other.matchAll(/Gradient id="([^"]+)"/g)].map((m) => m[1])
    expect(otherIds.length).toBeGreaterThan(0)
    expect(otherIds.some((id) => ids.includes(id))).toBe(false)
    expect(svg).toContain('<stop offset="0%" stop-color="#')
  })

  it('keeps a flat shape inside a shade', () => {
    // A flat disc in one of the sky's own tints, from lower down, stays a shape of its own.
    const DISC = mix(SKY_TOP, SKY_LOW, 150 / H)
    const disc = (x: number, y: number) => Math.hypot(x - 168, y - 60) < 30
    const px2 = image(W, H, (x, y) => (disc(x, y) ? DISC : mix(SKY_TOP, SKY_LOW, y / H)))
    const r = trace(px2, W, H, { ...opts, palette: tints(SKY_TOP, SKY_LOW, 4), gradients: true })
    expect(r.paths.filter((p) => p.gradient)).toHaveLength(1)
    expect(r.paths.filter((p) => !p.gradient)).toHaveLength(1)
  })

  it('leaves flat art alone', () => {
    const flat = image(W, H, (x, y) => (house(x, y) ? [243, 237, 225] : sun(x, y) ? SUN_OUT : y < 90 ? SKY_TOP : SKY_LOW))
    const flatOpts = { ...opts, palette: [hex(SKY_TOP), hex(SKY_LOW), hex(SUN_OUT), '#f3ede1'] }
    expect(toSvg(trace(flat, W, H, { ...flatOpts, gradients: true }))).toBe(toSvg(trace(flat, W, H, flatOpts)))
  })

  it('is off by default', () => {
    expect(trace(px, W, H, opts).paths.some((p) => p.gradient)).toBe(false)
  })
})
