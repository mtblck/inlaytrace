/**
 * Shared edges (#212). Inlay traces each boundary once, so two neighbouring
 * shapes hold the very same nodes and handles along the edge they share (one
 * running each way). Editing one shape's copy would open a gap; this moves the
 * neighbours' copies with it.
 *
 * It needs nothing from the tracer: a point of another shape that sits exactly
 * where a point of the edited shape was (to the thousandth of a pixel the path
 * data is written to) is the same point, so it moves to where that point went.
 * A node where three shapes meet moves in all three.
 */
import { fitChain } from 'inlaytrace'
import type { Doc } from './doc'
import { fromCubics, nearestOnPath, sample, simplifySubpaths } from './nodeops'
import { parsePath, serializePath, type PathNode, type Pt, type Subpath } from './pathdata'

const key = (p: Pt) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`
const same = (a: Pt | null, b: Pt | null) => (!a || !b ? a === b : a.x === b.x && a.y === b.y)

/** Every point of `before` that moved in `after`, old place → new; null when the outline changed shape (nodes added or taken away). */
export function movedPoints(before: Subpath[], after: Subpath[]): Map<string, Pt> | null {
  if (before.length !== after.length) return null
  const moved = new Map<string, Pt>()
  for (let s = 0; s < before.length; s++) {
    const b = before[s].nodes
    const a = after[s].nodes
    if (b.length !== a.length) return null
    for (let i = 0; i < b.length; i++)
      for (const part of ['anchor', 'in', 'out'] as const) {
        const p = part === 'anchor' ? b[i] : b[i][part]
        const q = part === 'anchor' ? a[i] : a[i][part]
        if (p && q && !same(p, q)) moved.set(key(p), { x: q.x, y: q.y })
      }
  }
  return moved
}

// Parsing every shape on every pointer move would be slow on a big trace; most don't change during a drag.
const parsed = new Map<string, Subpath[]>()
const parse = (d: string) => {
  let subs = parsed.get(d)
  if (!subs) {
    if (parsed.size > 20_000) parsed.clear()
    subs = parsePath(d)
    parsed.set(d, subs)
  }
  return subs
}

/**
 * `doc` with every other shape's copy of a point that moved in shape `id`
 * (from `before` to `after`) moved with it. Lines (strokes) and `frozen`
 * shapes (locked ones) stay as they are.
 */
export function followShared(doc: Doc, id: string, before: Subpath[], after: Subpath[], frozen: ReadonlySet<string> = new Set()): Doc {
  const moved = movedPoints(before, after)
  if (!moved?.size) return doc
  const to = (p: Pt | null): Pt | null => (p ? (moved.get(key(p)) ?? p) : null)
  let changed = false
  const paths = doc.paths.map((p) => {
    if (p.id === id || p.stroke || frozen.has(p.id)) return p
    const subs = parse(p.d)
    let hit = false
    const next = subs.map((s) => ({
      closed: s.closed,
      nodes: s.nodes.map((n): PathNode => {
        const m = { at: to(n)!, in: to(n.in), out: to(n.out) }
        if (m.at === n && m.in === n.in && m.out === n.out) return n
        hit = true
        return { x: m.at.x, y: m.at.y, in: m.in, out: m.out }
      }),
    }))
    if (!hit) return p
    changed = true
    return { ...p, d: serializePath(next) }
  })
  return changed ? { ...doc, paths } : doc
}

// ---- Simplify, one edge at a time ----------------------------------------------------
//
// Simplify re-fits each selected shape's outline in runs: stretches of edge
// shared with the same neighbour (or with none), broken at the nodes where the
// neighbour changes. A shared run is fitted once and written into both shapes,
// one running each way, so neighbours still meet exactly. The run's end nodes
// stay put, since that's where three shapes meet.

const segCount = (s: Subpath) => (s.closed ? s.nodes.length : s.nodes.length - 1)
const ends = (s: Subpath, i: number): [PathNode, PathNode] => [s.nodes[i], s.nodes[(i + 1) % s.nodes.length]]
/** A segment as it's written: its two ends and two handles (a missing handle is its node). */
const segKey = (a: PathNode, b: PathNode) => `${key(a)}|${key(a.out ?? a)}|${key(b.in ?? b)}|${key(b)}`
const reverseNodes = (nodes: PathNode[]): PathNode[] => [...nodes].reverse().map((n) => ({ x: n.x, y: n.y, in: n.out, out: n.in }))
const loopArea = (nodes: Pt[]) => nodes.reduce((a, p, i) => a + p.x * nodes[(i + 1) % nodes.length].y - nodes[(i + 1) % nodes.length].x * p.y, 0)

type Run = { nodes: PathNode[]; sig: string; loop: boolean }

/** Which other shapes run each segment of `s` back the other way: the segment's neighbours, '' for none. */
function signatures(s: Subpath, id: string, index: Map<string, string[]>, frozen: ReadonlySet<string>): string[] {
  const out: string[] = []
  for (let i = 0; i < segCount(s); i++) {
    const [a, b] = ends(s, i)
    // The neighbour's copy runs b → a, its handles the other way round.
    const back = `${key(b)}|${key(b.in ?? b)}|${key(a.out ?? a)}|${key(a)}`
    const others = [...new Set(index.get(back) ?? [])].filter((o) => o !== id).sort()
    out.push(others.some((o) => frozen.has(o)) ? '#frozen' : others.join(' '))
  }
  return out
}

/** `s` cut into runs at the nodes where the neighbour changes. */
function runsOf(s: Subpath, sigs: string[]): Run[] {
  const segs = segCount(s)
  if (!segs) return [{ nodes: s.nodes, sig: '#fixed', loop: false }]
  if (s.closed && sigs.every((g) => g === sigs[0])) return [{ nodes: s.nodes, sig: sigs[0], loop: true }]
  // Start a closed outline at a node where its neighbour changes, so no run wraps round.
  let start = 0
  if (s.closed) while (sigs[(start - 1 + segs) % segs] === sigs[start]) start++
  const runs: Run[] = []
  for (let k = 0; k < segs; k++) {
    const i = (start + k) % segs
    const [a, b] = ends(s, i)
    const last = runs[runs.length - 1]
    if (last && last.sig === sigs[i]) last.nodes.push(b)
    else runs.push({ nodes: [a, b], sig: sigs[i], loop: false })
  }
  return runs
}

/** An open run re-fitted at `tolerance`, its ends where they were; null if that saves nothing or strays. */
function fitRun(nodes: PathNode[], tolerance: number): PathNode[] | null {
  if (nodes.length < 3) return null
  const open: Subpath = { closed: false, nodes: nodes.map((p, i) => ({ ...p, in: i ? p.in : null, out: i < nodes.length - 1 ? p.out : null })) }
  const pts = sample(open)
  if (pts.length < 4) return null
  const cubics = fitChain(pts, false, { tolerance, cornerAngle: 45, smoothing: 2, snap: false })
  if (!cubics.length) return null
  const next = fromCubics(cubics, false).nodes
  if (next.length >= nodes.length) return null
  // Pin the ends: three shapes meet there.
  const pin = (n: PathNode, to: Pt): PathNode => {
    const dx = to.x - n.x
    const dy = to.y - n.y
    return { x: to.x, y: to.y, in: n.in && { x: n.in.x + dx, y: n.in.y + dy }, out: n.out && { x: n.out.x + dx, y: n.out.y + dy } }
  }
  next[0] = pin(next[0], nodes[0])
  next[next.length - 1] = pin(next[next.length - 1], nodes[nodes.length - 1])
  const worst = Math.max(...pts.filter((_, k) => k % 2 === 0).map((p) => nearestOnPath([{ closed: false, nodes: next }], p)?.dist ?? Infinity))
  return worst <= 2 * tolerance + 0.25 ? next : null
}

/** Runs joined back into one outline: each joint takes its incoming handle from one run and its outgoing from the next. */
function join(runs: PathNode[][], closed: boolean): Subpath {
  const nodes: PathNode[] = []
  for (const r of runs) {
    if (!nodes.length) nodes.push(...r.map((n) => ({ ...n })))
    else {
      nodes[nodes.length - 1] = { ...nodes[nodes.length - 1], out: r[0].out }
      nodes.push(...r.slice(1).map((n) => ({ ...n })))
    }
  }
  if (closed && nodes.length > 1) {
    const last = nodes.pop()!
    nodes[0] = { ...nodes[0], in: last.in }
  }
  return { closed, nodes }
}

/**
 * Simplify the shapes `ids` at `tolerance` px, edge by edge: an edge they share
 * with a neighbour is re-fitted once and changes in the neighbour too, so the
 * shapes still tile exactly. `frozen` (locked) neighbours keep their edge, and
 * so does the selected shape along it.
 */
export function simplifyShared(doc: Doc, ids: string[], tolerance: number, frozen: ReadonlySet<string> = new Set()): Doc {
  const want = new Set(ids)
  const shapes = doc.paths.filter((p) => !p.stroke)
  const index = new Map<string, string[]>()
  for (const p of shapes)
    for (const s of parse(p.d))
      for (let i = 0; i < segCount(s); i++) {
        const k = segKey(...ends(s, i))
        index.set(k, [...(index.get(k) ?? []), p.id])
      }
  // Each run fitted once, under its nodes in order; looked up either way round.
  const fitted = new Map<string, PathNode[] | null>()
  const loops = new Map<string, Subpath | null>()
  const chainKey = (nodes: Pt[]) => nodes.map(key).join(';')
  const loopKey = (nodes: Pt[]) => nodes.map(key).sort().join(';')
  const partners = new Set<string>()
  const runsFor = (id: string, d: string) => parse(d).map((s) => ({ s, runs: runsOf(s, signatures(s, id, index, frozen)) }))

  for (const p of shapes) {
    if (!want.has(p.id)) continue
    for (const { runs } of runsFor(p.id, p.d))
      for (const r of runs) {
        if (r.sig === '#frozen' || r.sig === '#fixed') continue
        for (const o of r.sig.split(' ').filter(Boolean)) partners.add(o)
        if (r.loop) {
          const k = loopKey(r.nodes)
          if (!loops.has(k)) {
            const next = simplifySubpaths([{ closed: true, nodes: r.nodes }], tolerance)[0]
            loops.set(k, next.nodes === r.nodes ? null : next)
          }
        } else {
          const k = chainKey(r.nodes)
          if (!fitted.has(k) && !fitted.has(chainKey([...r.nodes].reverse()))) fitted.set(k, fitRun(r.nodes, tolerance))
        }
      }
  }

  const rewrite = (id: string, d: string) => {
    let hit = false
    const subs = runsFor(id, d).map(({ s, runs }) => {
      if (runs.length === 1 && runs[0].loop) {
        const f = loops.get(loopKey(runs[0].nodes))
        if (!f) return s
        hit = true
        // A neighbour's copy of the loop runs the other way.
        return Math.sign(loopArea(f.nodes)) === Math.sign(loopArea(s.nodes)) ? f : { closed: true, nodes: reverseNodes(f.nodes) }
      }
      let here = false
      const parts = runs.map((r) => {
        const fwd = fitted.get(chainKey(r.nodes))
        if (fwd) return (here = true), fwd
        const back = fitted.get(chainKey([...r.nodes].reverse()))
        if (back) return (here = true), reverseNodes(back)
        return r.nodes
      })
      if (!here) return s
      hit = true
      return join(parts, s.closed)
    })
    return hit ? serializePath(subs) : d
  }
  let changed = false
  const paths = doc.paths.map((p) => {
    if (p.stroke || (!want.has(p.id) && !partners.has(p.id))) return p
    const d = rewrite(p.id, p.d)
    if (d === p.d) return p
    changed = true
    return { ...p, d }
  })
  return changed ? { ...doc, paths } : doc
}
