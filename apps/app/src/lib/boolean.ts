/**
 * Boolean ops on the selection (#207): Unite, Subtract (the front shapes from
 * the back one), Intersect and Divide, the commonest trace fixes (fold a speck
 * into its neighbour, cut a shape out of the background, join two halves).
 *
 * The booleans are paper.js's, lazy-loaded like Mirror's (src/lib/paper.ts)
 * and passed in so the tests can load it under jsdom. Every result goes back
 * through our own path writer, so it uses the same absolute M/L/C/Z form as
 * node edits. Doc paths are nonzero-filled (an imported even-odd SVG is
 * rewritten so), which is paper's default.
 *
 * Paint order is the doc's order: the first selected path is the back one.
 * Unite and Intersect leave one path, in the back shape's colour, gradient and
 * group, where the topmost selected shape was painted (as Group places its
 * members), so nothing unselected that sat above a selected shape ends up
 * under it. Subtract leaves the back shape where it was, cut. Divide cuts the
 * selection into pieces that don't overlap, each in the colour of the shape on
 * top there, one path per separate area, placed like Unite.
 */
import type PaperNS from 'paper/dist/paper-core'
import { newId, type Doc, type DocPath } from './doc'
import { scopeFor } from './mirror'
import { parsePath, serializePath } from './pathdata'

type Paper = typeof PaperNS
type Item = InstanceType<Paper['PathItem']>
type Path = InstanceType<Paper['Path']>

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'divide'

/** The doc after the op, and the ids to select; or why it couldn't be done (the doc is then unchanged). */
export type BooleanResult = { doc: Doc; selected: string[] } | { error: string }

const areaOf = (item: Item) => Math.abs((item as unknown as Path).area ?? 0)
/**
 * Below a hundredth of a square pixel, a result is a sliver left where two
 * traced neighbours' fitted edges nearly coincide, not a shape anyone drew.
 */
const MIN_AREA = 0.01
const tiny = (item: Item) => !item.pathData || item.bounds.isEmpty() || areaOf(item) < MIN_AREA
const write = (item: Item) => (tiny(item) ? '' : serializePath(parsePath(item.pathData)))

export function booleanOp(paper: Paper, doc: Doc, ids: string[], op: BooleanOp): BooleanResult {
  const chosen = new Set(ids)
  const sel = doc.paths.filter((p) => chosen.has(p.id))
  if (sel.length < 2) return { error: 'Select two or more shapes.' }
  // The booleans work on filled areas; a stroke is a line, with no inside.
  if (sel.some((p) => p.stroke)) return { error: 'Lines can’t be combined: select filled shapes only.' }
  const s = scopeFor(paper)
  const items = sel.map((p) => new s.CompoundPath({ pathData: p.d, insert: false }) as Item)
  const back = sel[0]
  const unite = (a: Item, b: Item) => a.unite(b, { insert: false }) as Item

  /** The selection replaced by `out`, painted where the selected path at `anchor` was. */
  const replaced = (out: DocPath[], anchor: 'back' | 'top') => {
    const id = anchor === 'back' ? back.id : sel[sel.length - 1].id
    const at = doc.paths.findIndex((p) => p.id === id)
    const before = doc.paths.slice(0, at).filter((p) => !chosen.has(p.id))
    const after = doc.paths.slice(at + 1).filter((p) => !chosen.has(p.id))
    return { doc: { ...doc, paths: [...before, ...out, ...after] }, selected: out.map((p) => p.id) }
  }

  if (op === 'divide') return divide(s, items, sel, (out) => replaced(out, 'top'))

  if (op === 'subtract') {
    const result = items[0].subtract(items.slice(1).reduce(unite), { insert: false }) as Item
    const d = write(result)
    if (!d) return { error: 'Nothing would be left of the back shape.' }
    if (Math.abs(areaOf(result) - areaOf(items[0])) < MIN_AREA) return { error: 'The front shapes don’t overlap the back one, so there’s nothing to cut.' }
    return replaced([{ ...back, d }], 'back')
  }
  const result = op === 'unite' ? items.reduce(unite) : items.reduce((a, b) => a.intersect(b, { insert: false }) as Item)
  const d = write(result)
  if (!d) return { error: 'These shapes don’t all overlap, so there’s nothing in common to keep.' }
  return replaced([{ ...back, d }], 'top')
}

