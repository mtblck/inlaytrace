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

  it("adds no tints for a photo's smooth dark shades, which are flat too", () => {
    const img = flat(200, 200, (x) => [20 + (x >> 2), 30 + (x >> 2), 60 + (x >> 1)])
    expect(peakPalette(img, 16, { width: 200 })).toEqual(peakPalette(img, 16))
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

describe('small text on an illustration', () => {
  // A line of eight letter-sized rings, 1.5 px grey strokes anti-aliased on
  // white, beside the illustration's blue ink: under Logo's speck size (64 px)
  // each, with no pixel of their own sure of the grey.
  const GREY: Rgb = [107, 107, 107]
  const TW = 200
  const TH = 40
  const text = new Uint8Array(TW * TH * 4)
  for (let y = 0; y < TH; y++)
    for (let x = 0; x < TW; x++) {
      let ink = 0
      let blue = 0
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const fx = x + (sx + 0.5) / 4
          const fy = y + (sy + 0.5) / 4
          const cx = 20 + 14 * Math.round((fx - 20) / 14)
          if (cx >= 20 && cx <= 118 && Math.abs(Math.hypot(fx - cx, fy - 20) - 3.5) < 0.75) ink++
          if (fx >= 140 && fx < 180 && fy >= 18 && fy < 21) blue++
        }
      const c = [0, 1, 2].map((k) => Math.round(255 + ((GREY[k] - 255) * ink + (INK[k] - 255) * blue) / 16))
      text.set([...c, 255], (y * TW + x) * 4)
    }
  const palette = ['#ffffff', '#568cb6', '#3c6c8c', '#6b6b6b']

  it('keeps every letter, in grey, at the default speck size', () => {
    const paths = pathsOf(traceInlay(text, TW, TH, { ...LOGO, mode: 'palette', palette }))
    expect(paths.filter((p) => p.fill === '#6b6b6b')).toHaveLength(8)
    expect(paths.filter((p) => p.fill === '#568cb6')).toHaveLength(1)
    expect(paths.filter((p) => p.fill === '#3c6c8c')).toHaveLength(0)
  })

  it('clears a blob with only transparency around it, however it contrasts', () => {
    const blob = new Uint8Array(40 * 40 * 4)
    for (let y = 18; y < 21; y++) for (let x = 18; x < 22; x++) blob.set([60, 108, 140, 255], (y * 40 + x) * 4)
    expect(pathsOf(traceInlay(blob, 40, 40, { ...LOGO, mode: 'palette', palette: ['#3c6c8c'] }))).toHaveLength(0)
  })

  it('still clears them when Speckle is raised past their size', () => {
    const paths = pathsOf(traceInlay(text, TW, TH, { ...LOGO, speckle: 30, mode: 'palette', palette }))
    expect(paths.filter((p) => p.fill === '#6b6b6b')).toHaveLength(0)
  })
})

describe('lines as strokes', () => {
  const strokesOf = (svg: string) => [...svg.matchAll(/<path d="([^"]*)" fill="none" stroke="([^"]*)" stroke-width="([^"]*)"/g)].map((m) => ({ d: m[1], stroke: m[2], width: Number(m[3]) }))
  const svg = traceInlay(px, W, H, { ...LOGO, speckle: 4, mode: 'palette', palette: peakPalette(px, 8, { width: W }), strokes: true })

  it('traces the outline as one stroked loop at the width drawn, and short marks as shapes', () => {
    const lines = strokesOf(svg)
    expect(lines).toHaveLength(1)
    expect(near(lines[0].stroke, INK, 0.06) || near(lines[0].stroke, DARK, 0.06)).toBe(true)
    expect(lines[0].width).toBeGreaterThan(2.5)
    expect(lines[0].width).toBeLessThan(3.6)
    // The hull's outline is one closed loop. The stem and the dash are under
    // eight times as long as wide, too short to tell from a letter's stroke.
    const subs = parsePath(lines[0].d)
    expect(subs).toHaveLength(1)
    expect(subs[0].closed).toBe(true)
    const marks = areaNear(svg, INK, 0.03) + areaNear(svg, DARK, 0.03)
    expect(marks).toBeGreaterThan(0.8 * (3 * 17 + 20 * 3))
    expect(marks).toBeLessThan(1.25 * (3 * 17 + 20 * 3))
  })

  it('lets the fills meet under the line', () => {
    // The pale fill reaches the middle of the outline: the hull inside its centreline, less the band, plus the moon.
    const hull = (148.5 - 31.5) * (158.5 - 91.5) - (148.5 - 31.5) * 15
    const pale = hull + Math.PI * 45 ** 2
    expect(areaNear(svg, PALE, 0.015)).toBeGreaterThan(0.95 * pale)
    expect(areaNear(svg, PALE, 0.015)).toBeLessThan(1.05 * pale)
  })

  it('keeps lettering too small to follow as shapes', () => {
    const W2 = 200
    const H2 = 40
    const text = new Uint8Array(W2 * H2 * 4)
    // Eight 1.5 px grey rings and a 3 px blue rule, anti-aliased on white.
    for (let y = 0; y < H2; y++)
      for (let x = 0; x < W2; x++) {
        let ink = 0
        let blue = 0
        for (let sy = 0; sy < 4; sy++)
          for (let sx = 0; sx < 4; sx++) {
            const fx = x + (sx + 0.5) / 4
            const fy = y + (sy + 0.5) / 4
            const cx = 20 + 14 * Math.round((fx - 20) / 14)
            if (cx >= 20 && cx <= 118 && Math.abs(Math.hypot(fx - cx, fy - 20) - 3.5) < 0.75) ink++
            if (fx >= 140 && fx < 190 && fy >= 18 && fy < 21) blue++
          }
        const c = [0, 1, 2].map((k) => Math.round(255 + ((107 - 255) * ink + (INK[k] - 255) * blue) / 16))
        text.set([...c, 255], (y * W2 + x) * 4)
      }
    const out = traceInlay(text, W2, H2, { ...LOGO, mode: 'palette', palette: ['#ffffff', '#568cb6', '#6b6b6b'], strokes: true })
    expect(pathsOf(out).filter((p) => p.fill === '#6b6b6b')).toHaveLength(8)
    expect(strokesOf(out).map((l) => l.stroke)).toEqual(['#568cb6'])
  })

  it('is ignored for photos, binary and pixel art', () => {
    const palette = peakPalette(px, 8, { width: W })
    for (const o of [{ photo: true }, { pixels: true }]) expect(strokesOf(traceInlay(px, W, H, { ...LOGO, mode: 'palette', palette, strokes: true, ...o }))).toHaveLength(0)
    expect(strokesOf(traceInlay(px, W, H, { ...LOGO, mode: 'binary', threshold: 'auto', strokes: true } as Parameters<typeof traceInlay>[3]))).toHaveLength(0)
  })

  /** A w × h image painted with RGBA per pixel, 4 × 4 samples each, so edges are anti-aliased. */
  const paint = (w: number, h: number, at: (x: number, y: number) => number[] | null, ground: number[] | null) => {
    const out = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const acc = [0, 0, 0, 0]
        for (let sy = 0; sy < 4; sy++)
          for (let sx = 0; sx < 4; sx++) {
            const c = at(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4) ?? ground
            if (!c) continue
            for (let k = 0; k < 3; k++) acc[k] += c[k]
            acc[3]++
          }
        out.set(acc[3] ? [...acc.slice(0, 3).map((v) => Math.round(v / acc[3])), Math.round((acc[3] / 16) * 255)] : [0, 0, 0, 0], (y * w + x) * 4)
      }
    return out
  }
  const BLACK = [20, 20, 20]
  /** A 3 px outline round a 120 × 80 card at (20, 20), with `inside` painted within. */
  const card = (x: number, y: number, inside: (x: number, y: number) => number[] | null) => {
    const inCard = x >= 20 && x < 140 && y >= 20 && y < 100
    if (!inCard) return null
    if (x < 23 || x >= 137 || y < 23 || y >= 97) return BLACK
    return inside(x, y)
  }
  const traceIt = (img: Uint8Array, palette: string[], extra = {}) => traceInlay(img, 160, 120, { ...LOGO, speckle: 4, mode: 'palette', palette, strokes: true, ...extra })

  it('finds lines on a transparent background, where the ink is the commonest colour', () => {
    const img = paint(160, 120, (x, y) => card(x, y, () => null), null)
    const lines = strokesOf(traceIt(img, ['#141414']))
    expect(lines).toHaveLength(1)
    expect(parsePath(lines[0].d)[0].closed).toBe(true)
  })

  it('keeps an outline a line where a solid area of its ink runs into it, and the area a shape', () => {
    // A 40 × 30 block of the ink joined to the outline's inside, on a pale card.
    const img = paint(160, 120, (x, y) => card(x, y, (x, y) => (x < 63 && y < 53 ? BLACK : [226, 238, 246])), [255, 255, 255])
    const svg = traceIt(img, ['#ffffff', '#e2eef6', '#141414'])
    expect(strokesOf(svg)).toHaveLength(1)
    const block = pathsOf(svg).filter((p) => p.fill === '#141414')
    expect(block).toHaveLength(1)
    expect(area(block[0].d)).toBeGreaterThan(0.8 * 40 * 30)
  })

  it('draws rules of one ink as lines and its small lettering beside them as shapes', () => {
    // The card's 3 px outline, and inside it a row of 1.5 px rings in the same ink.
    const ring = (x: number, y: number) => {
      const cx = 40 + 14 * Math.round((x - 40) / 14)
      return cx <= 110 && Math.abs(Math.hypot(x - cx, y - 60) - 3.5) < 0.75 ? BLACK : null
    }
    const svg = traceIt(paint(160, 120, (x, y) => card(x, y, ring), [255, 255, 255]), ['#ffffff', '#141414'])
    const lines = strokesOf(svg)
    expect(lines).toHaveLength(1)
    expect(lines[0].width).toBeGreaterThan(2.5)
    expect(pathsOf(svg).filter((p) => p.fill === '#141414').length).toBeGreaterThanOrEqual(6)
  })

  it('takes wider lines as lines when the image was enlarged', () => {
    // The same card drawn twice the size: a 6 px outline, which at scale 1 is
    // wide enough to be a line already; at 10 px it needs the scale.
    const big = (w: number) => (x: number, y: number) => (x >= 20 && x < 140 && y >= 20 && y < 100 && (x < 20 + w || x >= 140 - w || y < 20 + w || y >= 100 - w) ? BLACK : null)
    const img = paint(160, 120, big(10), [255, 255, 255])
    expect(strokesOf(traceIt(img, ['#ffffff', '#141414']))).toHaveLength(0)
    const lines = strokesOf(traceIt(img, ['#ffffff', '#141414'], { scale: 2 }))
    expect(lines).toHaveLength(1)
    expect(lines[0].width).toBeGreaterThan(9)
  })
})
