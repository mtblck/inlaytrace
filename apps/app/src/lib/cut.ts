/**
 * The vector Eraser and Knife (#211), on the boolean ops' paper.js (passed in,
 * lazy-loaded by the app, loaded under jsdom by the tests).
 *
 * The Eraser rubs a round brush along the drag and subtracts what it covered
 * from the shapes under it. Whatever it leaves thinner than half a pixel (the
 * sliver of an edge it nearly took) goes too, so its edges come out clean.
 *
 * The Knife cuts along a straight line: each shape it goes right through comes
 * apart into pieces that keep the shape's colour, group and place in the paint
 * order, and meet exactly along the cut. A cut that stops inside a shape leaves
 * it whole, as a knife in most drawing programs does.
 *
 * Both work on filled shapes only (a line has no inside), and each drag is one
 * edit of the doc.
 */
import type PaperNS from 'paper/dist/paper-core'
import { separate } from './boolean'
import { newId, type Doc, type DocPath } from './doc'
import { scopeFor } from './mirror'
import { parsePath, serializePath, type Pt } from './pathdata'

type Paper = typeof PaperNS
type Scope = InstanceType<Paper['PaperScope']>
type Item = InstanceType<Paper['PathItem']>
type Path = InstanceType<Paper['Path']>

/** The doc after the cut, and the ids to select; or why nothing changed. */
export type CutResult = { doc: Doc; selected: string[] } | { error: string }

/** A piece thinner than this on average (twice its area over its outline), in pixels, is a sliver. */
export const SLIVER_PX = 0.5
const areaOf = (item: Item) => Math.abs((item as unknown as Path).area ?? 0)
const lengthOf = (item: Item) => {
  const kids = (item as unknown as { children?: Path[] }).children
  return kids ? kids.reduce((n, c) => n + c.length, 0) : (item as unknown as Path).length
}
const sliver = (item: Item) => item.bounds.isEmpty() || 2 * areaOf(item) < SLIVER_PX * lengthOf(item)
const write = (item: Item) => (!item.pathData || item.bounds.isEmpty() ? '' : serializePath(parsePath(item.pathData)))

function polygon(s: Scope, pts: Pt[]): Path {
  const p = new s.Path({ segments: pts.map((q) => [q.x, q.y]), closed: true, insert: false })
  p.clockwise = true
  return p
}

/**
 * The area a round brush `width` across covers along `points`: a disc at each
 * point and a band between each two, one compound path that the booleans
 * read as their union (nonzero, all turning the same way).
 */
export function brushArea(s: Scope, points: Pt[], width: number): Item {
  const r = width / 2
  // Points closer than a quarter of the brush add nothing a band doesn't.
  const pts: Pt[] = []
  for (const p of points) if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) >= r / 2) pts.push(p)
  if (points.length > 1 && pts.length && pts[pts.length - 1] !== points[points.length - 1]) pts.push(points[points.length - 1])
  const kids: Path[] = pts.map((p) => {
    const c = new s.Path.Circle({ center: [p.x, p.y], radius: r, insert: false })
    c.clockwise = true
    return c
  })
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (!len) continue
    const nx = (-(b.y - a.y) / len) * r
    const ny = ((b.x - a.x) / len) * r
    kids.push(polygon(s, [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }]))
  }
  return new s.CompoundPath({ children: kids, insert: false }) as unknown as Item
}

/** `item` without its slivers, as path data ('' when nothing is left). */
function clean(s: Scope, item: Item): string {
  const pieces = separate(s, item).filter((p) => !sliver(p))
  if (!pieces.length) return ''
  if (pieces.length === 1) return write(pieces[0])
  const kids = pieces.flatMap((p) => ((p as unknown as { children?: Path[] }).children ?? [p as unknown as Path]).map((c) => c.clone({ insert: false })))
  return write(new s.CompoundPath({ children: kids, insert: false }) as unknown as Item)
}

/**
 * Erase along `points` with a brush `width` across, from the shapes `targets`
 * names (the selection, or every visible unlocked shape). A shape the brush
 * takes entirely is deleted.
 */
