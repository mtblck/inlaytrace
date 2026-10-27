/**
 * Layers for flat art: which of two touching shapes is in front, and what the
 * one behind looks like where it is hidden.
 *
 * Cut out, a shape is only its visible pixels, so a moon behind a bar comes
 * out as two odd slivers. People drew a whole moon and expect one, and it
 * edits better whole too. The layered-vectorization papers (LIVE 2022 and
 * after) recover layers by optimising on a GPU; flat art needs much less,
 * because it shows the classic cues for what is in front (Kanizsa's good
 * continuation):
 *
 *  - **Order** from T-junctions: where a boundary between two shapes ends, the
 *    shape whose outline carries straight on is the occluder, and the one whose
 *    outline turns sharply there is behind it.
 *  - **Complete** each hidden run of a back shape's outline by continuing its
 *    visible outline: the circle its visible part lies on, the corner where its
 *    two straight sides would meet, or else a smooth curve leaving and arriving
 *    along its visible tangents. A completion is kept only if it stays hidden,
 *    inside the shapes in front.
 */
import { isFlat, line, pointAt, type Cubic } from './fit'
import type { Pt } from './path'

/** Under this turn (degrees) an outline carries straight on through a junction... */
export const SMOOTH = 20
/** ...and over this one it turns there. */
export const SHARP = 40

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const unit = (a: Pt): Pt | null => {
  const l = Math.hypot(a.x, a.y)
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : null
}

/** The direction a run of cubics leaves its first point in. */
export function startDir(cubics: Cubic[]): Pt | null {
  const [a, b, c, d] = cubics[0]
  return unit(sub(b, a)) ?? unit(sub(c, a)) ?? unit(sub(d, a))
}

/** The direction a run of cubics arrives at its last point in. */
export function endDir(cubics: Cubic[]): Pt | null {
  const [a, b, c, d] = cubics[cubics.length - 1]
  return unit(sub(d, c)) ?? unit(sub(d, b)) ?? unit(sub(d, a))
}

/** How far (degrees) an outline arriving along `u` turns to leave along `v`: 0 is straight on. */
export function turn(u: Pt, v: Pt): number {
  return (Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) * 180) / Math.PI
}

/** Whether a cubic's end is straight: its last (or first) cubic is flat. */
export const straightEnd = (cubics: Cubic[], atEnd: boolean) => isFlat(cubics[atEnd ? cubics.length - 1 : 0])

type Circle = { cx: number; cy: number; r: number }

/** The least-squares circle through `pts` (Kåsa's algebraic fit), or null if they are near a line. */
export function fitCircle(pts: Pt[]): Circle | null {
  if (pts.length < 5) return null
  // Centred for conditioning.
  let mx = 0
  let my = 0
  for (const p of pts) (mx += p.x), (my += p.y)
  mx /= pts.length
  my /= pts.length
  let suu = 0
  let suv = 0
  let svv = 0
  let suuu = 0
  let svvv = 0
  let suvv = 0
  let svuu = 0
  for (const p of pts) {
    const u = p.x - mx
    const v = p.y - my
    suu += u * u
    suv += u * v
    svv += v * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-9) return null
  const bu = (suuu + suvv) / 2
  const bv = (svvv + svuu) / 2
  const uc = (bu * svv - bv * suv) / det
  const vc = (bv * suu - bu * suv) / det
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / pts.length)
  return { cx: uc + mx, cy: vc + my, r }
}

/** An arc of `c` from p0 to p1, leaving p0 along `t0`, as cubics of at most a quarter turn each. */
function arc(c: Circle, p0: Pt, p1: Pt, t0: Pt): Cubic[] | null {
  const a0 = Math.atan2(p0.y - c.cy, p0.x - c.cx)
  const a1 = Math.atan2(p1.y - c.cy, p1.x - c.cx)
  // Increasing angle (clockwise on screen) leaves p0 along (-sin, cos).
  const dir = -Math.sin(a0) * t0.x + Math.cos(a0) * t0.y >= 0 ? 1 : -1
  let sweep = dir * (a1 - a0)
  while (sweep <= 0) sweep += 2 * Math.PI
  while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI
  const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-6))
  const step = (dir * sweep) / n
  const k = (4 / 3) * Math.tan(step / 4)
  const at = (a: number): Pt => ({ x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) })
  const out: Cubic[] = []
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step
    const e = s + step
    const ps = i === 0 ? p0 : at(s)
    const pe = i === n - 1 ? p1 : at(e)
    out.push([
      ps,
      { x: ps.x - k * c.r * Math.sin(s), y: ps.y + k * c.r * Math.cos(s) },
      { x: pe.x + k * c.r * Math.sin(e), y: pe.y - k * c.r * Math.cos(e) },
      pe,
    ])
  }
  return out
}

