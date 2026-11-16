/**
 * Objects (#195): the separate things in a drawing, such as each icon on a
 * sheet or each sticker. An object is a set of shapes that touch (sharing an
 * edge, as Inlay's traced neighbours do, crossing, or one inside another),
 * plus any shapes already grouped with them. Pieces closer than a quarter of
 * their size (the letters of a word, the dot of an i) count as one object, so
 * a logo stays whole. The background (a shape as big as the drawing) is no
 * part of any object.
 *
 * Group by object puts each object's shapes in one group; export can write
 * each object as its own SVG, cropped to it.
 */
import { buildSvgOf, groupPaths, visiblePaths, type Doc, type InkEdits } from './doc'
import { parsePath, type PathNode, type Pt, type Subpath } from './pathdata'
import { subsBounds, type Box } from './transform'

/** A shape at least this share of the drawing's width and height is the background. */
export const BACKGROUND = 0.95
/** Pieces closer than this share of the smaller one's size are one object. */
export const NEAR = 0.25

type Shape = { id: string; group?: string; box: Box; rings: { pts: Pt[]; closed: boolean }[]; filled: boolean; pad: number }

const key = (p: Pt) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`
const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by })
const inside = (a: Box, b: Box) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h
const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)))
const size = (b: Box) => Math.max(b.w, b.h)

/** An outline as points: each node, and along a curve a point every 2 px or so (by its control polygon). */
function flatten(s: Subpath): Pt[] {
  const out: Pt[] = []
  const n = s.nodes.length
  const seg = (a: PathNode, b: PathNode) => {
    out.push({ x: a.x, y: a.y })
    if (!a.out && !b.in) return
    const c1 = a.out ?? a
    const c2 = b.in ?? b
    const len = Math.hypot(c1.x - a.x, c1.y - a.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(b.x - c2.x, b.y - c2.y)
    const k = Math.min(64, Math.ceil(len / 2))
    for (let j = 1; j < k; j++) {
      const t = j / k
      const u = 1 - t
      out.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y })
    }
  }
  for (let i = 0; i + 1 < n; i++) seg(s.nodes[i], s.nodes[i + 1])
  if (s.closed && n > 1) seg(s.nodes[n - 1], s.nodes[0])
  else if (n) out.push({ x: s.nodes[n - 1].x, y: s.nodes[n - 1].y })
  return out
}

/** The distance between segments ab and cd (0 when they cross). */
function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  const toSeg = (p: Pt, s: Pt, e: Pt) => {
    const dx = e.x - s.x
    const dy = e.y - s.y
    const l = dx * dx + dy * dy
    const t = l ? Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / l)) : 0
    return Math.hypot(p.x - s.x - t * dx, p.y - s.y - t * dy)
  }
  return Math.min(toSeg(a, c, d), toSeg(b, c, d), toSeg(c, a, b), toSeg(d, a, b))
}

/** Whether `p` is inside the filled shape (even-odd across its closed outlines). */
function contains(s: Shape, p: Pt): boolean {
  let n = false
  for (const r of s.rings) {
    if (!r.closed) continue
    const q = r.pts
    for (let i = 0, j = q.length - 1; i < q.length; j = i++)
      if (q[i].y > p.y !== q[j].y > p.y && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) n = !n
  }
  return n
}

/** The drawing's objects, each as its shapes' ids in paint order, bottom object first. Removed inks and the background aren't in any. */
export function findObjects(doc: Doc, inks: InkEdits): string[][] {
  const shapes: Shape[] = []
  const groupOf = new Map(doc.paths.map((p) => [p.id, p.group]))
  for (const p of visiblePaths(doc, inks)) {
    const subs = parsePath(p.d)
    const box = subsBounds(subs)
    if (!box) continue
    if (!p.stroke && box.w >= BACKGROUND * doc.width && box.h >= BACKGROUND * doc.height) continue
    const pad = p.stroke ? p.stroke / 2 : 0
    shapes.push({ id: p.id, group: groupOf.get(p.id), box: grow(box, pad), rings: subs.map((s) => ({ pts: flatten(s), closed: s.closed })), filled: !p.stroke, pad })
  }
  const parent = shapes.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
  const join = (i: number, j: number) => {
    const a = root(i)
    const b = root(j)
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
  }

  // Grouped already, or sharing a node: the cheap ways to touch, and how Inlay's neighbours do.
  const firstIn = new Map<string, number>()
  shapes.forEach((s, i) => {
    if (s.group) firstIn.has(`g:${s.group}`) ? join(i, firstIn.get(`g:${s.group}`)!) : firstIn.set(`g:${s.group}`, i)
  })
  const at = new Map<string, number>()
  shapes.forEach((s, i) => {
    for (const r of s.rings)
      for (const q of r.pts) {
        const j = at.get(key(q))
        if (j === undefined) at.set(key(q), i)
        else if (j !== i) join(i, j)
      }
  })

  // Edges that cross or come within a line's width: compared only within a grid cell.
  const cell = Math.max(4, Math.max(doc.width, doc.height) / 128)
  const grid = new Map<string, { i: number; a: Pt; b: Pt }[]>()
  shapes.forEach((s, i) =>
    s.rings.forEach((r) => {
      const n = r.pts.length
      const segs = r.closed ? n : n - 1
      for (let k = 0; k < segs; k++) {
        const a = r.pts[k]
        const b = r.pts[(k + 1) % n]
        const x0 = Math.floor((Math.min(a.x, b.x) - s.pad) / cell)
        const x1 = Math.floor((Math.max(a.x, b.x) + s.pad) / cell)
        const y0 = Math.floor((Math.min(a.y, b.y) - s.pad) / cell)
        const y1 = Math.floor((Math.max(a.y, b.y) + s.pad) / cell)
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++) {
            const c = `${x},${y}`
            const list = grid.get(c)
            if (list) list.push({ i, a, b })
            else grid.set(c, [{ i, a, b }])
          }
      }
    }),
  )
  for (const list of grid.values()) {
    if (list.length < 2) continue
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const p = list[x]
        const q = list[y]
        if (root(p.i) === root(q.i)) continue
        if (segDist(p.a, p.b, q.a, q.b) <= shapes[p.i].pad + shapes[q.i].pad + 1e-3) join(p.i, q.i)
      }
  }

  // One shape wholly inside another, not touching its edge (a stacked Poster shape).
  const byX = shapes.map((_, i) => i).sort((i, j) => shapes[i].box.x - shapes[j].box.x)
  const within = (i: number, j: number) => {
    if (!shapes[i].filled || root(i) === root(j) || !inside(shapes[i].box, shapes[j].box)) return
    const p = shapes[j].rings.find((r) => r.pts.length)?.pts[0]
    if (p && contains(shapes[i], p)) join(i, j)
  }
  // Sorted by left edge: only shapes starting before this one's right edge can be inside it, or it inside them.
  for (let x = 0; x < byX.length; x++) {
    const i = byX[x]
    const right = shapes[i].box.x + shapes[i].box.w
    for (let y = x + 1; y < byX.length && shapes[byX[y]].box.x <= right; y++) {
      within(i, byX[y])
      within(byX[y], i)
    }
  }

  // Pieces near each other, as letters in a word are: one object. A speck within its own size of something four times bigger joins it too.
  for (let again = true; again; ) {
    again = false
    const boxes = new Map<number, Box>()
    shapes.forEach((s, i) => {
      const r = root(i)
      const b = boxes.get(r)
      boxes.set(r, !b ? s.box : { x: Math.min(b.x, s.box.x), y: Math.min(b.y, s.box.y), w: Math.max(b.x + b.w, s.box.x + s.box.w) - Math.min(b.x, s.box.x), h: Math.max(b.y + b.h, s.box.y + s.box.h) - Math.min(b.y, s.box.y) })
    })
    const comps = [...boxes]
    for (let x = 0; x < comps.length; x++)
      for (let y = x + 1; y < comps.length; y++) {
        const [ra, a] = comps[x]
        const [rb, b] = comps[y]
        if (root(ra) === root(rb)) continue
        const small = Math.min(size(a), size(b))
        const big = Math.max(size(a), size(b))
        const g = gap(a, b)
        if (g > NEAR * small && !(4 * small <= big && g <= small)) continue
        join(ra, rb)
        again = true
      }
  }

  const byRoot = new Map<number, string[]>()
  shapes.forEach((s, i) => {
    const r = root(i)
    byRoot.set(r, [...(byRoot.get(r) ?? []), s.id])
  })
  return [...byRoot.values()]
}

/**
 * Each object of two or more shapes in one group (#195). Shapes already
 * grouped as their object are left as they are, so doing it twice changes
 * nothing. The number of objects, too.
 */
export function groupByObject(doc: Doc, inks: InkEdits): { doc: Doc; objects: number } {
  const objects = findObjects(doc, inks)
  let next = doc
  for (const ids of objects) {
    if (ids.length < 2) continue
    const g = next.paths.find((p) => p.id === ids[0])?.group
    const done = !!g && next.paths.every((p) => (p.group === g) === ids.includes(p.id))
    if (!done) next = groupPaths(next, ids)
  }
  return { doc: next, objects: objects.length }
}

/** One SVG per object, cropped to it (whole pixels round it), named by its place in the paint order; and its box. */
export function objectFiles(doc: Doc, inks: InkEdits, baseName: string) {
  const boxes = new Map<string, Box>()
  for (const p of visiblePaths(doc, inks)) {
    const b = subsBounds(parsePath(p.d))
    if (b) boxes.set(p.id, p.stroke ? grow(b, p.stroke / 2) : b)
  }
  return findObjects(doc, inks).map((ids, i) => {
    const bs = ids.map((id) => boxes.get(id)!)
    const x = Math.floor(Math.min(...bs.map((b) => b.x)))
    const y = Math.floor(Math.min(...bs.map((b) => b.y)))
    const box = { x, y, w: Math.ceil(Math.max(...bs.map((b) => b.x + b.w))) - x, h: Math.ceil(Math.max(...bs.map((b) => b.y + b.h))) - y }
    return { name: `${baseName}-object-${String(i + 1).padStart(2, '0')}.svg`, svg: buildSvgOf(doc, inks, new Set(ids), box), box }
  })
}
