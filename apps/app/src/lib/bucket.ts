/**
 * The paint bucket (#193): click a region to fill it, like a Live Paint
 * bucket. Click a shape and it takes the colour. Click between shapes (the
 * paper inside a Line art outline, the gap in a colouring-book page) and the
 * area the shapes enclose there becomes a new shape in that colour, painted at
 * the back so the lines stay on top.
 *
 * That area is a face of the drawing: the frame minus every filled shape,
 * split into its separate areas (each with the holes inside it), the one under
 * the click. It's cut from the shapes themselves with paper.js's booleans
 * (lazy-loaded, like Combine's), so its edges are the lines' own edges, with
 * no gap and no overlap.
 *
 * Lines drawn as strokes (Centerline) have no inside, so they can't bound a
 * fill; the tool is off for those traces. Small breaks in a hand-drawn
 * outline let a fill leak into the next area: gap closing (#145) is the fix.
 */
import type PaperNS from 'paper/dist/paper-core'
import { newId, ownFill, type Doc, type InkEdits } from './doc'
import { scopeFor } from './mirror'
import { parsePath, serializePath, type Pt } from './pathdata'
import { separate } from './boolean'

type Paper = typeof PaperNS
type Item = InstanceType<Paper['PathItem']>

export type BucketResult = { doc: Doc; id: string; added: boolean } | { error: string }

/** Below this a face is a sliver between two lines' fitted edges, not an area anyone would fill. */
const MIN_AREA = 0.5
const areaOf = (item: Item) => Math.abs((item as unknown as { area?: number }).area ?? 0)

/**
 * Fill at `at` (SVG units) with `colour`. `drawn` are the ids drawn on the
 * canvas: hidden shapes aren't, so a click goes through them and they don't
 * bound a fill (it runs on under them, out of sight behind them). A locked
 * shape bounds a fill but keeps its own colour.
 */
export function bucketFill(paper: Paper, doc: Doc, inks: InkEdits, drawn: ReadonlySet<string>, locked: ReadonlySet<string>, at: Pt, colour: string): BucketResult {
  const s = scopeFor(paper)
  const point = new s.Point(at.x, at.y)
  if (at.x < 0 || at.y < 0 || at.x > doc.width || at.y > doc.height) return { error: 'Click inside the drawing.' }
  const fill = ownFill(colour, inks)
  const live = doc.paths.filter((p) => !inks.removed.includes(p.fill))
  const filled = live.filter((p) => !p.stroke && drawn.has(p.id))

  // A shape under the click, topmost first, takes the colour.
  for (let i = live.length - 1; i >= 0; i--) {
    const p = live[i]
    if (p.stroke || !drawn.has(p.id)) continue
    const item = new s.CompoundPath({ pathData: p.d, insert: false }) as Item
    if (!item.bounds.contains(point) || !item.contains(point)) continue
    if (locked.has(p.id)) return { error: 'That shape is locked: unlock it in the Shapes list to fill it.' }
    if (p.fill === fill && !p.gradient) return { error: 'That shape is already this colour.' }
    return { doc: { ...doc, paths: doc.paths.map((q) => (q.id === p.id ? (({ gradient: _, ...flat }) => ({ ...flat, fill }))(q) : q)) }, id: p.id, added: false }
  }

  // Between shapes: the area they enclose there. United pairwise, so a busy drawing stays quick.
  let items = filled.map((p) => new s.CompoundPath({ pathData: p.d, insert: false }) as Item)
  while (items.length > 1) {
    const next: Item[] = []
    for (let i = 0; i < items.length; i += 2) next.push(i + 1 < items.length ? (items[i].unite(items[i + 1], { insert: false }) as Item) : items[i])
    items = next
  }
  const frame = new s.Path.Rectangle({ point: [0, 0], size: [doc.width, doc.height], insert: false }) as unknown as Item
  const space = items.length ? (frame.subtract(items[0], { insert: false }) as Item) : frame
  const face = separate(s, space).find((f) => f.contains(point) && areaOf(f) >= MIN_AREA)
  if (!face) return { error: 'There’s no area to fill there.' }
  const d = serializePath(parsePath(face.pathData))
  if (!d) return { error: 'There’s no area to fill there.' }
  const id = newId()
  // At the back, so the lines that bound it stay on top.
  return { doc: { ...doc, paths: [{ id, d, fill }, ...doc.paths] }, id, added: true }
}
