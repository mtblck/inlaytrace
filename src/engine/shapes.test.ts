/**
 * The shared-edge tracer and the fitter behind it. The properties that matter:
 * shapes tile the image exactly (no gaps, no overlaps), straight edges come out
 * as single lines with sharp corners, and round things stay round.
 */
import { describe, expect, it } from 'vitest'
import { fitChain, pointAt, type Cubic } from '../lib/fit'
import { parsePath, type Pt } from '../lib/pathdata'
import { gunzipSync } from 'fflate'
import { SAMPLE_CAPS } from './fixtures/sample-caps'
import { mergeLabels, otsu, traceShapes } from './shapes'

type Paint = (x: number, y: number) => [number, number, number, number?]

/** Rasterise with 4×4 supersampling, so edges are anti-aliased like real art. */
function raster(w: number, h: number, paint: Paint) {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const acc = [0, 0, 0, 0]
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const [r, g, b, a = 255] = paint(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)
          acc[0] += r
          acc[1] += g
          acc[2] += b
          acc[3] += a
        }
      px.set(acc.map((v) => Math.round(v / 16)), (y * w + x) * 4)
    }
  return px
}

const RED: [number, number, number] = [214, 64, 32]
const BLUE: [number, number, number] = [32, 59, 78]
const CREAM: [number, number, number] = [243, 237, 225]
const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** Signed area of a path (outline minus holes), with curves sampled finely. */
function area(d: string) {
  let total = 0
  for (const s of parsePath(d)) {
    const pts: Pt[] = []
    s.nodes.forEach((n, i) => {
      const m = s.nodes[(i + 1) % s.nodes.length]
      const c: Cubic = [n, n.out ?? n, m.in ?? m, m]
      for (let k = 0; k < 16; k++) pts.push(pointAt(c, k / 16))
    })
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      total += a.x * b.y - b.x * a.y
    }
  }
  return total / 2
}

const pathsOf = (svg: string) => [...svg.matchAll(/<path d="([^"]*)" fill="([^"]*)"/g)].map((m) => ({ d: m[1], fill: m[2] }))
const segments = (d: string) => (d.match(/[LC]/g) ?? []).length

describe('fitting', () => {
  it('a square drawn as a pixel staircase comes back as four straight lines with sharp corners', () => {
    // A square tilted 20°, as the pixel-corner staircase a tracer would walk.
    const ang = (20 * Math.PI) / 180
    const corners = [0, 1, 2, 3].map((k) => ({ x: 50 + 30 * Math.cos(ang + (k * Math.PI) / 2), y: 50 + 30 * Math.sin(ang + (k * Math.PI) / 2) }))
    const pts: Pt[] = []
    for (let k = 0; k < 4; k++) {
      const a = corners[k]
      const b = corners[(k + 1) % 4]
      for (let t = 0; t < 1; t += 1 / 60) pts.push({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) })
    }
    const cubics = fitChain(pts, true, { tolerance: 1, cornerAngle: 60 })
    expect(cubics).toHaveLength(4)
    for (const c of cubics) {
      const nearest = Math.min(...corners.map((k) => Math.hypot(k.x - c[0].x, k.y - c[0].y)))
      expect(nearest).toBeLessThan(1) // corners land on the real corners, not a rounded approximation
    }
  })

  it('a circle stays a few smooth curves with no corners', () => {
    const pts: Pt[] = []
    for (let a = 0; a < 2 * Math.PI; a += 0.01) pts.push({ x: Math.round(60 + 40 * Math.cos(a)), y: Math.round(60 + 40 * Math.sin(a)) })
    const cubics = fitChain(pts, true, { tolerance: 1, cornerAngle: 60 })
    expect(cubics.length).toBeGreaterThanOrEqual(2)
    expect(cubics.length).toBeLessThanOrEqual(8)
    for (const c of cubics) for (let t = 0; t <= 1; t += 0.1) {
      const p = pointAt(c, t)
      expect(Math.abs(Math.hypot(p.x - 60, p.y - 60) - 40)).toBeLessThan(1.2)
    }
  })

  it('an open chain keeps its ends exactly where they were', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i, y: Math.round(i * 0.3) }))
    const cubics = fitChain(pts, false, { tolerance: 1, cornerAngle: 60 })
    expect(cubics[0][0]).toEqual(pts[0])
    expect(cubics[cubics.length - 1][3]).toEqual(pts[39])
    expect(cubics).toHaveLength(1) // and a straight run is one segment
  })
})

