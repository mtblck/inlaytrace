/**
 * Curve fitting: turn a pixel outline into the fewest straight lines and
 * curves that follow it, with sharp corners kept sharp.
 *
 * Input is a chain of points about one pixel apart: either an open run
 * between two fixed ends (a boundary between two colours, ending where a third
 * colour meets it) or a closed loop. The steps follow Potrace and Illustrator's
 * Image Trace in spirit:
 *
 *  1. Find the corners. A point is a corner when the outline turns by more than
 *     `cornerAngle` measured R px either side *and* still turns sharply over
 *     half that distance. A curve's turn halves with the distance and a
 *     corner's doesn't, which keeps small circles from growing corners. Each
 *     corner is then moved to where the straight runs either side of it meet,
 *     undoing the rounding that anti-aliasing gives every corner.
 *  2. Smooth the pixel staircase between corners, never across one.
 *  3. Fit each run between corners: one straight line if every point is within
 *     1.5× tolerance of it (straight edges are favoured), otherwise cubic Béziers by least squares (Schneider, "An
 *     Algorithm for Automatically Fitting Digitized Curves", Graphics Gems,
 *     1990), splitting where the error is worst. Curves that came out flat are
 *     written as lines.
 *
 * Everything is in trace pixels, so a tolerance means the same at any size.
 * Measurements live open-chain-aware: near an open chain's ends, neighbourhoods
 * are clamped to the chain, so the result depends only on the chain's own
 * points. That is what lets two shapes share one fitted edge exactly.
 */
import type { Pt } from './pathdata'

export type FitOptions = {
  /** Max distance in pixels between the outline and the fitted path. */
  tolerance: number
  /** Turns sharper than this (degrees from straight) are corners. */
  cornerAngle: number
  /** Half-window in px of the smoothing over the pixel staircase (default 12). */
  smoothing?: number
}

/** A cubic Bézier: start, two handles, end. A straight line has handles on the chord. */
export type Cubic = [Pt, Pt, Pt, Pt]

const R = 6 // arc length either side for measuring a turn, in px
const END_TRIM = 3 // px at each end of a run that the straight-line test ignores
const SMOOTH = 12 // default half-window, in px, of the smoothing over the pixel staircase
/**
 * A straight line is accepted at 1.5× the curve tolerance. Straight edges are
 * common in flat art, and a ripple along one is almost always JPEG noise (its
 * colour is stored in 16 px blocks), not a shape the artist drew.
 */
const LINE_BIAS = 1.5

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k })
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y
const len = (a: Pt) => Math.hypot(a.x, a.y)
const norm = (a: Pt): Pt => {
  const l = len(a)
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }
}
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

export const line = (a: Pt, b: Pt): Cubic => [a, add(a, mul(sub(b, a), 1 / 3)), add(a, mul(sub(b, a), 2 / 3)), b]

/** A cubic whose handles sit on its chord (within 0.15 px, and between the ends) is a line. */
export function isFlat([p0, c1, c2, p3]: Cubic) {
  const d = sub(p3, p0)
  const l = len(d)
  if (l < 1e-9) return true
  const off = (p: Pt) => Math.abs((p.x - p0.x) * d.y - (p.y - p0.y) * d.x) / l
  const t = (p: Pt) => dot(sub(p, p0), d) / (l * l)
  return off(c1) < 0.15 && off(c2) < 0.15 && t(c1) >= -0.01 && t(c1) <= 1.01 && t(c2) >= -0.01 && t(c2) <= 1.01
}

/**
 * Fit a chain. Open: from points[0] to the last point, which stay fixed.
 * Closed: points[0] is not repeated at the end; the result is a loop that starts
 * at a corner if there is one.
 */
