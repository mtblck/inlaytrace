/**
 * Flat outline illustrations: thin mid-blue outlines on white, shapes filled
 * with pale tints of the same blue, saved lossily (so each stroke pixel is one
 * of two shades of its ink). A sinking-ship illustration like this traced as
 * almost nothing with Logo: the strokes dissolved into the paper, the pale
 * fills were never in the palette, a letter stem collapsed to a line, and
 * Line art's fixed threshold broke every stroke.
 */
import { describe, expect, it } from 'vitest'
import { fitChain, pointAt, type Cubic } from './fit'
import { parsePath, type Pt } from './path'
import { oklab, peakPalette, type Rgb } from './palette'
import { traceInlay } from './inlay'

const W = 320
const H = 200
const WHITE: Rgb = [255, 255, 255]
const PALE: Rgb = [239, 245, 250] // 0.03 from white in OKLab
const TINT: Rgb = [211, 229, 241]
// Two shades of the ink, as lossy compression leaves a thin stroke: 0.08 apart in OKLab.
const INK: Rgb = [86, 140, 182]
const DARK: Rgb = [60, 108, 140]

/** A deterministic 0–1 hash of a pixel, for the shade each stroke pixel gets. */
const hash = (x: number, y: number) => {
  let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return (h & 0xffff) / 0xffff
}

type Shape = 'stroke' | 'pale' | 'tint' | null
/** What's at a point: a moon (pale disc, no outline), a hull (pale, outlined), a striped funnel, a stem and a dash. */
function at(x: number, y: number): Shape {
  const ring = Math.hypot(x - 230, y - 70)
  if (ring < 45) return 'pale'
  // Hull: a 120 × 70 box outlined 3 px wide, filled pale, with a tinted band.
  if (x >= 30 && x < 150 && y >= 90 && y < 160) {
    if (x < 33 || x >= 147 || y < 93 || y >= 157) return 'stroke'
    return y >= 120 && y < 135 ? 'tint' : 'pale'
  }
  if (x >= 200 && x < 203 && y >= 140 && y < 157) return 'stroke' // a letter stem, 3 × 17
  if (x >= 220 && x < 240 && y >= 170 && y < 173) return 'stroke' // a dash, 20 × 3
  return null
}

function image() {
  const px = new Uint8Array(W * H * 4)
  const mask: Record<'stroke' | 'pale' | 'tint', number> = { stroke: 0, pale: 0, tint: 0 }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const acc = [0, 0, 0]
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const s = at(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)
          const c = s === 'stroke' ? (hash(x, y) < 0.5 ? INK : DARK) : s === 'pale' ? PALE : s === 'tint' ? TINT : WHITE
          for (let k = 0; k < 3; k++) acc[k] += c[k]
        }
      px.set([...acc.map((v) => Math.round(v / 16)), 255], (y * W + x) * 4)
      const s = at(x + 0.5, y + 0.5)
      if (s) mask[s]++
    }
  return { px, mask }
}

/** Area of a path (outline minus holes), with curves sampled finely. */
function area(d: string) {
  let total = 0
  for (const s of parsePath(d)) {
    const pts: Pt[] = []
    s.nodes.forEach((n, i) => {
      const m = s.nodes[(i + 1) % s.nodes.length]
      const c: Cubic = [n, n.out ?? n, m.in ?? m, m]
      for (let k = 0; k < 16; k++) pts.push(pointAt(c, k / 16))
    })
    for (let i = 0; i < pts.length; i++) total += pts[i].x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * pts[i].y
  }
  return Math.abs(total / 2)
}

const pathsOf = (svg: string) => [...svg.matchAll(/<path d="([^"]*)" fill="([^"]*)"/g)].map((m) => ({ d: m[1], fill: m[2] }))
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const near = (hex: string, c: Rgb, within: number) => {
  const a = oklab(rgbOf(hex))
  const b = oklab(c)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < within
}
/** Total area of the paths whose fill is within `within` of `c`. */
const areaNear = (svg: string, c: Rgb, within = 0.06) =>
  pathsOf(svg)
    .filter((p) => near(p.fill, c, within))
    .reduce((s, p) => s + area(p.d), 0)