describe('the shapes Matt reported (#19)', () => {
  const opts = { tolerance: 1, cornerAngle: 45, speckle: 2 }
  const GREEN: [number, number, number] = [47, 105, 81]
  const pal = { mode: 'palette' as const, palette: [hex(GREEN), hex(CREAM)] }
  const creamPath = (svg: string) => pathsOf(svg).find((p) => p.fill === hex(CREAM))!.d

  /** Every fitted point's distance from a reference outline, worst case. */
  function worstOff(d: string, distanceTo: (p: Pt) => number) {
    let worst = 0
    for (const s of parsePath(d))
      s.nodes.forEach((n, i) => {
        const m = s.nodes[(i + 1) % s.nodes.length]
        const c: Cubic = [n, n.out ?? n, m.in ?? m, m]
        for (let k = 0; k <= 16; k++) worst = Math.max(worst, distanceTo(pointAt(c, k / 16)))
      })
    return worst
  }

  it('a stroke with round ends keeps them round: no hook, no flat cut', () => {
    // 8 px wide, round caps, like the arc on the sample badge.
    const capsule = (p: Pt) => Math.abs(Math.hypot(p.x - Math.max(20, Math.min(100, p.x)), p.y - 20.3) - 4)
    const px = raster(120, 40, (x, y) => (capsule({ x, y }) < 4 && Math.hypot(x - Math.max(20, Math.min(100, x)), y - 20.3) < 4 ? CREAM : GREEN))
    const d = creamPath(traceShapes(px, 120, 40, { ...opts, ...pal }))
    expect(worstOff(d, capsule)).toBeLessThan(0.75)
    // Two straight sides (one may be the closing Z), each end drawn as curves.
    const sub = parsePath(d)[0]
    const straight = sub.nodes.filter((n, i) => !n.out && !sub.nodes[(i + 1) % sub.nodes.length].in).length
    expect(straight).toBe(2)
    expect(sub.nodes.length).toBeLessThanOrEqual(8)
  })

  it('a stroke with square ends keeps its four corners', () => {
    const px = raster(120, 40, (x, y) => (x > 20 && x < 100 && Math.abs(y - 20.3) < 4 ? CREAM : GREEN))
    const d = creamPath(traceShapes(px, 120, 40, { ...opts, ...pal }))
    expect(d).not.toMatch(/C/)
    expect(parsePath(d)[0].nodes).toHaveLength(4) // the fourth side is the closing Z
  })

  it('an acute peak where three colours meet stays one sharp point', () => {
    // A narrow snow-cap wedge (about 50°) poking into a disc, over a third colour.
    const w = 80
    const h = 60
    const tip = { x: 40, y: 12 }
    const inWedge = (x: number, y: number) => y > tip.y && Math.abs(x - tip.x) < (y - tip.y) * 0.47
    const px = raster(w, h, (x, y) => (inWedge(x, y) ? CREAM : Math.hypot(x - 52, y - 4) < 16 ? RED : BLUE))
    const svg = traceShapes(px, w, h, { ...opts, mode: 'palette', palette: [hex(CREAM), hex(RED), hex(BLUE)] })
    const d = pathsOf(svg).find((p) => p.fill === hex(CREAM))!.d
    // Its topmost node is the tip itself, within a pixel, and nothing pokes above it.
    const nodes = parsePath(d).flatMap((s) => s.nodes)
    const top = nodes.reduce((a, b) => (b.y < a.y ? b : a))
    expect(Math.hypot(top.x - tip.x, top.y - tip.y)).toBeLessThan(1.5) // a 50° tip is pixel-limited
    expect(worstOff(d, (p) => Math.max(0, tip.y - p.y))).toBeLessThan(0.5)
  })

  it('never stacks nodes: none within 3 px of the next, on the real sample', () => {
    // The sample's snow caps as the app traces them (JPEG q72): junctions,
    // a peak inside the sun, a 15° sliver corner.
    const { width: w, height: h, gz } = SAMPLE_CAPS
    const px = gunzipSync(Uint8Array.from(atob(gz), (c) => c.charCodeAt(0)))
    const palette = ['#f4ece1', '#203b4e', '#d9542b', '#2e6a50', '#e9a13b']
    const svg = traceShapes(px, w, h, { tolerance: 1, cornerAngle: 45, speckle: 8, mode: 'palette', palette })
    const close: string[] = []
    for (const p of pathsOf(svg))
      for (const s of parsePath(p.d))
        s.nodes.forEach((a, i) => {
          const b = s.nodes[(i + 1) % s.nodes.length]
          if (Math.hypot(a.x - b.x, a.y - b.y) < 3) close.push(`${a.x},${a.y}`)
        })
    expect(close).toEqual([])
  })

  it('merging a colour removes the edge between the two', () => {
    // Red and blue squares side by side on cream: merged, one red rectangle.
    const w = 80
    const h = 50
    const px = raster(w, h, (x, y) => (y > 10 && y < 40 && x > 10 && x < 70 ? (x < 40 ? RED : BLUE) : CREAM))
    const palette = [hex(CREAM), hex(RED), hex(BLUE)]
    const merged = pathsOf(traceShapes(px, w, h, { ...opts, mode: 'palette', palette, merge: { [hex(BLUE)]: hex(RED) } }))
    expect(merged.map((p) => p.fill).sort()).toEqual([hex(CREAM), hex(RED)].sort())
    const red = merged.find((p) => p.fill === hex(RED))!
    expect(Math.abs(area(red.d))).toBeCloseTo(60 * 30, -1) // the whole 60 × 30 block
    expect(parsePath(red.d).flatMap((x) => x.nodes)).toHaveLength(4) // one rectangle: no seam left inside it
  })

  it('follows merge chains and ignores loops', () => {
    const labels = new Int32Array([0, 1, 2, 3])
    mergeLabels(labels, ['#a', '#b', '#c', ''], { '#a': '#b', '#b': '#c' })
    expect([...labels]).toEqual([2, 2, 2, 3])
    // a → b → c with b missing from this palette still lands on c; with c missing too, a stays.
    const gap = new Int32Array([0, 1])
    mergeLabels(gap, ['#a', '#c'], { '#a': '#b', '#b': '#c' })
    expect([...gap]).toEqual([1, 1])
    const none = new Int32Array([0])
    mergeLabels(none, ['#a'], { '#a': '#b' })
    expect([...none]).toEqual([0])
    const loop = new Int32Array([0, 1])
    mergeLabels(loop, ['#a', '#b'], { '#a': '#b', '#b': '#a' })
    expect([...loop]).toEqual([0, 1]) // a cycle (which the UI can't make) leaves both alone rather than hanging
  })

  it('a circle is four curves, the way it would be drawn by hand', () => {
    const px = raster(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 30 ? CREAM : GREEN))
    const d = creamPath(traceShapes(px, 100, 100, { ...opts, ...pal }))
    expect(segments(d)).toBe(4)
    expect(worstOff(d, (p) => Math.abs(Math.hypot(p.x - 50, p.y - 50) - 30))).toBeLessThan(0.5)
  })
})

