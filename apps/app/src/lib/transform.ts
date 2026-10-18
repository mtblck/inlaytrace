/**
 * Geometry for editing whole shapes: exact bounds, scaling from a bounding-box
 * handle, and rectangle (marquee) selection of shapes and nodes.
 *
 * Everything works in the document's own units (pixels of the trace), the
 * same space as the path data, so nothing here knows about zoom.
 */
import { mapPoints, parsePath, serializePath, type NodeRef, type PathNode, type Pt, type Subpath } from './pathdata'

export type Box = { x: number; y: number; w: number; h: number }
/** x' = a·x + c·y + e, y' = b·x + d·y + f: SVG's matrix(a b c d e f). */
export type Affine = { a: number; b: number; c: number; d: number; e: number; f: number }

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
export const translate = (dx: number, dy: number): Affine => ({ ...IDENTITY, e: dx, f: dy })
const scaleAt = (sx: number, sy: number, ax: number, ay: number): Affine => ({ a: sx, b: 0, c: 0, d: sy, e: ax - sx * ax, f: ay - sy * ay })
export const apply = (m: Affine, p: Pt): Pt => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f })

/** Rotation by `degrees` (clockwise on screen, where y points down) about `at`. */
export function rotateAbout(at: Pt, degrees: number): Affine {
  const r = (degrees * Math.PI) / 180
  // Snap the quarter turns exactly, so four 90° turns put every point back where it was.
  const q = Math.round(degrees / 90)
  const exact = Math.abs(degrees - q * 90) < 1e-9
  const cos = exact ? [1, 0, -1, 0][((q % 4) + 4) % 4] : Math.cos(r)
  const sin = exact ? [0, 1, 0, -1][((q % 4) + 4) % 4] : Math.sin(r)
  return { a: cos, b: sin, c: -sin, d: cos, e: at.x - cos * at.x + sin * at.y, f: at.y - sin * at.x - cos * at.y }
}

/** The angle from `at` to `p`, in degrees, clockwise from pointing right. */
export const angleAt = (at: Pt, p: Pt) => (Math.atan2(p.y - at.y, p.x - at.x) * 180) / Math.PI

export function transformPath(d: string, m: Affine): string {
  return serializePath(mapPoints(parsePath(d), (p) => apply(m, p)))
}

/**
 * A path's geometry under a transform, and a stroke's width with it (by the
 * square root of the area scale), so a scaled centerline drawing keeps its
 * look: half the size, half the width.
 */
export function transformShape(p: { d: string; stroke?: number }, m: Affine): { d: string; stroke?: number } {
  const d = transformPath(p.d, m)
  return p.stroke ? { d, stroke: Math.round(p.stroke * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) * 100) / 100 } : { d }
}

// ---- Bounds ------------------------------------------------------------------

/**
 * The exact bounds of the drawn outline, not of its control points: a curve's
 * handles usually reach past the curve, and a box drawn round them would sit
 * visibly loose. Each cubic contributes its end points and its extrema.
 */
export function subsBounds(subs: Subpath[]): Box | null {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  const segment = (a: PathNode, b: PathNode) => {
    add(b.x, b.y)
    if (!a.out && !b.in) return
    const c1 = a.out ?? a
    const c2 = b.in ?? b
    for (const t of extrema(a.x, c1.x, c2.x, b.x)) add(cubic(a.x, c1.x, c2.x, b.x, t), cubic(a.y, c1.y, c2.y, b.y, t))
    for (const t of extrema(a.y, c1.y, c2.y, b.y)) add(cubic(a.x, c1.x, c2.x, b.x, t), cubic(a.y, c1.y, c2.y, b.y, t))
  }
  for (const s of subs) {
    const n = s.nodes
    if (!n.length) continue
    add(n[0].x, n[0].y)
    for (let i = 1; i < n.length; i++) segment(n[i - 1], n[i])
    if (s.closed && n.length > 1) segment(n[n.length - 1], n[0])
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export const pathBounds = (d: string) => subsBounds(parsePath(d))

export function union(boxes: (Box | null)[]): Box | null {
  let out: Box | null = null
  for (const b of boxes) {
    if (!b) continue
    if (!out) out = { ...b }
    else {
      const x1 = Math.max(out.x + out.w, b.x + b.w)
      const y1 = Math.max(out.y + out.h, b.y + b.h)
      out.x = Math.min(out.x, b.x)
      out.y = Math.min(out.y, b.y)
      out.w = x1 - out.x
      out.h = y1 - out.y
    }
  }
  return out
}

const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
}

/** Parameters in (0, 1) where the cubic's derivative is zero. */
function extrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // B'(t)/3 = a t² + b t + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3
  const b = 2 * (p0 - 2 * p1 + p2)
  const c = p1 - p0
  const roots: number[] = []
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b)
  } else {
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const r = Math.sqrt(disc)
      roots.push((-b + r) / (2 * a), (-b - r) / (2 * a))
    }
  }
  return roots.filter((t) => t > 0 && t < 1)
}