const { px, mask } = image()
const LOGO = { speckle: 8, tolerance: 1, cornerAngle: 45, shapes: true }

describe('flat outline illustrations', () => {
  it('finds the pale fills by their flatness, given the width', () => {
    const palette = peakPalette(px, 8, { width: W })
    expect(palette.some((c) => near(c, PALE, 0.012))).toBe(true)
    expect(palette.some((c) => near(c, TINT, 0.012))).toBe(true)
    // Without the width there's no telling a fill from an edge, so the pale fill stays out.
    expect(peakPalette(px, 8).some((c) => near(c, PALE, 0.012))).toBe(false)
    // Nothing that is only ever an anti-aliased edge between ink and paper.
    for (const c of palette) expect([WHITE, PALE, TINT, INK, DARK].some((k) => near(c, k, 0.03))).toBe(true)
  })

  it('keeps thin strokes of two shades whole, and the fills', () => {
    const svg = traceInlay(px, W, H, { ...LOGO, mode: 'palette', palette: peakPalette(px, 8, { width: W }) })
    const ink = areaNear(svg, INK, 0.03) + areaNear(svg, DARK, 0.03)
    // The strokes, not the paper they mostly touch: within 15% of their true area.
    expect(ink).toBeGreaterThan(0.85 * mask.stroke)
    expect(ink).toBeLessThan(1.15 * mask.stroke)
    expect(areaNear(svg, PALE, 0.015)).toBeGreaterThan(0.9 * mask.pale)
    expect(areaNear(svg, TINT, 0.015)).toBeGreaterThan(0.85 * mask.tint)
  })

  it('keeps a letter stem whole through speck clean-up', () => {
    const svg = traceInlay(px, W, H, { ...LOGO, speckle: 4, mode: 'palette', palette: peakPalette(px, 8, { width: W }) })
    const stem = pathsOf(svg).find((p) => parsePath(p.d).some((s) => s.nodes.every((n) => n.x > 196 && n.x < 207 && n.y > 135 && n.y < 162)))
    expect(stem).toBeDefined()
    expect(area(stem!.d)).toBeGreaterThan(0.7 * 3 * 17)
  })

  it("traces mid-blue line art whole with the image's own threshold", () => {
    const ink = (threshold: number | 'auto') =>
      pathsOf(traceInlay(px, W, H, { ...LOGO, speckle: 6, mode: 'binary', threshold })).reduce((s, p) => s + area(p.d), 0)
    // The lighter shade's luminance is 129: a fixed 128 sits right on it.
    expect(ink(128)).toBeLessThan(0.8 * mask.stroke)
    expect(ink('auto')).toBeGreaterThan(0.9 * mask.stroke)
    expect(ink('auto')).toBeLessThan(1.3 * mask.stroke)
  })
})