export function fitChain(points: Pt[], closed: boolean, o: FitOptions): Cubic[] {
  const pts = resample(points, closed)
  const n = pts.length
  if (n < 2) return []
  if (!closed && n === 2) return [line(pts[0], pts[1])]

  const corners = findCorners(pts, closed, o.cornerAngle)

  if (closed && corners.length === 0) {
    // A smooth loop (a circle, a blob): fit it from an arbitrary start, with
    // the same tangent leaving and arriving so the seam is invisible.
    if (n < 4) return polygon(pts, true)
    const run = smooth([...pts, pts[0]], true, o.smoothing ?? SMOOTH).true
    const t = norm(sub(run[1], run[run.length - 2]))
    return flatten(fitRun(run, t, mul(t, -1), o.tolerance))
  }

  // Break points: the corners, plus an open chain's two fixed ends.
  const breaks = corners.map((c) => ({ index: c.index, at: c.at }))
  if (!closed) {
    if (!breaks.length || breaks[0].index !== 0) breaks.unshift({ index: 0, at: pts[0] })
    if (breaks[breaks.length - 1].index !== n - 1) breaks.push({ index: n - 1, at: pts[n - 1] })
    breaks[0].at = pts[0]
    breaks[breaks.length - 1].at = pts[n - 1]
  }

  const out: Cubic[] = []
  const segments = closed ? breaks.length : breaks.length - 1
  for (let b = 0; b < segments; b++) {
    const from = breaks[b]
    const to = breaks[(b + 1) % breaks.length]
    const run: Pt[] = []
    for (let i = from.index; ; i = (i + 1) % n) {
      run.push(pts[i])
      if (i === to.index && run.length > 1) break
    }
    run[0] = from.at
    run[run.length - 1] = to.at
    out.push(...fitBetween(smooth(run, false, o.smoothing ?? SMOOTH), o.tolerance))
  }
  return flatten(out)
}

/** Straight runs written as exact lines, so they serialise as L, not C. */
function flatten(cubics: Cubic[]): Cubic[] {
  return cubics.map((c) => (isFlat(c) ? line(c[0], c[3]) : c))
}

function polygon(pts: Pt[], closed: boolean): Cubic[] {
  const out: Cubic[] = []
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) out.push(line(pts[i], pts[(i + 1) % pts.length]))
  return out
}

/** About one point per pixel of length, so every measure below is in px. */
function resample(points: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = []
  const m = closed ? points.length : points.length - 1
  for (let i = 0; i < m; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const k = Math.max(1, Math.ceil(dist(a, b)))
    for (let s = 0; s < k; s++) out.push({ x: a.x + ((b.x - a.x) * s) / k, y: a.y + ((b.y - a.y) * s) / k })
  }
  if (!closed && points.length) out.push(points[points.length - 1])
  return out
}

// ---- Corners ---------------------------------------------------------------------

type Corner = { index: number; at: Pt }

/**
 * The point `ds` px along the chain from sample i (negative = backwards).
 * Open chains stop at their ends; `null` means the chain ran out.
 */
function along(pts: Pt[], closed: boolean, i: number, ds: number): Pt | null {
  const n = pts.length
  let k = i
  let left = Math.abs(ds)
  const step = ds >= 0 ? 1 : -1
  while (left > 1e-9) {
    const next = k + step
    if (!closed && (next < 0 || next >= n)) return null
    const a = pts[k]
    const b = pts[(next + n) % n]
    const l = dist(a, b)
    if (l >= left) return add(a, mul(sub(b, a), left / l))
    left -= l
    k = (next + n) % n
  }
  return pts[k]
}

/** How far the chain turns at sample i over r px each side, in degrees; null near an open end. */
function turn(pts: Pt[], closed: boolean, i: number, r: number) {
  const p = pts[i]
  const before = along(pts, closed, i, -r)
  const after = along(pts, closed, i, r)
  if (!before || !after) return null
  const a = norm(sub(p, before))
  const b = norm(sub(after, p))
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI
}

