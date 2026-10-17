/**
 * Curve fitting: turn a pixel outline into the fewest straight lines and
 * curves that follow it, with sharp corners kept sharp.
 *
 * Input is a chain of points about one pixel apart: either an open run
 * between two fixed ends (a boundary between two colours, ending where a third
 * colour meets it) or a closed loop. The steps follow Potrace and Illustrator's
 * Image Trace in spirit:
 *
 *  1. Find the corners. A corner is two straight sides meeting at a point:
 *     fit a line to each side (3–9 px out, past the anti-aliased rounding)
 *     and require both to be straight, to turn by more than `cornerAngle`,
 *     and to meet close to the outline (implied rounding ≤ 1.5 px). That keeps
 *     curves, small circles and a stroke's 4 px round end from reading as
 *     corners, and puts each corner where its sides actually meet.
 *  2. Smooth the pixel staircase between corners, never across one: fully
 *     for deciding what is straight, and only as much as the local curvature
 *     allows for fitting curves, so tight bends keep their shape.
 *  3. Fit each run between corners: one straight line if every point is
 *     within 1.5× tolerance of it (straight edges are favoured). Otherwise
 *     find the straight stretches inside it, make those lines, and fit cubic
 *     Béziers between them by least squares (Schneider, "An Algorithm for
 *     Automatically Fitting Digitized Curves", Graphics Gems, 1990), joining
 *     the lines smoothly and turning at most ~90° per curve, as circles are
 *     drawn by hand. Curves that came out flat are written as lines.
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
    const smoothed = smooth([...pts, pts[0]], true, o.smoothing ?? SMOOTH)
    const run = smoothed.true
    const t = norm(sub(run[1], run[run.length - 2]))
    return flatten(fitMixed(smoothed, o.tolerance, t, mul(t, -1), 0))
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
    if (dist(a, b) < 1e-9) continue // repeated point
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

/** Px of chain available before (side -1) or after (side 1) sample i. Points are ≈ 1 px apart. */
const room = (n: number, closed: boolean, i: number, side: -1 | 1) => (closed ? Infinity : side < 0 ? i : n - 1 - i)

/**
 * How far the chain turns at sample i over r px each side, in degrees. Near an
 * open chain's end (a junction, where a peak often sits) it measures over what
 * is there, down to MIN_REACH px; null when even that is missing.
 */
function turn(pts: Pt[], closed: boolean, i: number, r: number) {
  const p = pts[i]
  const reach = Math.min(r, room(pts.length, closed, i, -1), room(pts.length, closed, i, 1))
  if (reach < Math.min(r, MIN_REACH)) return null
  const before = along(pts, closed, i, -reach)
  const after = along(pts, closed, i, reach)
  if (!before || !after) return null
  const a = norm(sub(p, before))
  const b = norm(sub(after, p))
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180) / Math.PI
}

