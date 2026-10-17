/**
 * Edits on one shape's nodes beyond moving them: add a node on a segment,
 * make a node smooth or sharp, round a corner, and simplify a whole shape.
 *
 * All of them work on the editable subpaths of src/lib/pathdata.ts and keep
 * the outline where it was unless the edit is meant to change it: adding a
 * node splits a curve exactly (de Casteljau), so the shape doesn't move.
 */
import { fitChain, isFlat, type Cubic } from 'inlaytrace'
import { isSmooth, type NodeRef, type PathNode, type Pt, type Subpath } from './pathdata'

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y })
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k })
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const len = (a: Pt) => Math.hypot(a.x, a.y)
const dist = (a: Pt, b: Pt) => len(sub(a, b))
const norm = (a: Pt): Pt => {
  const l = len(a)
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }
}

/** Segment `seg` of a subpath runs from node seg to node seg+1 (wrapping to 0 when closed). */
export const segmentCount = (s: Subpath) => (s.closed ? s.nodes.length : s.nodes.length - 1)
const ends = (s: Subpath, seg: number): [PathNode, PathNode] => [s.nodes[seg], s.nodes[(seg + 1) % s.nodes.length]]
export const cubicOf = (a: PathNode, b: PathNode): Cubic => [{ x: a.x, y: a.y }, a.out ?? { x: a.x, y: a.y }, b.in ?? { x: b.x, y: b.y }, { x: b.x, y: b.y }]

export function pointAt([p0, p1, p2, p3]: Cubic, t: number): Pt {
  const u = 1 - t
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  }
}

/** de Casteljau: the two halves of a cubic at t, which together trace it exactly. */
export function splitCubic([p0, p1, p2, p3]: Cubic, t: number): [Cubic, Cubic] {
  const q0 = lerp(p0, p1, t)
  const q1 = lerp(p1, p2, t)
  const q2 = lerp(p2, p3, t)
  const r0 = lerp(q0, q1, t)
  const r1 = lerp(q1, q2, t)
  const s = lerp(r0, r1, t)
  return [
    [p0, q0, r0, s],
    [s, r1, q2, p3],
  ]
}

// ---- Finding a point on the outline ------------------------------------------------

export type OnPath = { sub: number; seg: number; t: number; at: Pt; dist: number }

/** The nearest point on the outline to `p`: coarse samples, then a local refinement. */
export function nearestOnPath(subs: Subpath[], p: Pt): OnPath | null {
  let best: OnPath | null = null
  subs.forEach((s, si) => {
    for (let seg = 0; seg < segmentCount(s); seg++) {
      const c = cubicOf(...ends(s, seg))
      const N = 48
      let bt = 0
      let bd = Infinity
      for (let k = 0; k <= N; k++) {
        const d = dist(pointAt(c, k / N), p)
        if (d < bd) [bd, bt] = [d, k / N]
      }
      // Narrow in around the best sample.
      let step = 1 / N
      for (let i = 0; i < 24; i++) {
        step /= 2
        for (const t of [bt - step, bt + step]) {
          if (t < 0 || t > 1) continue
          const d = dist(pointAt(c, t), p)
          if (d < bd) [bd, bt] = [d, t]
        }
      }
      if (!best || bd < best.dist) best = { sub: si, seg, t: bt, at: pointAt(c, bt), dist: bd }
    }
  })
  return best
}

// ---- Add a node ----------------------------------------------------------------------

/**
 * Split segment `seg` at t with a new node. The curve is split exactly, so the
 * outline doesn't move; a straight segment gets a plain node with no handles.
 * Returns the new subpaths and where the new node is.
 */
export function addNode(subs: Subpath[], si: number, seg: number, t: number): { subs: Subpath[]; ref: NodeRef } {
  const s = subs[si]
  const [a, b] = ends(s, seg)
  const straight = !a.out && !b.in
  const nodes = s.nodes.map((n) => ({ ...n }))
  const ia = seg
  const ib = (seg + 1) % nodes.length
  let mid: PathNode
  if (straight) mid = { ...lerp(a, b, t), in: null, out: null }
  else {
    const [l, r] = splitCubic(cubicOf(a, b), t)
    nodes[ia].out = l[1]
    nodes[ib].in = r[2]
    mid = { x: l[3].x, y: l[3].y, in: l[2], out: r[1] }
  }
  nodes.splice(seg + 1, 0, mid)
  return { subs: subs.map((x, i) => (i === si ? { closed: s.closed, nodes } : x)), ref: { sub: si, index: seg + 1 } }
}

// ---- Smooth and sharp ------------------------------------------------------------------