describe('shared-edge tracer', () => {
  const opts = { tolerance: 1, cornerAngle: 60, speckle: 4 }

  it('tiles the image exactly: no gaps, no overlaps', () => {
    // Three colours meeting at junctions, with a diagonal edge and a disc.
    const w = 120
    const h = 90
    const px = raster(w, h, (x, y) => ((x - 80) ** 2 + (y - 40) ** 2 < 22 ** 2 ? RED : y > 0.4 * x + 30 ? BLUE : CREAM))
    const svg = traceShapes(px, w, h, { ...opts, mode: 'palette', palette: [hex(CREAM), hex(RED), hex(BLUE)] })
    const total = pathsOf(svg).reduce((s, p) => s + area(p.d), 0)
    expect(Math.abs(Math.abs(total) - w * h) / (w * h)).toBeLessThan(0.002)
  })

  it('straight edges are single lines, and shared by both neighbours', () => {
    const w = 100
    const h = 80
    // Two colours split by a slanted straight line.
    const px = raster(w, h, (x, y) => (y > 0.5 * x + 15 ? BLUE : CREAM))
    const paths = pathsOf(traceShapes(px, w, h, { ...opts, mode: 'palette', palette: [hex(CREAM), hex(BLUE)] }))
    expect(paths).toHaveLength(2)
    // Each shape is a polygon: the slanted edge plus image edges, all straight.
    for (const p of paths) {
      expect(p.d).not.toMatch(/C/)
      expect(segments(p.d)).toBeLessThanOrEqual(5)
    }
    // The slanted edge's two inner points are identical in both shapes.
    const inner = (d: string) => (d.match(/-?\d+(?:\.\d+)?\s-?\d+(?:\.\d+)?/g) ?? []).filter((s) => !/(^|\s)(0|100|80)(\s|$)/.test(` ${s} `.replace(/\s+/g, ' ')))
    expect(new Set(inner(paths[0].d))).toEqual(new Set(inner(paths[1].d)))
  })

  it('merges specks below the size limit and keeps them above it', () => {
    const w = 40
    const h = 40
    const px = raster(w, h, (x, y) => (x >= 20 && x < 22 && y >= 20 && y < 22 ? BLUE : CREAM))
    const pal = { mode: 'palette' as const, palette: [hex(CREAM), hex(BLUE)] }
    expect(pathsOf(traceShapes(px, w, h, { ...opts, ...pal, speckle: 3 }))).toHaveLength(1)
    expect(pathsOf(traceShapes(px, w, h, { ...opts, ...pal, speckle: 1 }))).toHaveLength(2)
  })

  it('never draws transparent pixels', () => {
    const w = 40
    const h = 40
    const px = raster(w, h, (x, y) => ((x - 20) ** 2 + (y - 20) ** 2 < 100 ? [...RED, 255] : [0, 0, 0, 0]))
    const paths = pathsOf(traceShapes(px, w, h, { ...opts, mode: 'palette', palette: [hex(RED)] }))
    expect(paths).toHaveLength(1)
    expect(Math.abs(area(paths[0].d)) / (Math.PI * 100)).toBeCloseTo(1, 1) // within 5%
  })

  it('line art draws only the ink, with holes cut', () => {
    const w = 60
    const h = 60
    // A thick dark ring on white.
    const px = raster(w, h, (x, y) => {
      const r = Math.hypot(x - 30, y - 30)
      return r < 22 && r > 12 ? [20, 20, 20] : [250, 250, 250]
    })
    const paths = pathsOf(traceShapes(px, w, h, { ...opts, mode: 'binary', threshold: 128 }))
    expect(paths).toHaveLength(1)
    expect(parsePath(paths[0].d)).toHaveLength(2) // outline and hole
    expect(Math.abs(area(paths[0].d)) / (Math.PI * (22 ** 2 - 12 ** 2))).toBeCloseTo(1, 1)
  })

  it('keeps a thin rule inside the image', () => {
    // 1–2 px rules (a screenshot's borders) end in two corners a pixel or two
    // apart whose sides run parallel. Their sides' meeting point is far off, and
    // once shot 300 px past the image edge.
    const w = 160
    const h = 120
    for (const width of [1, 2, 3]) {
      const px = raster(w, h, (x, y) => (Math.abs(x - 80) < width / 2 || (Math.abs(y - 40) < width / 2 && x > 20 && x < 140) ? [20, 20, 20] : [250, 250, 250]))
      for (const d of pathsOf(traceShapes(px, w, h, { ...opts, mode: 'binary', threshold: 128 })).map((p) => p.d))
        for (const s of parsePath(d))
          for (const n of s.nodes) for (const q of [n, n.in, n.out]) if (q) expect([width, q.x > -2 && q.x < w + 2 && q.y > -2 && q.y < h + 2]).toEqual([width, true])
    }
  })

  it('Otsu splits two populations between them', () => {
    const lum = new Uint8Array([...Array(50).fill(30), ...Array(50).fill(220)])
    const t = otsu(lum, new Uint8Array(100).fill(1))
    expect(t).toBeGreaterThan(30)
    expect(t).toBeLessThanOrEqual(220)
  })
})