/**
 * Divide: every region where a different set of the shapes overlaps becomes a
 * piece of its own, in the topmost shape's colour there. Each shape's visible
 * part (what the shapes in front leave) is cut by every shape behind it, so a
 * piece doesn't cross another shape's edge, then split into its separate areas.
 */
function divide(s: InstanceType<Paper['PaperScope']>, items: Item[], sel: DocPath[], replaced: (out: DocPath[]) => BooleanResult): BooleanResult {
  // above[i]: the union of every shape in front of shape i, built once from the front.
  const above: (Item | null)[] = new Array(items.length).fill(null)
  for (let i = items.length - 2; i >= 0; i--) above[i] = above[i + 1] ? (above[i + 1]!.unite(items[i + 1], { insert: false }) as Item) : items[i + 1]
  const out: DocPath[] = []
  for (let i = 0; i < items.length; i++) {
    let pieces: Item[] = [above[i] ? (items[i].subtract(above[i]!, { insert: false }) as Item) : items[i]]
    for (let j = 0; j < i; j++) {
      const next: Item[] = []
      for (const piece of pieces)
        for (const part of [piece.intersect(items[j], { insert: false }) as Item, piece.subtract(items[j], { insert: false }) as Item]) if (!tiny(part)) next.push(part)
      pieces = next
    }
    const ds = pieces.flatMap((piece) => separate(s, piece)).map(write).filter(Boolean)
    // The first piece of each shape keeps its id, so a selection or undo step can still name it.
    ds.forEach((d, k) => out.push({ ...sel[i], id: k ? newId() : sel[i].id, d }))
  }
  if (!out.length) return { error: 'Nothing to divide.' }
  // Built back to front, so already in paint order.
  return replaced(out)
}

/**
 * A compound path's separate areas, each an outline with the holes inside it.
 * A contour inside an even number of others is an outline; one inside an odd
 * number is a hole, belonging to the smallest outline around it.
 */
export function separate(s: InstanceType<Paper['PaperScope']>, item: Item): Item[] {
  const kids = ((item as unknown as { children?: Path[] }).children ?? [item as unknown as Path]).filter((c) => !c.isEmpty())
  if (kids.length < 2) return [item]
  // Tested at points on c's own outline: contours don't cross, so c is inside d or not. (An
  // interior point won't do: nested contours can share one, the middle of a ring round a dot.)
  // Contours can touch, though, so a point that lies on d's outline too says nothing: skip it.
  const on = new Map(kids.map((c) => [c, [0.37, 0.11, 0.63, 0.89, 0.24, 0.5, 0.76].map((t) => c.getPointAt(c.length * t)).filter(Boolean)]))
  const inside = (c: Path, d: Path) => {
    if (c === d) return false
    const tol = 1e-6 * Math.max(1, d.bounds.width, d.bounds.height)
    const p = on.get(c)!.find((q) => d.getNearestPoint(q).getDistance(q) > tol)
    return d.contains(p ?? c.interiorPoint)
  }
  const depth = kids.map((c) => kids.filter((d) => inside(c, d)).length)
  const outlines = kids.filter((_, k) => depth[k] % 2 === 0)
  if (outlines.length < 2) return [item]
  const holes = new Map<Path, Path[]>(outlines.map((o) => [o, []]))
  kids.forEach((c, k) => {
    if (depth[k] % 2 === 0) return
    const around = outlines.filter((o) => inside(c, o)).sort((a, b) => Math.abs(a.area) - Math.abs(b.area))[0]
    if (around) holes.get(around)!.push(c)
  })
  return outlines.map((o) => new s.CompoundPath({ children: [o, ...holes.get(o)!].map((c) => c.clone({ insert: false })), insert: false }) as unknown as Item)
}
