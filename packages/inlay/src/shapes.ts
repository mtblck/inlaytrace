/**
 * Shape fitting: recognise a closed outline as a circle, an ellipse, a
 * (rounded) rectangle or a regular polygon, and draw that shape exactly.
 *
 * Only closed chains are candidates: an outline with a single neighbour all the
 * way round, so replacing its curves changes both sides of the edge together
 * and shapes still tile. The parameters come from the pixel region itself, not
 * from guesses at corners: its area, centroid and second moments (exact for a
 * pixel outline, and unbiased by the staircase) give an ellipse's axes and
 * angle, a rectangle's sides and a polygon's size directly. Each candidate is
 * then checked against the outline (the midpoints of its pixel edges, which sit
 * within ~0.35 px of a true edge) and accepted only if it fits closely
 * everywhere, so a blob that is nearly round stays a fitted curve.
 *
 * Exact here means exactly the fitted geometry: lines meet at true right angles
 * or a regular polygon's angles, and an ellipse is its four standard quarter
 * arcs (within 0.03% of the radius of a true ellipse).
 */
import type { Cubic } from './fit'
import type { Pt } from './path'

export type ShapeKind = 'circle' | 'ellipse' | 'rectangle' | 'rounded-rectangle' | 'polygon'

/** How closely an outline must follow a shape: RMS and worst distance, in px, of its pixel-edge midpoints. */
const MAX_RMS = 0.3
const MAX_OFF = 0.85
/** An ellipse whose axes differ by less than this is drawn as a circle. */
const ROUND = 0.015
const KAPPA = 0.5522847498307936 // handle length of a quarter circle, per unit radius

type Frame = { cx: number; cy: number; area: number; m20: number; m02: number; m11: number }

/** Area, centroid and central second moments (per unit area) of a closed polygon. */
function moments(pts: Pt[]): Frame | null {
  let a = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const c = p.x * q.y - q.x * p.y
    a += c
    sx += (p.x + q.x) * c
    sy += (p.y + q.y) * c
    sxx += (p.x * p.x + p.x * q.x + q.x * q.x) * c
    syy += (p.y * p.y + p.y * q.y + q.y * q.y) * c
    sxy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * c
  }
  a /= 2
  if (Math.abs(a) < 1) return null
  const cx = sx / (6 * a)
  const cy = sy / (6 * a)
  return {
    cx,
    cy,
    area: Math.abs(a),
    m20: sxx / (12 * a) - cx * cx,
    m02: syy / (12 * a) - cy * cy,
    m11: sxy / (24 * a) - cx * cy,
  }
}

/** The principal axes: the larger and smaller variance and the angle of the larger. */
function principal(f: Frame) {
  const d = Math.hypot((f.m20 - f.m02) / 2, f.m11)
  const mid = (f.m20 + f.m02) / 2
  return { big: mid + d, small: mid - d, angle: 0.5 * Math.atan2(2 * f.m11, f.m20 - f.m02) }
}

/** The midpoint of every unit pixel edge of a crack outline: within ~0.35 px of the true edge. */
function midpoints(pts: Pt[]): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)))
    for (let s = 0; s < n; s++) out.push({ x: a.x + ((b.x - a.x) * (s + 0.5)) / n, y: a.y + ((b.y - a.y) * (s + 0.5)) / n })
  }
  return out
}

/** Whether every point is close to a shape, given its distance function. */
function fits(points: Pt[], distance: (p: Pt) => number) {
  let sum = 0
  for (const p of points) {
    const d = Math.abs(distance(p))
    if (d > MAX_OFF) return false
    sum += d * d
  }
  return Math.sqrt(sum / points.length) <= MAX_RMS
}

/** Into a frame centred on (cx, cy) and turned by `angle`. */
const local = (p: Pt, cx: number, cy: number, cos: number, sin: number) => {
  const dx = p.x - cx
  const dy = p.y - cy
  return { u: dx * cos + dy * sin, v: -dx * sin + dy * cos }
}
const world = (u: number, v: number, cx: number, cy: number, cos: number, sin: number): Pt => ({ x: cx + u * cos - v * sin, y: cy + u * sin + v * cos })

const lineTo = (a: Pt, b: Pt): Cubic => [a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 }, b]

