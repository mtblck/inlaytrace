/**
 * SVG path data as editable nodes, and back.
 *
 * A path is a list of subpaths; each subpath is a list of anchor nodes with
 * optional absolute bezier handles, the model every vector editor uses. The
 * segment between two nodes is a cubic when either side has a handle and a
 * line otherwise. Everything is converted to absolute M/L/C/Z on the way in,
 * so dragging a node never has to re-resolve relative coordinates downstream.
 *
 * Round trips must not drift: numbers are written with at most three decimals
 * (0.0005 worst case), and writing is idempotent after the first pass, so
 * parse → serialise any number of times moves nothing beyond 0.01.
 *
 * Arcs are approximated by a straight line. Nothing in this app emits them:
 * VTracer writes M/L/C/Z and paper.js writes M/L/C/Z (plus H/V/S, handled).
 */

export type Pt = { x: number; y: number }
export type PathNode = { x: number; y: number; in: Pt | null; out: Pt | null }
export type Subpath = { nodes: PathNode[]; closed: boolean }

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
const PARAMS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
// Closing a curve exactly onto its start point is how VTracer ends every
// subpath; within this distance the end node is folded into the first.
const SAME = 1e-6

export function parsePath(d: string): Subpath[] {
  const tokens = d.match(TOKEN) ?? []
  const subs: Subpath[] = []
  let sub: Subpath | null = null
  let cur: Pt = { x: 0, y: 0 }
  let start: Pt = { x: 0, y: 0 }
  // The previous command's last control point, for S and T reflections.
  let lastCubic: Pt | null = null
  let lastQuad: Pt | null = null
  let i = 0
  let cmd = ''

  const begin = (p: Pt) => {
    sub = { nodes: [{ x: p.x, y: p.y, in: null, out: null }], closed: false }
    subs.push(sub)
  }
  const ensure = () => {
    if (!sub || sub.closed) begin(cur)
    return sub!
  }
  const lineTo = (p: Pt) => {
    ensure().nodes.push({ x: p.x, y: p.y, in: null, out: null })
    cur = p
  }
  const curveTo = (c1: Pt, c2: Pt, p: Pt) => {
    const s = ensure()
    s.nodes[s.nodes.length - 1].out = c1
    s.nodes.push({ x: p.x, y: p.y, in: c2, out: null })
    cur = p
  }

  while (i < tokens.length) {
    const t = tokens[i]
    if (/[a-z]/i.test(t)) {
      cmd = t
      i++
      if (cmd === 'Z' || cmd === 'z') {
        if (sub) close(sub)
        cur = start
        lastCubic = lastQuad = null
        continue
      }
    } else if (!cmd) {
      i++ // a number before any command: malformed, skip it
      continue
    }
    const upper = cmd.toUpperCase()
    const n = PARAMS[upper]
    if (i + n > tokens.length) break
    const v = tokens.slice(i, i + n).map(Number)
    if (v.some((x) => !Number.isFinite(x))) break
    i += n
    const rel = cmd !== upper
    const ox = rel ? cur.x : 0
    const oy = rel ? cur.y : 0
    let cubic: Pt | null = null
    let quad: Pt | null = null
    switch (upper) {
      case 'M':
        cur = start = { x: v[0] + ox, y: v[1] + oy }
        begin(cur)
        // Further pairs after M are implicit line-tos.
        cmd = rel ? 'l' : 'L'
        break
      case 'L':
        lineTo({ x: v[0] + ox, y: v[1] + oy })
        break
      case 'H':
        lineTo({ x: v[0] + ox, y: cur.y })
        break
      case 'V':
        lineTo({ x: cur.x, y: v[0] + oy })
        break
      case 'C': {
        cubic = { x: v[2] + ox, y: v[3] + oy }
        curveTo({ x: v[0] + ox, y: v[1] + oy }, cubic, { x: v[4] + ox, y: v[5] + oy })
        break
      }
      case 'S': {
        const c1 = lastCubic ? { x: 2 * cur.x - lastCubic.x, y: 2 * cur.y - lastCubic.y } : cur
        cubic = { x: v[0] + ox, y: v[1] + oy }
        curveTo(c1, cubic, { x: v[2] + ox, y: v[3] + oy })
        break
      }
      case 'Q':
      case 'T': {
        const q: Pt =
          upper === 'Q'
            ? { x: v[0] + ox, y: v[1] + oy }
            : lastQuad
              ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y }
              : cur
        const p = upper === 'Q' ? { x: v[2] + ox, y: v[3] + oy } : { x: v[0] + ox, y: v[1] + oy }
        // A quadratic is exactly the cubic with handles 2/3 of the way to q.
        const p0 = cur
        curveTo({ x: p0.x + (2 / 3) * (q.x - p0.x), y: p0.y + (2 / 3) * (q.y - p0.y) }, { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p)
        quad = q
        break
      }
      case 'A':
        lineTo({ x: v[5] + ox, y: v[6] + oy })
        break
    }
    lastCubic = cubic
    lastQuad = quad
  }
  return subs
}

function close(sub: Subpath) {
  if (sub.closed) return
  sub.closed = true
  const { nodes } = sub
  if (nodes.length < 2) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (Math.abs(first.x - last.x) < SAME && Math.abs(first.y - last.y) < SAME) {
    first.in = last.in
    nodes.pop()
  }
}

const num = (n: number) => {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}
const pt = (p: Pt) => `${num(p.x)} ${num(p.y)}`

function segment(a: PathNode, b: PathNode) {
  return a.out || b.in ? `C${pt(a.out ?? a)} ${pt(b.in ?? b)} ${pt(b)}` : `L${pt(b)}`
}

export function serializePath(subs: Subpath[]): string {
  let d = ''
  for (const s of subs) {
    if (!s.nodes.length) continue
    d += `M${pt(s.nodes[0])}`
    for (let i = 1; i < s.nodes.length; i++) d += segment(s.nodes[i - 1], s.nodes[i])
    if (s.closed) {
      const first = s.nodes[0]
      const last = s.nodes[s.nodes.length - 1]
      // A straight closing edge is implied by Z; a curved one has to be written.
      if (s.nodes.length > 1 && (last.out || first.in)) d += segment(last, first)
      d += 'Z'
    }
  }
  return d
}

export function mapPoints(subs: Subpath[], f: (p: Pt) => Pt): Subpath[] {
  const m = (p: Pt | null) => (p ? f(p) : null)
  return subs.map((s) => ({
    closed: s.closed,
    nodes: s.nodes.map((n) => ({ ...f(n), in: m(n.in), out: m(n.out) })),
  }))
}

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