function findCorners(pts: Pt[], closed: boolean, cornerAngle: number): Corner[] {
  const n = pts.length
  const score = new Array<number>(n).fill(0)
  // Crisp corners keep their angle all the way in; rounded tips (a blurred or
  // upscaled source) don't, and squaring those off adds a notch instead.
  const crisp = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const wide = turn(pts, closed, i, R)
    if (wide === null || wide < cornerAngle) continue
    // A curve turns half as much over half the distance; a corner keeps most of its turn.
    const narrow = turn(pts, closed, i, R / 2)
    if (narrow === null || narrow < 0.6 * wide) continue
    score[i] = wide
    crisp[i] = narrow >= 0.85 * wide ? 1 : 0
  }
  // Keep only the sharpest point within R of each candidate.
  const corners: Corner[] = []
  for (let i = 0; i < n; i++) {
    if (!score[i]) continue
    let best = true
    for (let k = -R; k <= R && best; k++) {
      if (k === 0) continue
      let j = i + k
      if (closed) j = (j + n) % n
      else if (j < 0 || j >= n) continue
      if (score[j] > score[i] || (score[j] === score[i] && j < i)) best = false
    }
    if (best) corners.push({ index: i, at: crisp[i] ? sharpen(pts, closed, i) : pts[i] })
  }
  // Two corners within R px of each other (a tip blunted by blur, measured as
  // two) are one corner: keep the sharper, so a point stays a point.
  const kept = corners.filter((c) => !corners.some((o) => o !== c && dist(o.at, c.at) < R && (score[o.index] > score[c.index] || (score[o.index] === score[c.index] && o.index < c.index))))
  return kept
}

/**
 * Anti-aliasing rounds every corner by a pixel or so. Fit a line to each side
 * just beyond the rounding and put the corner where they cross, unless that is
 * implausibly far away (nearly parallel sides) or the chain is too short.
 */
function sharpen(pts: Pt[], closed: boolean, i: number): Pt {
  const p = pts[i]
  const a0 = along(pts, closed, i, -2.5 * R)
  const a1 = along(pts, closed, i, -R / 2)
  const b0 = along(pts, closed, i, R / 2)
  const b1 = along(pts, closed, i, 2.5 * R)
  if (!a0 || !a1 || !b0 || !b1) return p
  const x = intersect(a0, a1, b0, b1)
  return x && dist(x, p) < R / 2 ? x : p
}

function intersect(a0: Pt, a1: Pt, b0: Pt, b1: Pt): Pt | null {
  const d1 = sub(a1, a0)
  const d2 = sub(b1, b0)
  const den = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((b0.x - a0.x) * d2.y - (b0.y - a0.y) * d2.x) / den
  return add(a0, mul(d1, t))
}

// ---- Smoothing -----------------------------------------------------------------

/**
 * Smoothing over ±half points, in two strengths for two jobs:
 *
 *  - `flat`: a plain moving average. It removes the pixel staircase and JPEG
 *    ripple (colour is stored in 16 px blocks) almost completely, which is
 *    what deciding "is this run straight?" needs. It also pulls curves inwards
 *    (a 20 px dot loses 8% of its area), so it is never fitted to.
 *  - `true`: the same average "twiced" (Tukey): smooth, then smooth what was
 *    removed and add it back. The staircase stays gone and a curve keeps its
 *    size, which is what curve fitting needs.
 *
 * Small outlines get a window of at most a sixteenth of their length. An open
 * run keeps its ends and the window shrinks symmetrically near them, so it never
 * reaches past a corner; a loop wraps around (its last point repeats its first).
 */