const neighbours = (s: Subpath, i: number) => {
  const n = s.nodes.length
  const prev = i > 0 ? s.nodes[i - 1] : s.closed ? s.nodes[n - 1] : null
  const next = i < n - 1 ? s.nodes[i + 1] : s.closed ? s.nodes[0] : null
  return { prev, next }
}

const replaceNode = (subs: Subpath[], ref: NodeRef, f: (n: PathNode, s: Subpath) => PathNode): Subpath[] =>
  subs.map((s, si) => (si !== ref.sub ? s : { closed: s.closed, nodes: s.nodes.map((n, i) => (i === ref.index ? f(n, s) : n)) }))

/**
 * Give a node two handles in line, so the curve passes through it smoothly.
 * The direction runs from the previous node to the next (the usual "smooth"
 * conversion); existing handle lengths are kept, and missing ones are a third
 * of the way to that neighbour, as a straight segment's would be.
 */
export function smoothNode(subs: Subpath[], ref: NodeRef): Subpath[] {
  return replaceNode(subs, ref, (n, s) => {
    const { prev, next } = neighbours(s, ref.index)
    if (!prev && !next) return n
    const dir = norm(prev && next ? sub(next, prev) : next ? sub(next, n) : sub(n, prev!))
    if (!dir.x && !dir.y) return n
    const lin = n.in ? dist(n.in, n) : prev ? dist(prev, n) / 3 : 0
    const lout = n.out ? dist(n.out, n) : next ? dist(next, n) / 3 : 0
    return { ...n, in: prev && lin > 1e-6 ? sub(n, mul(dir, lin)) : null, out: next && lout > 1e-6 ? add(n, mul(dir, lout)) : null }
  })
}

/** Drop a node's handles, so both segments meet it at a sharp point. */
export const sharpenNode = (subs: Subpath[], ref: NodeRef): Subpath[] => replaceNode(subs, ref, (n) => ({ ...n, in: null, out: null }))

// ---- Round a corner ----------------------------------------------------------------------

/** The t at which a cubic has run `length` px from its start (sampled; exact enough for editing). */
function tAtLength(c: Cubic, length: number): number {
  // A segment with no handles is a line whose parameter runs evenly: exact.
  const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y
  if (same(c[0], c[1]) && same(c[2], c[3])) return Math.min(1, length / Math.max(dist(c[0], c[3]), 1e-12))
  const N = 64
  let prev = c[0]
  let acc = 0
  for (let k = 1; k <= N; k++) {
    const p = pointAt(c, k / N)
    const l = dist(prev, p)
    if (acc + l >= length) return (k - 1 + (length - acc) / Math.max(l, 1e-12)) / N
    acc += l
    prev = p
  }
  return 1
}
export function cubicLength(c: Cubic): number {
  let acc = 0
  let prev = c[0]
  for (let k = 1; k <= 64; k++) {
    const p = pointAt(c, k / 64)
    acc += dist(prev, p)
    prev = p
  }
  return acc
}
const reverseCubic = ([a, b, c, d]: Cubic): Cubic => [d, c, b, a]

/**
 * Replace a corner with a circular-looking arc `radius` px along each side.
 * Each neighbouring segment is cut `radius` px from the corner (at most 45% of
 * its length, so two rounded corners never overlap), and the two cut points are
 * joined by a cubic whose handles follow the sides, sized as for a circular arc
 * through that turn. Open ends and smooth nodes are left alone.
 */
