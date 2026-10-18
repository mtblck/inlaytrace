/**
 * Target file size: find trace settings whose SVG fits under a size, losing as
 * little accuracy as it can on the way.
 *
 * Each candidate is traced, optimised as the export would be, and scored by
 * drawing it back over the source pixels: the mean difference per channel,
 * 0–255, as `npm run score:photos` measures. Drawing happens here, not in a
 * canvas, so it runs in the worker: paths are flattened to polygons and
 * filled with the nonzero rule at each pixel centre, in paint order.
 *
 * The search walks downhill from the current settings. Each step tries every
 * move that should shrink the file (smoother curves, a bigger speck filter,
 * fewer colours) and takes the one that costs the least accuracy per byte
 * saved, until the file fits. Every candidate it traces is a real trace, so
 * the size it reports is the size you get.
 */
import { parsePath } from 'inlaytrace'
import { runTrace } from './run'
import { toTraceOptions, type Settings } from './presets'

export type Candidate = { settings: Settings; bytes: number; error: number }
export type SizeSearch = { start: Candidate; best: Candidate; fits: boolean; tried: number }

/** Every setting the search may change, and how far. */
const MAX_SMOOTHING = 3
const MAX_SPECKLE = 32
const MIN_COLORS = 2
/** Traces the search may run before it settles for the smallest it found. */
export const MAX_TRIES = 30

/** Moves that should make the file smaller, from these settings; bigger ones while the file is far over. */
function moves(s: Settings, big: boolean): Settings[] {
  const out: Settings[] = []
  if (s.preset !== 'pixel') {
    // Pixel art keeps every pixel; only fewer colours make it smaller.
    if (s.smoothing < MAX_SMOOTHING) out.push({ ...s, smoothing: Math.min(MAX_SMOOTHING, s.smoothing + (big ? 1 : 0.5)) })
    if (s.speckle < MAX_SPECKLE) out.push({ ...s, speckle: Math.min(MAX_SPECKLE, Math.max(s.speckle + 2, Math.round(s.speckle * (big ? 2 : 1.5)))) })
  }
  if (s.preset !== 'lineart' && s.preset !== 'centerline' && s.colors > MIN_COLORS)
    out.push({ ...s, colors: big && s.colors > 4 ? Math.max(MIN_COLORS, Math.round(s.colors * 0.67)) : s.colors - 1 })
  return out
}

/**
 * Search for settings under `target` bytes. `measure` turns a traced SVG into
 * the bytes the export would have (the worker runs SVGO); `progress` hears
 * about each trace.
 */
export function searchSize(rgba: Uint8Array, width: number, height: number, from: Settings, target: number, measure: (svg: string) => number, progress?: (tried: number, best: Candidate) => void): SizeSearch {
  const reference = flatten(rgba)
  let tried = 0
  const evaluate = (settings: Settings): Candidate => {
    tried++
    const svg = runTrace(rgba.slice(), width, height, toTraceOptions(settings))
    return { settings, bytes: measure(svg), error: meanError(svg, reference, width, height) }
  }
  const start = evaluate(from)
  let cur = start
  let smallest = start
  while (cur.bytes > target && tried < MAX_TRIES) {
    let next: Candidate | null = null
    let cost = Infinity
    for (const s of moves(cur.settings, cur.bytes > 1.5 * target)) {
      if (tried >= MAX_TRIES) break
      const c = evaluate(s)
      if (c.bytes < smallest.bytes) smallest = c
      const saved = cur.bytes - c.bytes
      if (saved <= 0) continue
      // Accuracy lost per kilobyte saved; a move that also improves accuracy is free.
      const k = Math.max(0, c.error - cur.error) / (saved / 1024)
      // Ties (several free moves) go to the one that saves most.
      if (k < cost || (k === cost && next && c.bytes < next.bytes)) {
        cost = k
        next = c
      }
    }
    if (!next) break
    cur = next
    progress?.(tried, cur)
  }
  const fits = cur.bytes <= target
  return { start, best: fits ? cur : smallest, fits, tried }
}

// ---- Drawing back -----------------------------------------------------------

/** The source over white, as RGB: what the drawing is compared with. */
function flatten(rgba: Uint8Array) {
  const n = rgba.length / 4
  const out = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + 255 * (1 - a))
  }
  return out
}