// ---- Scaling from a handle ---------------------------------------------------------

/** Which edges a handle moves: -1 the left/top edge, 1 the right/bottom, 0 neither. */
export type Handle = { h: -1 | 0 | 1; v: -1 | 0 | 1 }
export const HANDLE_SET: Handle[] = [
  { h: -1, v: -1 },
  { h: 0, v: -1 },
  { h: 1, v: -1 },
  { h: 1, v: 0 },
  { h: 1, v: 1 },
  { h: 0, v: 1 },
  { h: -1, v: 1 },
  { h: -1, v: 0 },
]

export const handlePoint = (box: Box, k: Handle): Pt => ({ x: box.x + ((k.h + 1) / 2) * box.w, y: box.y + ((k.v + 1) / 2) * box.h })

/** Smallest size a drag can squash a box to, so it can always be grabbed again. */
const MIN_SIZE = 0.5

/**
 * The transform for dragging handle `k` of `box` so that it lands on `to`.
 * The opposite edge stays put, or with `fromCentre` the centre does. With
 * `proportional` both axes scale by the same factor: the larger of the two for
 * a corner, and for an edge handle the other axis follows about its centre.
 * Dragging past the opposite edge flips the shape, as in other editors.
 */
export function scaleFromHandle(box: Box, k: Handle, to: Pt, opts: { proportional?: boolean; fromCentre?: boolean } = {}): Affine {
  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  const anchor = opts.fromCentre ? centre : handlePoint(box, { h: (-k.h || 0) as Handle['h'], v: (-k.v || 0) as Handle['v'] })
  const grip = handlePoint(box, k)
  const factor = (along: number, at: number, a: number, size: number) => {
    const reach = along - a
    if (Math.abs(reach) < 1e-9 || size < 1e-9) return 1
    let f = (at - a) / reach
    // Keep at least MIN_SIZE across, preserving the sign so a flip still works.
    const min = MIN_SIZE / size
    if (Math.abs(f) < min) f = f < 0 ? -min : min
    return f
  }
  let sx = k.h ? factor(grip.x, to.x, anchor.x, box.w) : 1
  let sy = k.v ? factor(grip.y, to.y, anchor.y, box.h) : 1
  let ax = anchor.x
  let ay = anchor.y
  if (opts.proportional) {
    if (k.h && k.v) {
      const s = Math.abs(sx) >= Math.abs(sy) ? Math.abs(sx) : Math.abs(sy)
      sx = Math.sign(sx) * s
      sy = Math.sign(sy) * s
    } else if (k.h) {
      sy = Math.abs(sx)
      ay = centre.y
    } else {
      sx = Math.abs(sy)
      ax = centre.x
    }
  }
  return scaleAt(sx, sy, ax, ay)
}

/** The transform that maps `from` onto `to` (for typed X, Y, W and H). */
export function boxToBox(from: Box, to: Box): Affine {
  const sx = from.w > 1e-9 ? to.w / from.w : 1
  const sy = from.h > 1e-9 ? to.h / from.h : 1
  return { a: sx, b: 0, c: 0, d: sy, e: to.x - sx * from.x, f: to.y - sy * from.y }
}

// ---- Rectangle selection ---------------------------------------------------------

export const normRect = (a: Pt, b: Pt): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) })

const inside = (r: Box, p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h

/**
 * Shapes wholly inside the rectangle. "Touching" would be the other common
 * rule, but a trace usually has one large shape behind everything (the
 * background region), and touching would sweep it into every selection.
 */
export function pathsInRect(paths: { id: string; d: string }[], r: Box): string[] {
  const out: string[] = []
  for (const p of paths) {
    const b = pathBounds(p.d)
    if (b && b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h) out.push(p.id)
  }
  return out
}

export function nodesInRect(subs: Subpath[], r: Box): NodeRef[] {
  const out: NodeRef[] = []
  subs.forEach((s, sub) => s.nodes.forEach((n, index) => inside(r, n) && out.push({ sub, index })))
  return out
}

/** Every node of a path, for select-all. */
export const allRefs = (subs: Subpath[]): NodeRef[] => subs.flatMap((s, sub) => s.nodes.map((_, index) => ({ sub, index })))

export const sameRef = (a: NodeRef, b: NodeRef) => a.sub === b.sub && a.index === b.index
export const hasRef = (refs: NodeRef[], r: NodeRef) => refs.some((x) => sameRef(x, r))
