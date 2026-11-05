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
import { newId, shownFill, stylePath, type Doc, type DocPath, type InkEdits } from './doc'
import { normalizeHex } from './svg'
import { scopeFor } from './mirror'
import { parsePath, serializePath, type Pt } from './pathdata'
import { separate } from './boolean'

type Paper = typeof PaperNS
type Item = InstanceType<Paper['PathItem']>

export type BucketResult = { doc: Doc; id: string; added: boolean } | { error: string }

/** Below this share of the frame a face is a sliver between two lines' fitted edges, not an area anyone would fill. */
const MIN_SHARE = 1e-6
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
  const want = normalizeHex(colour) ?? colour
  // Filled shapes you can see: not removed, hidden, see-through or drawn as a line.
  const filled = doc.paths.filter((p) => !p.stroke && p.opacity !== 0 && drawn.has(p.id) && !inks.removed.includes(p.fill))

  // A shape under the click, topmost first, takes the colour.
  for (let i = filled.length - 1; i >= 0; i--) {
    const p = filled[i]
    const item = new s.CompoundPath({ pathData: p.d, insert: false }) as Item
    if (!item.bounds.contains(point) || !item.contains(point)) continue
    if (locked.has(p.id)) return { error: 'That shape is locked: unlock it in the Shapes list to fill it.' }
    // Compared as drawn: a recoloured ink shows its new colour, flat.
    if (shownFill(inks, p.fill) === want && (!p.gradient || inks.recolor[p.fill])) return { error: 'That shape is already this colour.' }
    return { doc: { ...doc, paths: doc.paths.map((q) => (q.id === p.id ? stylePath(q, { fill: colour }, inks) : q)) }, id: p.id, added: false }
  }

  const face = separate(s, spaceOf(s, doc, filled)).find((f) => f.contains(point) && areaOf(f) >= MIN_SHARE * doc.width * doc.height)
  if (!face) return { error: 'There’s no area to fill there.' }
  const d = serializePath(parsePath(face.pathData))
  if (!d) return { error: 'There’s no area to fill there.' }
  const id = newId()
  // At the back, so the lines that bound it stay on top. Its own fill, as StyleFields would set it.
  const path = stylePath({ id, d, fill: want }, { fill: colour }, inks)
  return { doc: { ...doc, paths: [path, ...doc.paths] }, id, added: true }
}

/**
 * The frame minus every filled shape: the paper between them. The union is the
 * slow part on a busy drawing, so the last one is kept, for the next click on
 * the same shapes (a fill adds a shape at the back, inside this space, and the
 * cache is keyed by what the shapes are, so that's a miss; clicks that recolour
 * or fail are hits).
 */
let cached: { key: DocPath[]; w: number; h: number; space: Item } | null = null
function spaceOf(s: InstanceType<Paper['PaperScope']>, doc: Doc, filled: DocPath[]): Item {
  if (cached && cached.w === doc.width && cached.h === doc.height && cached.key.length === filled.length && cached.key.every((p, i) => p === filled[i] || (p.d === filled[i].d && p.id === filled[i].id)))
    return cached.space
  // United pairwise, so a busy drawing stays quick.
  let items = filled.map((p) => new s.CompoundPath({ pathData: p.d, insert: false }) as Item)
  while (items.length > 1) {
    const next: Item[] = []
    for (let i = 0; i < items.length; i += 2) next.push(i + 1 < items.length ? (items[i].unite(items[i + 1], { insert: false }) as Item) : items[i])
    items = next
  }
  const frame = new s.Path.Rectangle({ point: [0, 0], size: [doc.width, doc.height], insert: false }) as unknown as Item
  const space = items.length ? (frame.subtract(items[0], { insert: false }) as Item) : frame
  cached = { key: filled, w: doc.width, h: doc.height, space }
  return space
}