function smooth(run: Pt[], loop: boolean, half: number): { flat: Pt[]; true: Pt[] } {
  const n = run.length
  const h = Math.max(0, Math.min(Math.round(half), Math.floor(n / 16)))
  if (!h || n < 4) return { flat: run, true: run }
  const m = loop ? n - 1 : n
  const avg = (src: Pt[]) =>
    src.map((p, i) => {
      if (!loop && (i === 0 || i === m - 1)) return p
      const reach = loop ? h : Math.min(h, i, m - 1 - i)
      let x = 0
      let y = 0
      for (let k = -reach; k <= reach; k++) {
        const q = src[loop ? (((i + k) % m) + m) % m : i + k]
        x += q.x
        y += q.y
      }
      return { x: x / (2 * reach + 1), y: y / (2 * reach + 1) }
    })
  const base = run.slice(0, m)
  const once = avg(base)
  const back = avg(base.map((p, i) => ({ x: p.x - once[i].x, y: p.y - once[i].y })))
  const twiced = once.map((p, i) => ({ x: p.x + back[i].x, y: p.y + back[i].y }))
  const close = (pts: Pt[]) => (loop ? [...pts, pts[0]] : pts)
  // On gentle curves the plain average shrinks by under 0.15 px (≈ h²κ/6 for
  // curvature κ) and is cleaner, so curves use it there too; tight curves use
  // the twiced points.
  const shrink = (h * h * meanCurvature(once, loop, h)) / 6
  return { flat: close(once), true: close(shrink < 0.15 ? once : twiced) }
}

/** Mean absolute curvature (1/px) of a run, from directions sampled every `step` points. */
function meanCurvature(pts: Pt[], loop: boolean, step: number) {
  const s = Math.max(1, step)
  const n = pts.length
  let turn = 0
  let length = 0
  let prev: Pt | null = null
  const end = loop ? n : n - s
  for (let i = 0; i < end; i += s) {
    const a = pts[i]
    const b = pts[loop ? (i + s) % n : i + s]
    const d = sub(b, a)
    const l = len(d)
    if (l < 1e-9) continue
    length += l
    const dir = mul(d, 1 / l)
    if (prev) turn += Math.acos(Math.max(-1, Math.min(1, dot(prev, dir))))
    prev = dir
  }
  return length > 0 ? turn / length : 0
}

// ---- Fitting ---------------------------------------------------------------------

/** A run between two fixed points: a line if it is one, else curves with free end tangents. */
function fitBetween(smoothed: { flat: Pt[]; true: Pt[] }, tolerance: number): Cubic[] {
  const run = smoothed.flat
  const a = run[0]
  const b = run[run.length - 1]
  // The last few px into a corner or junction are where anti-aliasing blurs
  // the outline most, so the line test ignores them: a straight edge stays one
  // line even when its ends are smudged.
  const trim = Math.min(END_TRIM, Math.floor(run.length / 4))
  if (run.length <= 2 || maxOffLine(run.slice(trim, run.length - trim), a, b) <= tolerance * LINE_BIAS) return [line(a, b)]
  const curve = smoothed.true
  // Like the line test, the curve fit forgives the last few px into each end,
  // so a corner doesn't sprout a second node a pixel or two beside it.
  return fitRun(curve, endTangent(curve, false), endTangent(curve, true), tolerance, 0, END_TRIM, END_TRIM)
}

function maxOffLine(run: Pt[], a: Pt, b: Pt) {
  const d = sub(b, a)
  const l = len(d)
  let worst = 0
  for (const p of run) {
    const off = l < 1e-9 ? dist(p, a) : Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x) / l
    if (off > worst) worst = off
  }
  return worst
}

/** Tangent at an end, pointing into the run, from the point R px in. */
function endTangent(run: Pt[], atEnd: boolean): Pt {
  const n = run.length
  const k = Math.min(n - 1, R)
  return atEnd ? norm(sub(run[n - 1 - k], run[n - 1])) : norm(sub(run[k], run[0]))
}