/** Mean difference per channel (0–255) between an SVG drawn over white and the reference. */
export function meanError(svg: string, reference: Uint8Array, width: number, height: number) {
  const img = render(svg, width, height)
  let sum = 0
  for (let i = 0; i < img.length; i++) sum += Math.abs(img[i] - reference[i])
  return sum / img.length
}

/**
 * Draw an SVG's filled paths over white, one sample at each pixel centre. A
 * stroked path (centerline) is drawn as a band of its width round each segment.
 */
export function render(svg: string, width: number, height: number): Uint8Array {
  const img = new Uint8Array(width * height * 3).fill(255)
  for (const m of svg.matchAll(/<path\b([^>]*)\/?>/g)) {
    const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(m[1])?.[1] ?? null
    const d = attr('d')
    if (!d) continue
    const stroke = Number(attr('stroke-width'))
    const color = attr('fill') === 'none' ? attr('stroke') : attr('fill')
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) continue
    const rgb = [1, 3, 5].map((k) => parseInt(color.slice(k, k + 2), 16))
    const polys = polygons(d)
    if (attr('fill') === 'none') strokeBand(img, width, height, polys, stroke || 1, rgb)
    else fill(img, width, height, polys, rgb)
  }
  return img
}

/** Path data as polygons: each cubic as 8 straight pieces, each subpath closed. */
function polygons(d: string): { x: number; y: number }[][] {
  return parsePath(d).map((sp) => {
    const pts: { x: number; y: number }[] = []
    const n = sp.nodes
    const segs = sp.closed ? n.length : n.length - 1
    if (n.length) pts.push({ x: n[0].x, y: n[0].y })
    for (let i = 0; i < segs; i++) {
      const a = n[i]
      const b = n[(i + 1) % n.length]
      if (!a.out && !b.in) {
        pts.push({ x: b.x, y: b.y })
        continue
      }
      const c1 = a.out ?? a
      const c2 = b.in ?? b
      for (let k = 1; k <= 8; k++) {
        const t = k / 8
        const u = 1 - t
        pts.push({
          x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        })
      }
    }
    return pts
  })
}

/** Fill with the nonzero rule, sampling pixel centres, row by row. */
function fill(img: Uint8Array, width: number, height: number, polys: { x: number; y: number }[][], rgb: number[]) {
  type Edge = { y0: number; y1: number; x0: number; slope: number; dir: number }
  const edges: Edge[] = []
  for (const poly of polys)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      if (a.y === b.y) continue
      const dir = b.y > a.y ? 1 : -1
      const [p, q] = dir > 0 ? [a, b] : [b, a]
      edges.push({ y0: p.y, y1: q.y, x0: p.x, slope: (q.x - p.x) / (q.y - p.y), dir })
    }
  edges.sort((e, f) => e.y0 - f.y0)
  const crossings: { x: number; dir: number }[] = []
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5
    crossings.length = 0
    for (const e of edges) {
      if (e.y0 > cy) break // sorted by top: none further down reach this row
      if (cy < e.y1) crossings.push({ x: e.x0 + (cy - e.y0) * e.slope, dir: e.dir })
    }
    if (!crossings.length) continue
    crossings.sort((a, b) => a.x - b.x)
    let wind = 0
    for (let i = 0; i < crossings.length - 1; i++) {
      wind += crossings[i].dir
      if (!wind) continue
      const from = Math.max(0, Math.ceil(crossings[i].x - 0.5))
      const to = Math.min(width - 1, Math.floor(crossings[i + 1].x - 0.5))
      for (let x = from; x <= to; x++) img.set(rgb, (y * width + x) * 3)
    }
  }
}

/** A stroke: every pixel centre within half the width of a segment. */
function strokeBand(img: Uint8Array, width: number, height: number, polys: { x: number; y: number }[][], stroke: number, rgb: number[]) {
  const r = stroke / 2
  for (const poly of polys)
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i]
      const b = poly[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const l2 = dx * dx + dy * dy || 1
      const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r))
      const x1 = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x) + r))
      const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r))
      const y1 = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y) + r))
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5
          const py = y + 0.5
          const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2))
          if (Math.hypot(px - a.x - t * dx, py - a.y - t * dy) <= r) img.set(rgb, (y * width + x) * 3)
        }
    }
}