function findCorners(pts: Pt[], closed: boolean, cornerAngle: number, maxRounding = MAX_ROUNDING): Corner[] {
  const n = pts.length
  const score = new Array<number>(n).fill(0)
  const meet: (Pt | null)[] = new Array(n).fill(null)
  // Sides are measured on a lightly smoothed copy, so pixel steps along a
  // straight edge don't read as bending.
  const sm = lightly(pts, closed)
  for (let i = 0; i < n; i++) {
    const wide = turn(pts, closed, i, R)
    if (wide === null || wide < cornerAngle) continue
    // A corner is two straight sides meeting at a point. Fit a line to each
    // side (3–9 px out, past the anti-aliased rounding) and require them to
    // be straight, to meet at the corner's own angle, and to cross within
    // 3 px of it. A curve's sides bend; a stroke's round end has sides that
    // run parallel; both fail, where measuring the turn alone could not tell
    // a 4 px round end from two right angles.
    const a = arm(sm, closed, i, -1)
    const b = arm(sm, closed, i, 1)
    if (!a || !b || a.rms > ARM_RMS || a.bend > ARM_BEND || b.rms > ARM_RMS || b.bend > ARM_BEND) continue
    // Both directions point away from the corner: straight on is 180° between them.
    const interior = (Math.acos(Math.max(-1, Math.min(1, dot(a.dir, b.dir)))) * 180) / Math.PI
    const bend = 180 - interior
    if (bend < cornerAngle) continue
    const x = intersect(a.at, add(a.at, a.dir), b.at, add(b.at, b.dir))
    if (!x || dist(x, pts[i]) > R / 2) continue
    // How rounded is it? An outline that misses the meeting point by d at an
    // interior angle θ is rounded with radius d / (1/sin(θ/2) − 1). Anti-aliasing
    // rounds a real corner by about a pixel; a stroke's round end by its
    // half-width (4 px on the sample's arc), which is a curve, not a corner.
    let d = Infinity
    for (let k = -R; k <= R; k++) {
      const j = closed ? (((i + k) % n) + n) % n : i + k
      if (j >= 0 && j < n) d = Math.min(d, dist(pts[j], x))
    }
    const half = ((interior / 2) * Math.PI) / 180
    const rounding = d / Math.max(1e-6, 1 / Math.sin(half) - 1)
    // A wide corner magnifies noise in that formula (at 120°, half a pixel of
    // JPEG error reads as 3 px of rounding), so an outline that passes within
    // 0.75 px of the meeting point is a corner however wide it is.
    if (rounding > maxRounding && d > 0.75) continue
    score[i] = bend
    meet[i] = x
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
    // The corner goes where the two sides meet, undoing the anti-aliased rounding.
    if (best) corners.push({ index: i, at: meet[i]! })
  }
  // Two corners within R px of each other (a tip blunted by blur, measured as
  // two) are one corner: keep the sharper, so a point stays a point.
  return corners.filter((c) => !corners.some((o) => o !== c && dist(o.at, c.at) < R && (score[o.index] > score[c.index] || (score[o.index] === score[c.index] && o.index < c.index))))
}

/** ±2-point moving average; an open chain keeps its ends. Same length and indices as the input. */
function lightly(pts: Pt[], closed: boolean): Pt[] {
  const n = pts.length
  if (n < 6) return pts
  return pts.map((p, i) => {
    const reach = closed ? 2 : Math.min(2, i, n - 1 - i)
    if (!reach) return p
    let x = 0
    let y = 0
    for (let k = -reach; k <= reach; k++) {
      const q = pts[(((i + k) % n) + n) % n]
      x += q.x
      y += q.y
    }
    return { x: x / (2 * reach + 1), y: y / (2 * reach + 1) }
  })
}

const MIN_REACH = 4 // px: the least chain a corner can be measured on, near a junction
const ARM_RMS = 0.6 // px: how far a corner's side may wander from a straight line
const ARM_BEND = 14 // degrees: how much a corner's side may change direction along its length
const MAX_ROUNDING = 1.5 // px: a bend rounded more than this is a curve

/**
 * A least-squares line through the chain from R/2 to 1.5R px before (side -1)
 * or after (side 1) sample i: a point on it, its direction pointing away from
 * i, and the RMS distance of the points from it. Null near an open end.
 */