describe('the edges of those fixes', () => {
  /** A w × h image painted per pixel, no anti-aliasing. */
  const flat = (w: number, h: number, paint: (x: number, y: number) => Rgb) => {
    const out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set([...paint(x, y), 255], (y * w + x) * 4)
    return out
  }

  it('folds a stem banded in two shades into one, not swapping them back and forth', () => {
    // Columns DARK | INK | DARK, 180 px tall: three slivers side by side.
    const img = flat(40, 200, (x, y) => (y >= 10 && y < 190 && x >= 19 && x < 22 ? (x === 20 ? INK : DARK) : WHITE))
    const svg = traceInlay(img, 40, 200, { ...LOGO, mode: 'palette', palette: ['#ffffff', '#568cb6', '#3c6c8c'] })
    expect(pathsOf(svg).filter((p) => p.fill !== '#ffffff')).toHaveLength(1)
  })

  it('keeps a plentiful colour that is never flat: 1 px grey rules beside black', () => {
    const img = flat(100, 100, (x, y) => (x < 30 && y < 30 ? [0, 0, 0] : y % 4 === 0 && y > 40 ? [120, 120, 120] : WHITE))
    expect(peakPalette(img, 8, { width: 100 })).toContain('#787878')
  })

  it("doesn't split a blank, noisy page into ink and paper", () => {
    const img = flat(100, 100, (x, y) => {
      const v = 228 + Math.round(hash(x, y) * 14)
      return [v, v, v]
    })
    expect(pathsOf(traceInlay(img, 100, 100, { ...LOGO, mode: 'binary', threshold: 'auto' }))).toHaveLength(0)
  })

  it('takes a zero minTint as no minimum, without hanging', () => {
    expect(peakPalette(px, 8, { width: W, minTint: 0 }).length).toBeGreaterThan(0)
  })

  it('fits a 3 px stem as a shape, not a line', () => {
    // Its ends are too narrow to measure as corners: both long sides were fitted between the same two nodes.
    const pts: Pt[] = []
    for (let y = 0; y < 17; y++) pts.push({ x: 0, y })
    for (let x = 0; x < 3; x++) pts.push({ x, y: 17 })
    for (let y = 17; y > 0; y--) pts.push({ x: 3, y })
    for (let x = 3; x > 0; x--) pts.push({ x, y: 0 })
    const d = `M${fitChain(pts, true, { tolerance: 1, cornerAngle: 45 })
      .map((c, i) => `${i ? '' : `${c[0].x} ${c[0].y}`}C${c[1].x} ${c[1].y} ${c[2].x} ${c[2].y} ${c[3].x} ${c[3].y}`)
      .join('')}Z`
    expect(area(d)).toBeGreaterThan(0.75 * 3 * 17)
  })

  it('grows no spikes on noisy letter stems', () => {
    // 2.6–3.6 px stems, anti-aliased at sub-pixel offsets, their ink noisy as lossy compression leaves it.
    // Their nearly parallel sides "met" far past the pixels, and least-squares handles shot out: 95 px.
    let worst = 0
    for (let k = 0; k < 200; k++) {
      const [w, h, x0, sw, y0, y1] = [30, 40, 10 + (k % 7) / 7, 2.6 + (k % 5) * 0.25, 10 + (k % 3) / 3, 28 + (k % 4) / 4]
      const img = new Uint8Array(w * h * 4)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let cov = 0
          for (let s = 0; s < 16; s++) {
            const X = x + ((s % 4) + 0.5) / 4
            const Y = y + (Math.floor(s / 4) + 0.5) / 4
            if (X >= x0 && X < x0 + sw && Y >= y0 && Y < y1) cov++
          }
          const t = Math.min(1, Math.max(0, cov / 16 + (cov ? (hash(x + 97 * k, y) - 0.5) * 0.6 : 0)))
          img.set([255 - t * 170, 255 - t * 120, 255 - t * 80, 255], (y * w + x) * 4)
        }
      for (const p of pathsOf(traceInlay(img, w, h, { mode: 'binary', threshold: 'auto', speckle: 2, tolerance: 1, cornerAngle: 45 })))
        for (const s of parsePath(p.d))
          for (const n of s.nodes)
            for (const q of [n, n.in, n.out]) if (q) worst = Math.max(worst, y0 - q.y, q.y - y1, x0 - q.x, q.x - x0 - sw)
    }
    expect(worst).toBeLessThan(8)
  })

  it('leaves out a blend that is only ever an edge, given the width, even past minShare', () => {
    // Black squares on white at half-pixel offsets: their edges are mid-grey, 0.8% of the image.
    const img = flat(100, 100, (x, y) => {
      const inSq = (v: number) => v % 50 >= 5 && v % 50 < 15
      const edge = (v: number) => v % 50 === 15
      return (inSq(x) || edge(x)) && (inSq(y) || edge(y)) ? (edge(x) || edge(y) ? [128, 128, 128] : [0, 0, 0]) : WHITE
    })
    expect(peakPalette(img, 8)).toContain('#808080')
    expect(peakPalette(img, 8, { width: 100 })).not.toContain('#808080')
  })
})