/** A quarter arc of an axis-aligned ellipse in the local frame, from angle t to t + 90°. */
function quarter(cx: number, cy: number, cos: number, sin: number, a: number, b: number, ox: number, oy: number, t: number): Cubic {
  const c0 = Math.cos(t)
  const s0 = Math.sin(t)
  const c1 = Math.cos(t + Math.PI / 2)
  const s1 = Math.sin(t + Math.PI / 2)
  const p = (u: number, v: number) => world(ox + u, oy + v, cx, cy, cos, sin)
  return [p(a * c0, b * s0), p(a * c0 - KAPPA * a * s0, b * s0 + KAPPA * b * c0), p(a * c1 + KAPPA * a * s1, b * s1 - KAPPA * b * c1), p(a * c1, b * s1)]
}

const signedArea = (cubics: Cubic[]) => cubics.reduce((s, [a, , , d]) => s + a.x * d.y - d.x * a.y, 0)
const reversed = (cubics: Cubic[]): Cubic[] => cubics.map(([a, b, c, d]) => [d, c, b, a] as Cubic).reverse()

/**
 * The exact shape a closed crack outline is, if it is one, as cubics running
 * the same way round as the outline; otherwise null. `corners` are the corner
 * points the fitter found on it (a polygon's vertices; usually none for a round shape).
 */
export function fitShape(pts: Pt[], corners: Pt[]): { kind: ShapeKind; cubics: Cubic[] } | null {
  const f = moments(pts)
  if (!f) return null
  const mids = midpoints(pts)
  const p = principal(f)
  // Corners first; but the ends of a narrow ellipse can read as corners, so
  // the round shapes are tried whatever was found.
  const shape = (corners.length >= 3 ? withCorners(f, corners, mids) : null) ?? roundShape(f, p, mids)
  if (!shape) return null
  // Same direction round as the outline, so holes stay holes.
  let area = 0
  for (let i = 0; i < pts.length; i++) area += pts[i].x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * pts[i].y
  if (Math.sign(signedArea(shape.cubics)) !== Math.sign(area)) shape.cubics = reversed(shape.cubics)
  return shape
}

function roundShape(f: Frame, p: ReturnType<typeof principal>, mids: Pt[]): { kind: ShapeKind; cubics: Cubic[] } | null {
  const cos = Math.cos(p.angle)
  const sin = Math.sin(p.angle)
  // An ellipse with semi-axes a, b has variances a²/4 and b²/4.
  let a = 2 * Math.sqrt(Math.max(0, p.big))
  let b = 2 * Math.sqrt(Math.max(0, p.small))
  if (b >= 2.5) {
    const circle = (a - b) / a < ROUND
    if (circle) a = b = Math.sqrt(f.area / Math.PI)
    // Sampson distance to the ellipse: the implicit function over its gradient.
    const off = (q: Pt) => {
      const { u, v } = local(q, f.cx, f.cy, cos, sin)
      const F = (u * u) / (a * a) + (v * v) / (b * b) - 1
      const g = 2 * Math.hypot(u / (a * a), v / (b * b))
      return g > 1e-12 ? F / g : Infinity
    }
    if (fits(mids, off)) {
      const cubics = [0, 1, 2, 3].map((k) => quarter(f.cx, f.cy, cos, sin, a, b, 0, 0, (k * Math.PI) / 2))
      return { kind: circle ? 'circle' : 'ellipse', cubics }
    }
  }

  // A rounded rectangle: its sides from the outline's extent along the
  // principal axes, its corner radius from how much area the corners lose.
  let hw = 0
  let hh = 0
  for (const q of mids) {
    const { u, v } = local(q, f.cx, f.cy, cos, sin)
    hw = Math.max(hw, Math.abs(u))
    hh = Math.max(hh, Math.abs(v))
  }
  const lost = 4 * hw * hh - f.area
  if (lost <= 0) return null
  const r = Math.sqrt(lost / (4 - Math.PI))
  if (r < 1.5 || hw - r < 1.5 || hh - r < 1.5) return null
  const off = (q: Pt) => {
    const { u, v } = local(q, f.cx, f.cy, cos, sin)
    const qx = Math.abs(u) - (hw - r)
    const qy = Math.abs(v) - (hh - r)
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
  }
  if (!fits(mids, off)) return null
  const at = (u: number, v: number) => world(u, v, f.cx, f.cy, cos, sin)
  const iw = hw - r
  const ih = hh - r
  const cubics: Cubic[] = []
  // Clockwise on screen from the top of the right side: side, corner, side, corner…
  const corners: [number, number, number][] = [
    [iw, ih, 0],
    [-iw, ih, Math.PI / 2],
    [-iw, -ih, Math.PI],
    [iw, -ih, (3 * Math.PI) / 2],
  ]
  corners.forEach(([ox, oy, t], k) => {
    const arc = quarter(f.cx, f.cy, cos, sin, r, r, ox, oy, t)
    if (k === 0) cubics.push(lineTo(at(hw, -ih), arc[0]))
    else cubics.push(lineTo(cubics[cubics.length - 1][3], arc[0]))
    cubics.push(arc)
  })
  // The last arc ends where the first side starts.
  return { kind: 'rounded-rectangle', cubics }
}