export function eraseDoc(paper: Paper, doc: Doc, targets: string[], points: Pt[], width: number): CutResult {
  if (!points.length || !(width > 0)) return { error: 'Nothing to erase.' }
  const s = scopeFor(paper)
  const brush = brushArea(s, points, width)
  const want = new Set(targets)
  const changed = new Map<string, string>()
  for (const p of doc.paths) {
    if (!want.has(p.id) || p.stroke) continue
    const item = new s.CompoundPath({ pathData: p.d, insert: false }) as unknown as Item
    if (!item.bounds.intersects(brush.bounds)) continue
    const left = item.subtract(brush, { insert: false }) as Item
    if (Math.abs(areaOf(left) - areaOf(item)) < 0.01) continue
    changed.set(p.id, clean(s, left))
  }
  if (!changed.size) return { error: 'The eraser didn’t touch a filled shape.' }
  const paths = doc.paths.flatMap((p) => (!changed.has(p.id) ? [p] : changed.get(p.id) ? [{ ...p, d: changed.get(p.id)! }] : []))
  return { doc: { ...doc, paths }, selected: [...changed].filter(([, d]) => d).map(([id]) => id) }
}

/**
 * Cut the shapes `targets` names along the line from `a` to `b`. Each shape
 * the line crosses is split into the half-strip beside the line and the rest;
 * pieces that still touch somewhere other than along the cut are joined again,
 * so only a line that goes right through a part of a shape parts it.
 */
export function knifeDoc(paper: Paper, doc: Doc, targets: string[], a: Pt, b: Pt): CutResult {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1e-6) return { error: 'Drag across a shape to cut it.' }
  const s = scopeFor(paper)
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  // Far enough to clear any shape: the drawing's size plus the line's.
  const far = 2 * (doc.width + doc.height + len)
  const side = polygon(s, [a, b, { x: b.x - uy * far, y: b.y + ux * far }, { x: a.x - uy * far, y: a.y + ux * far }])
  const e = 0.05
  const band = polygon(s, [
    { x: a.x - uy * e, y: a.y + ux * e },
    { x: b.x - uy * e, y: b.y + ux * e },
    { x: b.x + uy * e, y: b.y - ux * e },
    { x: a.x + uy * e, y: a.y - ux * e },
  ])
  const line = new s.Path({ segments: [[a.x, a.y], [b.x, b.y]], insert: false })
  const want = new Set(targets)
  const cut = new Map<string, DocPath[]>()
  for (const p of doc.paths) {
    if (!want.has(p.id) || p.stroke) continue
    const item = new s.CompoundPath({ pathData: p.d, insert: false }) as unknown as Item
    if (!item.getIntersections(line as unknown as Item).length) continue
    const left = separate(s, item.intersect(side, { insert: false }) as Item).filter((q) => !sliver(q))
    const right = separate(s, item.subtract(side, { insert: false }) as Item).filter((q) => !sliver(q))
    if (!left.length || !right.length) continue
    const pieces = [...left, ...right]
    // Join a left piece and a right one that meet anywhere but along the cut: with a thin band
    // round the cut taken out, they're still one area.
    const parent = pieces.map((_, i) => i)
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])))
    const parts = (q: Item) => separate(s, q.subtract(band, { insert: false }) as Item).filter((x) => !sliver(x)).length
    for (let i = 0; i < left.length; i++)
      for (let j = left.length; j < pieces.length; j++) {
        if (!pieces[i].bounds.intersects(pieces[j].bounds)) continue
        const both = pieces[i].unite(pieces[j], { insert: false }) as Item
        if (separate(s, both).length !== 1) continue
        if (parts(both) < parts(pieces[i]) + parts(pieces[j])) parent[root(i)] = root(j)
      }
    const groups = new Map<number, Item>()
    pieces.forEach((q, i) => {
      const r = root(i)
      groups.set(r, groups.has(r) ? (groups.get(r)!.unite(q, { insert: false }) as Item) : q)
    })
    // Parts of a compound shape the line misses stay together, with the shape's id.
    const touches = (q: Item) => areaOf(q.intersect(band, { insert: false }) as Item) > 1e-6
    const out: Item[] = []
    let rest: Item | null = null
    for (const g of groups.values()) {
      if (touches(g)) out.push(g)
      else rest = rest ? (rest.unite(g, { insert: false }) as Item) : g
    }
    if (out.length < 2) continue
    if (rest) out.unshift(rest)
    // The first piece keeps the shape's id, so a selection or undo step can still name it.
    const ds = out.map(write).filter(Boolean)
    cut.set(p.id, ds.map((d, k) => ({ ...p, id: k ? newId() : p.id, d })))
  }
  if (!cut.size) return { error: 'The cut has to go right through a filled shape.' }
  const paths = doc.paths.flatMap((p) => cut.get(p.id) ?? [p])
  return { doc: { ...doc, paths }, selected: [...cut.values()].flat().map((p) => p.id) }
}