function arm(pts: Pt[], closed: boolean, i: number, side: -1 | 1) {
  // Near an open end, the side is whatever chain is left (at least MIN_REACH px).
  const avail = room(pts.length, closed, i, side)
  if (avail < MIN_REACH) return null
  const reach = Math.min(1.5 * R, avail)
  const sample: Pt[] = []
  for (let d = Math.min(R / 2, reach / 3); d <= reach + 1e-9; d += 1) {
    const p = along(pts, closed, i, side * d)
    if (!p) break
    sample.push(p)
  }
  if (sample.length < 3) return null
  const cx = sample.reduce((s, p) => s + p.x, 0) / sample.length
  const cy = sample.reduce((s, p) => s + p.y, 0) / sample.length
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of sample) {
    sxx += (p.x - cx) ** 2
    sxy += (p.x - cx) * (p.y - cy)
    syy += (p.y - cy) ** 2
  }
  // Principal direction of the points.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let dir = { x: Math.cos(theta), y: Math.sin(theta) }
  const outward = sub(sample[sample.length - 1], sample[0])
  if (dot(dir, outward) < 0) dir = mul(dir, -1)
  const rms = Math.sqrt(sample.reduce((s, p) => s + ((p.x - cx) * dir.y - (p.y - cy) * dir.x) ** 2, 0) / sample.length)
  // Direction of the near half against the far half: a side that curves away
  // (an arc leaving a round end) bends; a straight side doesn't.
  const mid = Math.floor(sample.length / 2)
  const near = norm(sub(sample[mid], sample[0]))
  const far = norm(sub(sample[sample.length - 1], sample[mid]))
  const bend = (Math.acos(Math.max(-1, Math.min(1, dot(near, far)))) * 180) / Math.PI
  return { at: { x: cx, y: cy }, dir, rms, bend }
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
 * Smoothing over the pixel staircase, in two versions for two jobs:
 *
 *  - `flat`: a moving average over ±half points everywhere. It removes the
 *    staircase and JPEG ripple (colour is stored in 16 px blocks) almost
 *    completely, which is what deciding "is this run straight?" needs. It also
 *    pulls curves inwards, so it is never fitted to.
 *  - `true`: the same average, but each point's window is only as wide as the
 *    curvature around it allows. Averaging over ±h on a curve of radius ρ pulls
 *    it in by about h²/6ρ, so the window is held to √(0.9ρ) (≤ 0.15 px of
 *    shrink) and never reaches a tighter spot than its own: a long gentle arc
 *    is smoothed fully while its 4 px round end keeps its shape. This is what
 *    curves are fitted to.
 *
 * An open run keeps its ends and the window shrinks symmetrically near them,
 * so it never reaches past a corner; a loop wraps around (its last point
 * repeats its first).
 */
type Smoothed = {
  flat: Pt[]
  true: Pt[]
  /** Tightest radius of curvature in the run, px. */
  minRadius: number
  /** Radius of curvature at each point (median-filtered), px; same indices as `true`. */
  radius: Float64Array
}

function smooth(run: Pt[], loop: boolean, half: number): Smoothed {
  const n = run.length
  // A small closed outline (a dot) shrinks under a wide window, so loops get
  // at most a sixteenth of their length. An open run's ends are pinned, so it
  // can take a quarter: short boundaries between junctions (a peak meeting
  // two colours) need smoothing most, or their pixel steps become bumps.
  const h = Math.max(0, Math.min(Math.round(half), Math.floor(n / (loop ? 16 : 4))))
  if (!h || n < 4) return { flat: run, true: run, minRadius: Infinity, radius: new Float64Array(n).fill(1e9) }
  const m = loop ? n - 1 : n
  const base = run.slice(0, m)
  const at = (i: number) => base[loop ? ((i % m) + m) % m : Math.max(0, Math.min(m - 1, i))]
  const avg = (reachOf: (i: number) => number) =>
    base.map((p, i) => {
      if (!loop && (i === 0 || i === m - 1)) return p
      const reach = loop ? reachOf(i) : Math.min(reachOf(i), i, m - 1 - i)
      if (reach <= 0) return p
      let x = 0
      let y = 0
      for (let k = -reach; k <= reach; k++) {
        const q = at(i + k)
        x += q.x
        y += q.y
      }
      return { x: x / (2 * reach + 1), y: y / (2 * reach + 1) }
    })
  const flat = avg(() => h)

  // Local radius of curvature, from lightly smoothed points: the turn between
  // the chords r points either side is about r/ρ radians.
  const r = 5
  const light = avg(() => Math.min(h, 2))
  const lat = (i: number) => light[loop ? ((i % m) + m) % m : Math.max(0, Math.min(m - 1, i))]
  // Measured at two scales, keeping the larger radius. Over 5 px, half a
  // pixel of JPEG noise reads as a tight bend and makes a 270 px circle look
  // like radius 30; over 15 px the noise mostly averages out. A real tight
  // bend (a round end) is tight at both scales, so the larger one is right.
  const radiusAt = (i: number, span: number) => {
    const a = norm(sub(lat(i), lat(i - span)))
    const b = norm(sub(lat(i + span), lat(i)))
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(a, b))))
    return turn > 1e-6 ? span / turn : 1e9
  }
  const raw = new Float64Array(m)
  for (let i = 0; i < m; i++) raw[i] = Math.max(radiusAt(i, r), radiusAt(i, 3 * r))
  // A 7-point running median: a real tight bend (a round end) spans a dozen
  // points, a pixel step's spike one or two.
  const allow = new Int32Array(m)
  const radius = new Float64Array(loop ? m + 1 : m)
  let minRadius = Infinity
  for (let i = 0; i < m; i++) {
    const win: number[] = []
    for (let k = -3; k <= 3; k++) {
      const j = loop ? (((i + k) % m) + m) % m : Math.max(0, Math.min(m - 1, i + k))
      win.push(raw[j])
    }
    win.sort((x, y) => x - y)
    const rho = win[3]
    radius[i] = rho
    if (rho < minRadius) minRadius = rho
    allow[i] = Math.min(h, Math.floor(Math.sqrt(0.9 * rho)))
  }
  // A window may not reach a point that allows less than the distance to it.
  const reachAt = (i: number) => {
    let reach = allow[i]
    for (let k = 1; k <= h + 1 && k - 1 < reach; k++) {
      for (const j of [i - k, i + k]) {
        if (!loop && (j < 0 || j >= m)) continue
        const aj = allow[((j % m) + m) % m]
        if (aj < reach) reach = Math.max(aj, k - 1)
      }
    }
    return reach
  }
  const fitted = avg(reachAt)
  const close = (pts: Pt[]) => (loop ? [...pts, pts[0]] : pts)
  if (loop) radius[m] = radius[0]
  return { flat: close(flat), true: close(fitted), minRadius, radius }
}