function withCorners(f: Frame, corners: Pt[], mids: Pt[]): { kind: ShapeKind; cubics: Cubic[] } | null {
  const k = corners.length
  if (k < 3 || k > 12) return null
  // Corners in order round the centre.
  const angles = corners.map((c) => Math.atan2(c.y - f.cy, c.x - f.cx))

  if (k === 4) {
    // A rectangle's angle from its sides (mod 90°), so a square, whose
    // moments have no preferred axis, still gets one; its size from the moments.
    let sx = 0
    let sy = 0
    for (let i = 0; i < 4; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 4]
      const t = 4 * Math.atan2(b.y - a.y, b.x - a.x)
      sx += Math.cos(t)
      sy += Math.sin(t)
    }
    const angle = Math.atan2(sy, sx) / 4
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    // Variances along that angle: a w × h rectangle has w²/12 and h²/12.
    const vu = f.m20 * cos * cos + 2 * f.m11 * cos * sin + f.m02 * sin * sin
    const vv = f.m20 * sin * sin - 2 * f.m11 * cos * sin + f.m02 * cos * cos
    const hw = Math.sqrt(3 * vu)
    const hh = Math.sqrt(3 * vv)
    if (hw < 1.5 || hh < 1.5) return null
    const off = (q: Pt) => {
      const { u, v } = local(q, f.cx, f.cy, cos, sin)
      const qx = Math.abs(u) - hw
      const qy = Math.abs(v) - hh
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0)
    }
    if (!fits(mids, off)) return null
    const c = [world(hw, -hh, f.cx, f.cy, cos, sin), world(hw, hh, f.cx, f.cy, cos, sin), world(-hw, hh, f.cx, f.cy, cos, sin), world(-hw, -hh, f.cx, f.cy, cos, sin)]
    return { kind: 'rectangle', cubics: c.map((a, i) => lineTo(a, c[(i + 1) % 4])) }
  }

  // A regular polygon: corners equally far out and equally spaced round the
  // centroid. Its size from the area (A = ½ k R² sin(360°/k)), its turn from the corners.
  const step = (2 * Math.PI) / k
  const R = Math.sqrt((2 * f.area) / (k * Math.sin(step)))
  if (R < 4) return null
  for (const c of corners) if (Math.abs(Math.hypot(c.x - f.cx, c.y - f.cy) - R) > Math.max(1, 0.04 * R)) return null
  let sx = 0
  let sy = 0
  for (const a of angles) {
    sx += Math.cos(a * k)
    sy += Math.sin(a * k)
  }
  const phase = Math.atan2(sy, sx) / k
  const vertices = Array.from({ length: k }, (_, i) => ({ x: f.cx + R * Math.cos(phase + i * step), y: f.cy + R * Math.sin(phase + i * step) }))
  const off = (q: Pt) => {
    // Distance to the nearest side.
    let best = Infinity
    for (let i = 0; i < k; i++) {
      const a = vertices[i]
      const b = vertices[(i + 1) % k]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / (dx * dx + dy * dy)))
      best = Math.min(best, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy))
    }
    return best
  }
  if (!fits(mids, off)) return null
  return { kind: 'polygon', cubics: vertices.map((a, i) => lineTo(a, vertices[(i + 1) % k])) }
}
