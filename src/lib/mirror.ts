/**
 * Mirror: keep one half of the drawing and reflect it onto the other.
 *
 * Done per path, never on the drawing as a whole, so stacked traces keep
 * their paint order: for each path, kept = path ∩ the kept half-plane,
 * reflected = kept flipped across the axis, result = kept ∪ reflected. The
 * union is what makes a shape that crosses the axis come out as one seamless
 * path instead of two halves butting up against each other with a hairline
 * of anti-aliasing between them. Paths entirely on the discarded side come
 * out empty and are dropped.
 *
 * The booleans are paper.js's. It is passed in rather than imported so the app
 * can lazy-load it (src/lib/paper.ts) and the tests can load it under jsdom.
 */
import type PaperNS from 'paper/dist/paper-core'
import type { Doc, DocPath } from './doc'
import { parsePath, serializePath } from './pathdata'

type Paper = typeof PaperNS
type Item = InstanceType<Paper['PathItem']>

export type Axis = {
  /** A vertical axis splits left from right; a horizontal one top from bottom. */
  orientation: 'vertical' | 'horizontal'
  /** x for a vertical axis, y for a horizontal one, in SVG units. */
  position: number
  /** The half to keep: left/top ('start') or right/bottom ('end'). */
  keep: 'start' | 'end'
}

export const centreAxis = (doc: Doc, orientation: Axis['orientation'] = 'vertical', keep: Axis['keep'] = 'start'): Axis => ({
  orientation,
  position: (orientation === 'vertical' ? doc.width : doc.height) / 2,
  keep,
})

let scope: InstanceType<Paper['PaperScope']> | null = null

function scopeFor(paper: Paper) {
  if (!scope) {
    scope = new paper.PaperScope()
    // A size rather than a canvas element: paper creates its own offscreen
    // canvas, which is never attached or drawn to. Nothing here renders.
    scope.setup(new paper.Size(1, 1))
  }
  scope.activate()
  return scope
}

export function mirrorDoc(paper: Paper, doc: Doc, axis: Axis): Doc {
  const s = scopeFor(paper)
  const vertical = axis.orientation === 'vertical'
  const a = axis.position

  // The kept half-plane, as a rectangle big enough to hold every path. The
  // margin keeps the far edge out of the shapes, so it never adds a node.
  let minX = 0
  let minY = 0
  let maxX = doc.width
  let maxY = doc.height
  const items = doc.paths.map((p) => {
    const item = new s.CompoundPath({ pathData: p.d, insert: false })
    const b = item.bounds
    minX = Math.min(minX, b.left)
    minY = Math.min(minY, b.top)
    maxX = Math.max(maxX, b.right)
    maxY = Math.max(maxY, b.bottom)
    return item
  })
  const pad = Math.max(maxX - minX, maxY - minY) + Math.abs(a) + 10
  const from = new s.Point(minX - pad, minY - pad)
  const to = new s.Point(maxX + pad, maxY + pad)
  if (vertical) (axis.keep === 'start' ? to : from).x = a
  else (axis.keep === 'start' ? to : from).y = a
  const half = new s.Path.Rectangle({ from, to, insert: false })
  const pivot = new s.Point(vertical ? a : 0, vertical ? 0 : a)

  const paths: DocPath[] = []
  doc.paths.forEach((p, i) => {
    const kept = items[i].intersect(half, { insert: false }) as Item
    if (isEmpty(kept)) return
    const reflected = kept.clone({ insert: false }) as Item
    reflected.scale(vertical ? -1 : 1, vertical ? 1 : -1, pivot)
    const whole = kept.unite(reflected, { insert: false }) as Item
    if (isEmpty(whole)) return
    // Re-serialised through our own writer so mirrored paths use the same
    // absolute M/L/C/Z form and number precision as node edits.
    const d = serializePath(parsePath(whole.pathData))
    if (d) paths.push({ ...p, d })
  })
  return { ...doc, paths }
}

function isEmpty(item: Item) {
  return !item.pathData || Math.abs((item as InstanceType<Paper['Path']>).area ?? 0) < 1e-6 || item.bounds.isEmpty()
}