/** Where the line on from p0 along t0 meets the line back from p1 along t1, if ahead of both. */
function meet(p0: Pt, t0: Pt, p1: Pt, t1: Pt): Pt | null {
  const den = t0.x * t1.y - t0.y * t1.x
  if (Math.abs(den) < 0.05) return null
  const d = sub(p1, p0)
  const s = (d.x * t1.y - d.y * t1.x) / den
  const u = (t0.x * d.y - t0.y * d.x) / den
  const span = dist(p0, p1)
  if (s < 0.5 || u < 0.5 || s > 4 * span + 4 || u > 4 * span + 4) return null
  return { x: p0.x + s * t0.x, y: p0.y + s * t0.y }
}

/** How a circle fits `pts`: RMS and worst distance from it. */
function circleError(c: Circle, pts: Pt[]) {
  let sq = 0
  let worst = 0
  for (const p of pts) {
    const e = Math.abs(Math.hypot(p.x - c.cx, p.y - c.cy) - c.r)
    sq += e * e
    worst = Math.max(worst, e)
  }
  return { rms: Math.sqrt(sq / pts.length), worst }
}

/** The angle (radians) the points span round a centre: 2π less the widest gap between them. */
function spanned(c: Circle, pts: Pt[]) {
  const a = pts.map((p) => Math.atan2(p.y - c.cy, p.x - c.cx)).sort((x, y) => x - y)
  let gap = a[0] + 2 * Math.PI - a[a.length - 1]
  for (let i = 1; i < a.length; i++) gap = Math.max(gap, a[i] - a[i - 1])
  return 2 * Math.PI - gap
}

/** Points along cubics, about a pixel apart. */
export function sample(cubics: Cubic[]): Pt[] {
  const out: Pt[] = []
  for (const c of cubics) {
    const n = Math.max(2, Math.ceil(dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3])))
    for (let i = 0; i < n; i++) out.push(pointAt(c, i / n))
  }
  return out
}

/** A circle must fit the visible outline this closely (px)... */
const CIRCLE_RMS = 0.5
const CIRCLE_WORST = 1.5
/** ...and the visible outline span at least this much of it (radians). */
const CIRCLE_SPAN = Math.PI / 2
/** A completion may stray outside the shapes in front by this share of its length (fitting error near the ends). */
const STRAY = 0.05

/**
 * The hidden part of an outline, from p0 (where it goes under a shape in
 * front, arriving along t0) to p1 (where it comes out, leaving along t1), or
 * null if no continuation stays hidden. `visible` is the rest of the outline;
 * `straight0`/`straight1` say whether it is straight where it goes under and
 * comes out; `hidden(p)` whether a point is under a shape in front.
 */
export function complete(
  p0: Pt,
  t0: Pt,
  p1: Pt,
  t1: Pt,
  visible: Pt[],
  straight0: boolean,
  straight1: boolean,
  hidden: (p: Pt) => boolean,
): Cubic[] | null {
  const candidates: (Cubic[] | null)[] = []
  // A round shape: the circle its visible outline lies on.
  if (!straight0 && !straight1) {
    const c = fitCircle(visible)
    if (c && c.r > 2) {
      const e = circleError(c, visible)
      const ends = Math.max(Math.abs(dist(p0, { x: c.cx, y: c.cy }) - c.r), Math.abs(dist(p1, { x: c.cx, y: c.cy }) - c.r))
      if (e.rms < CIRCLE_RMS && e.worst < CIRCLE_WORST && ends < CIRCLE_WORST && spanned(c, visible) >= CIRCLE_SPAN) candidates.push(arc(c, p0, p1, t0))
    }
  }
  // Straight sides: on to where they meet.
  if (straight0 && straight1) {
    const q = meet(p0, t0, p1, t1)
    if (q) candidates.push([line(p0, q), line(q, p1)])
    else if (turn(t0, t1) < SMOOTH && turn(t0, unit(sub(p1, p0)) ?? t0) < SMOOTH) candidates.push([line(p0, p1)])
  }
  // Anything else: a curve leaving and arriving along the visible outline.
  const l = dist(p0, p1) / 3
  if (l > 0)
    candidates.push([
      [p0, { x: p0.x + t0.x * l, y: p0.y + t0.y * l }, { x: p1.x - t1.x * l, y: p1.y - t1.y * l }, p1],
    ])
  for (const c of candidates) {
    if (!c) continue
    const pts = sample(c)
    let out = 0
    for (const p of pts) if (!hidden(p)) out++
    if (out <= STRAY * pts.length) return c
  }
  return null
}