// ---- Fitting ---------------------------------------------------------------------

/** A run between two fixed points: a line if it is one, else curves with free end tangents. */
function fitBetween(smoothed: Smoothed, tolerance: number): Cubic[] {
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
  return fitMixed(smoothed, tolerance, endTangent(curve, false), endTangent(curve, true), END_TRIM)
}

/**
 * A run that is neither one line nor one smooth curve, like a stroke's
 * straight side running into its round end. Find the straight stretches first
 * (at least MIN_LINE px, every point within tolerance), make each a line, and
 * fit curves only between them, leaving and arriving along the lines' own
 * directions so every join is smooth. Without this a curve would cover the
 * end of the straight and the bend together and overshoot the bend.
 */
function fitMixed(s: Smoothed, tolerance: number, t1: Pt, t2: Pt, skipEnds: number): Cubic[] {
  const flat = s.flat
  const curve = s.true
  const n = flat.length
  const tol = curveTolerance(tolerance, s.minRadius)
  // Grown on the shape-true points: they are fully smoothed along straight
  // stretches anyway, and unlike the flat ones they don't sag near a bend.
  const lines = straights(curve, s.radius, tolerance)
  if (!lines.length) return fitRun(curve, t1, t2, tol, 0, skipEnds, skipEnds)

  const out: Cubic[] = []
  // Curve pieces between the lines; the run's own ends keep their tangents.
  let from = 0
  let tFrom = t1
  let fromAt = curve[0]
  for (const [i, j] of lines) {
    const a = curve[i]
    const b = curve[j]
    const dir = norm(sub(b, a))
    if (i > from) {
      const piece = curve.slice(from, i + 1)
      piece[0] = fromAt
      piece[piece.length - 1] = a
      out.push(...fitRun(piece, tFrom, mul(dir, -1), tol, 0, from === 0 ? skipEnds : 0, 0))
    }
    out.push(line(i > from ? a : fromAt, b))
    from = j
    fromAt = b
    tFrom = dir
  }
  if (from < n - 1) {
    const piece = curve.slice(from)
    piece[0] = fromAt
    out.push(...fitRun(piece, tFrom, t2, tol, 0, 0, skipEnds))
  } else if (out.length) out[out.length - 1] = line(out[out.length - 1][0], curve[n - 1])
  return out
}

const MAX_SWEEP = 100 // degrees one cubic may turn through
const MIN_LINE = 12 // px: shorter straight stretches are left to the curve fit

/**
 * Maximal straight stretches [start, end] (indices), greedily from the start.
 * They are grown on the ripple-free points, then each end is trimmed back
 * until the shape-true outline sits on the line (within 0.3 px): otherwise a
 * line would run a few px into the bend that follows and chamfer it.
 */
