/**
 * Editing on top of Inlay's path model. Parsing and writing path data, and the
 * node types, live in the Inlay package (packages/inlay/src/path.ts) so the
 * tracer and the editor share one definition; this file adds the edits.
 */
import type { PathNode, Pt, Subpath } from 'inlaytrace'

export { mapPoints, parsePath, serializePath, type PathNode, type Pt, type Subpath } from 'inlaytrace'

/** Where a node lives: subpath index and node index within it. */
export type NodeRef = { sub: number; index: number }
export type NodePart = 'anchor' | 'in' | 'out'

/** Move an anchor (its handles travel with it) or one of its handles to `to`. */
export function moveNode(subs: Subpath[], ref: NodeRef, part: NodePart, to: Pt): Subpath[] {
  return subs.map((s, si) =>
    si !== ref.sub
      ? s
      : {
          closed: s.closed,
          nodes: s.nodes.map((n, ni) => {
            if (ni !== ref.index) return n
            if (part === 'in') return { ...n, in: to }
            if (part === 'out') return { ...n, out: to }
            const dx = to.x - n.x
            const dy = to.y - n.y
            const shift = (h: Pt | null) => (h ? { x: h.x + dx, y: h.y + dy } : null)
            return { x: to.x, y: to.y, in: shift(n.in), out: shift(n.out) }
          }),
        },
  )
}

/** Handles further than this from a straight line count as a corner, not a smooth node. */
export const SMOOTH_DEGREES = 10

/**
 * A smooth node has two handles pointing in opposite directions, so the curve
 * passes through it without a kink. The tracer writes them that way wherever
 * two curves meet with matching tangents; a corner's handles point anywhere.
 */
export function isSmooth(n: PathNode): boolean {
  if (!n.in || !n.out) return false
  const ax = n.x - n.in.x
  const ay = n.y - n.in.y
  const bx = n.out.x - n.x
  const by = n.out.y - n.y
  const la = Math.hypot(ax, ay)
  const lb = Math.hypot(bx, by)
  if (la < 1e-6 || lb < 1e-6) return false
  return (ax * bx + ay * by) / (la * lb) >= Math.cos((SMOOTH_DEGREES * Math.PI) / 180)
}

/**
 * Move one handle. With `smooth`, the opposite handle swings round to stay
 * exactly opposite, keeping its own length, so the node stays smooth, as in
 * Illustrator and Figma. Without it (Alt held, or a corner) only the dragged
 * handle moves.
 */
export function moveHandle(subs: Subpath[], ref: NodeRef, part: 'in' | 'out', to: Pt, smooth: boolean): Subpath[] {
  return subs.map((s, si) =>
    si !== ref.sub
      ? s
      : {
          closed: s.closed,
          nodes: s.nodes.map((n, ni) => {
            if (ni !== ref.index) return n
            const other = part === 'in' ? 'out' : 'in'
            const next = { ...n, [part]: to }
            const o = n[other]
            const dx = to.x - n.x
            const dy = to.y - n.y
            const d = Math.hypot(dx, dy)
            if (smooth && o && d > 1e-6) {
              const len = Math.hypot(o.x - n.x, o.y - n.y)
              next[other] = { x: n.x - (dx / d) * len, y: n.y - (dy / d) * len }
            }
            return next
          }),
        },
  )
}

/** Move several anchors (with their handles) by the same offset. */
export function moveNodes(subs: Subpath[], refs: NodeRef[], dx: number, dy: number): Subpath[] {
  if (!refs.length || (!dx && !dy)) return subs
  const shift = (h: Pt | null) => (h ? { x: h.x + dx, y: h.y + dy } : null)
  return subs.map((s, si) => {
    if (!refs.some((r) => r.sub === si)) return s
    return {
      closed: s.closed,
      nodes: s.nodes.map((n, ni) => (refs.some((r) => r.sub === si && r.index === ni) ? { x: n.x + dx, y: n.y + dy, in: shift(n.in), out: shift(n.out) } : n)),
    }
  })
}

/**
 * Remove several nodes at once. Indices shift as nodes go, so they are removed
 * per subpath in one pass rather than one call per node.
 */
export function deleteNodes(subs: Subpath[], refs: NodeRef[]): Subpath[] {
  return subs
    .map((s, si) => (refs.some((r) => r.sub === si) ? { closed: s.closed, nodes: s.nodes.filter((_, ni) => !refs.some((r) => r.sub === si && r.index === ni)) } : s))
    .filter((s) => s.nodes.length >= 2)
}

/**
 * Remove a node. Its neighbours keep their own handles, so the curve between
 * them stays smooth instead of collapsing to a straight line. A subpath left
 * with a single node has no area or length and is dropped.
 */
export function deleteNode(subs: Subpath[], ref: NodeRef): Subpath[] {
  return subs
    .map((s, si) => (si !== ref.sub ? s : { closed: s.closed, nodes: s.nodes.filter((_, ni) => ni !== ref.index) }))
    .filter((s) => s.nodes.length >= 2)
}

export const nodeCount = (subs: Subpath[]) => subs.reduce((n, s) => n + s.nodes.length, 0)

/** Flat index ↔ ref, for stepping through nodes with the keyboard. */
export function refAt(subs: Subpath[], flat: number): NodeRef | null {
  let k = flat
  for (let sub = 0; sub < subs.length; sub++) {
    if (k < subs[sub].nodes.length) return { sub, index: k }
    k -= subs[sub].nodes.length
  }
  return null
}

export function flatIndex(subs: Subpath[], ref: NodeRef): number {
  let k = 0
  for (let s = 0; s < ref.sub; s++) k += subs[s].nodes.length
  return k + ref.index
}