export function roundNode(subs: Subpath[], ref: NodeRef, radius: number): Subpath[] {
  const s = subs[ref.sub]
  const n = s.nodes.length
  const i = ref.index
  if (radius <= 0 || n < 3 || (!s.closed && (i === 0 || i === n - 1)) || isSmooth(s.nodes[i])) return subs
  const ip = (i - 1 + n) % n
  // A straight segment as a cubic with handles a third of the way along, so its
  // parameter runs evenly and splitting it by length lands where it should.
  const even = (a: PathNode, b: PathNode): Cubic => (a.out || b.in ? cubicOf(a, b) : [{ x: a.x, y: a.y }, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), { x: b.x, y: b.y }])
  const inc = even(s.nodes[ip], s.nodes[i]) // arriving at the corner
  const out = even(s.nodes[i], s.nodes[(i + 1) % n]) // leaving it
  const r = Math.min(radius, 0.45 * cubicLength(inc), 0.45 * cubicLength(out))
  if (r < 0.05) return subs
  // Cut the arriving segment r px before the corner (measured from the corner end).
  const tIn = 1 - tAtLength(reverseCubic(inc), r)
  const [keepIn] = splitCubic(inc, tIn)
  const tOut = tAtLength(out, r)
  const [, keepOut] = splitCubic(out, tOut)
  const p1 = keepIn[3]
  const p2 = keepOut[0]
  // Directions of travel at the two cut points.
  const d1 = norm(len(sub(keepIn[3], keepIn[2])) > 1e-9 ? sub(keepIn[3], keepIn[2]) : sub(s.nodes[i], p1))
  const d2 = norm(len(sub(keepOut[1], keepOut[0])) > 1e-9 ? sub(keepOut[1], keepOut[0]) : sub(keepOut[3], p2))
  const turn = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)))
  if (turn < 1e-3) return subs // already smooth: nothing to round
  // For a circular arc turning through φ between tangent points r from the
  // corner, the radius is r / tan(φ/2) and each handle (4/3)·tan(φ/4)·radius.
  const h = Math.min(r, (4 / 3) * Math.tan(turn / 4) * (r / Math.tan(turn / 2)))
  // Curved or straight is the original segment's, not the kept part's: a short
  // kept piece of a gentle curve can look flat, and dropping its handles would
  // leave the neighbour's handle sized for the whole segment.
  const flatIn = !s.nodes[ip].out && !s.nodes[i].in
  const flatOut = !s.nodes[i].out && !s.nodes[(i + 1) % n].in
  const first: PathNode = { x: p1.x, y: p1.y, in: flatIn ? null : keepIn[2], out: add(p1, mul(d1, h)) }
  const second: PathNode = { x: p2.x, y: p2.y, in: sub(p2, mul(d2, h)), out: flatOut ? null : keepOut[1] }
  const nodes = s.nodes.map((x) => ({ ...x }))
  // The neighbours' handles on the cut segments become the kept halves' handles.
  if (!flatIn) nodes[ip].out = keepIn[1]
  const inext = (i + 1) % n
  if (!flatOut) nodes[inext].in = keepOut[2]
  nodes.splice(i, 1, first, second)
  return subs.map((x, k) => (k === ref.sub ? { closed: s.closed, nodes } : x))
}

// ---- Simplify ---------------------------------------------------------------------------------

/** Points about a pixel apart along a subpath, for re-fitting. Closed loops don't repeat the start. */
function sample(s: Subpath): Pt[] {
  const out: Pt[] = []
  for (let seg = 0; seg < segmentCount(s); seg++) {
    const c = cubicOf(...ends(s, seg))
    const k = Math.max(2, Math.ceil(cubicLength(c)))
    for (let j = 0; j < k; j++) out.push(pointAt(c, j / k))
  }
  if (!s.closed && s.nodes.length) out.push({ x: s.nodes[s.nodes.length - 1].x, y: s.nodes[s.nodes.length - 1].y })
  return out
}

const r3 = (p: Pt): Pt => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 })

function fromCubics(cubics: Cubic[], closed: boolean): Subpath {
  const nodes: PathNode[] = []
  for (const c of cubics) {
    if (!nodes.length) nodes.push({ ...r3(c[0]), in: null, out: null })
    const flat = isFlat(c)
    if (!flat) nodes[nodes.length - 1].out = r3(c[1])
    nodes.push({ ...r3(c[3]), in: flat ? null : r3(c[2]), out: null })
  }
  if (closed && nodes.length > 1) {
    const last = nodes.pop()!
    nodes[0].in = last.in
  }
  return { closed, nodes }
}

/**
 * Re-fit a shape with the tracer's own fitter at `tolerance` px: the outline
 * is sampled about a pixel apart and fitted again, keeping corners sharper
 * than 45°. Smoothing is light (the input is already smooth, not a pixel
 * staircase). A subpath that would come out with fewer nodes than before is
 * replaced; one that wouldn't is kept as it was.
 */
export function simplifySubpaths(subs: Subpath[], tolerance: number): Subpath[] {
  return subs.map((s) => {
    if (s.nodes.length < 3) return s
    const pts = sample(s)
    if (pts.length < 4) return s
    const cubics = fitChain(pts, s.closed, { tolerance, cornerAngle: 45, smoothing: 2 })
    if (!cubics.length) return s
    const next = fromCubics(cubics, s.closed)
    if (next.nodes.length < (s.closed ? 3 : 2) || next.nodes.length >= s.nodes.length) return s
    // The fitter smooths before it fits, which can fold a thin shape's two long
    // sides into one line (a 4 px bar became a two-node sliver with no area).
    // Keep the result only if every point of the old outline is still near it.
    const worst = Math.max(...pts.filter((_, k) => k % 2 === 0).map((p) => nearestOnPath([next], p)?.dist ?? Infinity))
    return worst <= 2 * tolerance + 0.25 ? next : s
  })
}