function straights(exact: Pt[], radius: Float64Array, tolerance: number): [number, number][] {
  const n = exact.length
  // Within tolerance of the chord, and not bowed to one side: an arc bows all
  // along, a straight edge's ripple averages out, so a gentle curve that
  // happens to fit within tolerance is still left to the curve fit.
  const straight = (i: number, j: number) => {
    const a = exact[i]
    const d = norm(sub(exact[j], a))
    let worst = 0
    let bow = 0
    for (let k = i + 1; k < j; k++) {
      const o = (exact[k].x - a.x) * d.y - (exact[k].y - a.y) * d.x
      worst = Math.max(worst, Math.abs(o))
      bow += o
    }
    return worst <= tolerance && Math.abs(bow / Math.max(1, j - i - 1)) <= 0.12
  }
  const found: [number, number][] = []
  let i = 0
  while (i < n - MIN_LINE) {
    let j = i + MIN_LINE
    if (!straight(i, j)) {
      i++
      continue
    }
    // Grow until the next point would break either rule.
    while (j + 1 < n && straight(i, j + 1)) j++
    // Then trim each end back to where the outline actually sits on the line
    // (within 0.3 px), so the line doesn't chamfer the bend that follows.
    const a = exact[i]
    const d = norm(sub(exact[j], a))
    const off = (p: Pt) => Math.abs((p.x - a.x) * d.y - (p.y - a.y) * d.x)
    let s = i
    let e = j
    while (e - s > MIN_LINE && off(exact[s]) > 0.3) s++
    while (e - s > MIN_LINE && off(exact[e]) > 0.3) e--
    // A pixelated circle has flat runs about 2√r px long at its top, bottom
    // and sides, which are not edges. A real straight edge is long compared
    // with the curves either side of it (a stroke's 80 px side next to its
    // 4 px round end), so it must be at least 2.5√r for the curve beside it.
    // The same goes for its own curvature: 20 px of a big gentle arc is within
    // half a pixel of straight, but it is still part of the arc.
    const beside = [s - R, e + R].filter((k) => k >= 0 && k < n).map((k) => radius[k])
    const own = [...radius.slice(s + 1, e)].sort((x, y) => x - y)[Math.floor((e - s - 1) / 2)] ?? 1e9
    const context = beside.length ? Math.min(own, Math.max(...beside)) : own
    const needed = 2.5 * Math.sqrt(Math.min(1e6, context))
    if (e - s >= MIN_LINE && dist(exact[s], exact[e]) >= needed) found.push([s, e])
    i = j
  }
  return found
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

/**
 * A 1 px tolerance lets one curve cut across a bend only 4 px in radius (the
 * round end of a stroke) and overshoot it, which reads as a hook. Runs with a
 * tight bend are fitted to a fraction of their tightest radius instead.
 */
const curveTolerance = (tolerance: number, minRadius: number) => Math.min(tolerance, Math.max(0.3, minRadius / 8))

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
  // One cubic per quarter turn at most, the way circles are drawn by hand: a
  // single cubic across half a circle can stay within tolerance and still look
  // squashed. t2 points backwards from the end, so straight on is t1 = -t2.
  const sweep = (Math.acos(Math.max(-1, Math.min(1, -dot(t1, t2)))) * 180) / Math.PI
  if (sweep > MAX_SWEEP && n >= 8 && depth <= 12) {
    const mid = Math.floor(n / 2)
    const span = Math.min(3, mid, n - 1 - mid)
    const tm = norm(sub(pts[mid - span], pts[mid + span]))
    return [
      ...fitRun(pts.slice(0, mid + 1), t1, tm, tolerance, depth + 1, skipStart, 0),
      ...fitRun(pts.slice(mid), mul(tm, -1), t2, tolerance, depth + 1, 0, skipEnd),
    ]
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
  // The tangent where two curves meet, from a few points either side: one
  // point either side is too noisy and leaves a visible kink or hook.
  const span = Math.min(3, split, n - 1 - split)
  const tc = norm(sub(pts[split - span], pts[split + span]))
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