/** Schneider's recursive fit: one cubic, or split at the worst point and recurse. */
function fitRun(pts: Pt[], t1: Pt, t2: Pt, tolerance: number, depth = 0, skipStart = 0, skipEnd = 0): Cubic[] {
  const n = pts.length
  if (n === 2) {
    const d = dist(pts[0], pts[1]) / 3
    return [[pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]]
  }
  let u = chordParams(pts)
  let bez = generate(pts, u, t1, t2)
  let { error, split } = maxError(pts, bez, u, skipStart, skipEnd)
  const tol2 = tolerance * tolerance
  if (error <= tol2) return [bez]
  if (error <= tol2 * 4) {
    for (let it = 0; it < 4; it++) {
      u = u.map((ui, i) => newton(bez, pts[i], ui))
      bez = generate(pts, u, t1, t2)
      ;({ error, split } = maxError(pts, bez, u, skipStart, skipEnd))
      if (error <= tol2) return [bez]
    }
  }
  if (depth > 12 || n < 4) return [bez]
  split = Math.min(n - 2, Math.max(1, split))
  const tc = norm(sub(pts[split - 1], pts[split + 1]))
  return [
    ...fitRun(pts.slice(0, split + 1), t1, tc, tolerance, depth + 1, skipStart, 0),
    ...fitRun(pts.slice(split), mul(tc, -1), t2, tolerance, depth + 1, 0, skipEnd),
  ]
}

function chordParams(pts: Pt[]) {
  const u = [0]
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + dist(pts[i], pts[i - 1]))
  const total = u[u.length - 1] || 1
  return u.map((x) => x / total)
}

const B = [(t: number) => (1 - t) ** 3, (t: number) => 3 * t * (1 - t) ** 2, (t: number) => 3 * t * t * (1 - t), (t: number) => t ** 3]

export function pointAt(b: Cubic, t: number): Pt {
  return add(add(mul(b[0], B[0](t)), mul(b[1], B[1](t))), add(mul(b[2], B[2](t)), mul(b[3], B[3](t))))
}

/** Least-squares handle lengths along the given tangents (Schneider's GenerateBezier). */
function generate(pts: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const p0 = pts[0]
  const p3 = pts[pts.length - 1]
  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0
  for (let i = 0; i < pts.length; i++) {
    const a1 = mul(t1, B[1](u[i]))
    const a2 = mul(t2, B[2](u[i]))
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    const tmp = sub(pts[i], add(mul(p0, B[0](u[i]) + B[1](u[i])), mul(p3, B[2](u[i]) + B[3](u[i]))))
    x0 += dot(a1, tmp)
    x1 += dot(a2, tmp)
  }
  const det = c00 * c11 - c01 * c01
  let alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0
  let alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0
  const seg = dist(p0, p3)
  // Degenerate or backwards handles: fall back to a third of the chord.
  if (alpha1 < 1e-6 * seg || alpha2 < 1e-6 * seg) alpha1 = alpha2 = seg / 3
  return [p0, add(p0, mul(t1, alpha1)), add(p3, mul(t2, alpha2)), p3]
}

/** Worst squared distance, ignoring `skipStart` / `skipEnd` points at the ends. */
function maxError(pts: Pt[], b: Cubic, u: number[], skipStart = 0, skipEnd = 0) {
  let error = 0
  let split = Math.floor(pts.length / 2)
  const from = Math.max(1, Math.min(skipStart, Math.floor(pts.length / 4)))
  const to = pts.length - 1 - Math.min(skipEnd, Math.floor(pts.length / 4))
  for (let i = from; i < Math.max(from, to); i++) {
    const p = pointAt(b, u[i])
    const e = (p.x - pts[i].x) ** 2 + (p.y - pts[i].y) ** 2
    if (e >= error) {
      error = e
      split = i
    }
  }
  return { error, split }
}

/** One Newton–Raphson step towards the parameter of the point on `b` nearest `p`. */
function newton(b: Cubic, p: Pt, u: number) {
  const d1: Pt[] = [mul(sub(b[1], b[0]), 3), mul(sub(b[2], b[1]), 3), mul(sub(b[3], b[2]), 3)]
  const d2: Pt[] = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)]
  const q = pointAt(b, u)
  const q1 = add(add(mul(d1[0], (1 - u) ** 2), mul(d1[1], 2 * u * (1 - u))), mul(d1[2], u * u))
  const q2 = add(mul(d2[0], 1 - u), mul(d2[1], u))
  const num = dot(sub(q, p), q1)
  const den = dot(q1, q1) + dot(sub(q, p), q2)
  if (Math.abs(den) < 1e-12) return u
  return Math.min(1, Math.max(0, u - num / den))
}
