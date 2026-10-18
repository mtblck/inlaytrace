/**
 * Mirror: keep one half of the drawing and reflect it onto the other, or keep
 * one slice of a turn and repeat it round the centre.
 *
 * Done per path, never on the drawing as a whole, so stacked traces keep
 * their paint order: for each path, kept = path ∩ the kept half-plane,
 * reflected = kept flipped across the axis, result = kept ∪ reflected. The
 * union is what makes a shape that crosses the axis come out as one seamless
 * path instead of two halves butting up against each other with a hairline
 * of anti-aliasing between them. Paths entirely on the discarded side come
 * out empty and are dropped. A turn works the same way with a wedge, inside
 * the largest circle round the centre that fits the picture: kept = path ∩ the
 * wedge pointing straight up, result = the union of kept turned by every
 * multiple of 360°/order, plus the path outside the circle as it was. Without
 * that circle a square background, turned in fifths, loses its corners.
 *
 * The booleans are paper.js's. It is passed in rather than imported so the app
 * can lazy-load it (src/lib/paper.ts) and the tests can load it under jsdom.
 */
import type PaperNS from 'paper/dist/paper-core'
import type { Doc, DocPath } from './doc'
import type { Symmetry } from 'inlaytrace'
import { parsePath, serializePath } from './pathdata'

type Paper = typeof PaperNS
type Item = InstanceType<Paper['PathItem']>

export type MirrorAxis = {
  /** A vertical axis splits left from right; a horizontal one top from bottom. */
  orientation: 'vertical' | 'horizontal'
  /** x for a vertical axis, y for a horizontal one, in SVG units. */
  position: number
  /** The half to keep: left/top ('start') or right/bottom ('end'). */
  keep: 'start' | 'end'
}

/** Rotational symmetry: the slice pointing straight up from (cx, cy) is kept and repeated `order` times, within {@link turnRadius}. */
export type TurnAxis = {
  orientation: 'rotation'
  cx: number
  cy: number
  order: number
}

export type Axis = MirrorAxis | TurnAxis

export const MIN_ORDER = 2
export const MAX_ORDER = 12

export const centreAxis = (doc: Doc, orientation: MirrorAxis['orientation'] = 'vertical', keep: MirrorAxis['keep'] = 'start'): MirrorAxis => ({
  orientation,
  position: (orientation === 'vertical' ? doc.width : doc.height) / 2,
  keep,
})

export const centreTurn = (doc: Doc, order = 4): TurnAxis => ({ orientation: 'rotation', cx: doc.width / 2, cy: doc.height / 2, order })

/** The share of the drawing a detected symmetry must match to be offered. */
export const LIKELY = 0.95

/** The likeliest symmetry in a detection, as an axis to mirror or turn about; null if none is likely. */
export function likelyAxis(found: Symmetry[]): (Axis & { score: number }) | null {
  // A drawing with order-4 symmetry also has order 2, and a round one scores
  // for every order: prefer the highest order that's nearly as good as the best.
  const ok = found.filter((s) => s.score >= LIKELY)
  if (!ok.length) return null
  const top = ok[0].score
  const turns = ok.filter((s) => s.kind === 'rotation' && s.score >= top - 0.01)
  const pick = turns.length ? turns.reduce((a, b) => (b.kind === 'rotation' && a.kind === 'rotation' && b.order > a.order ? b : a)) : ok[0]
  return pick.kind === 'mirror'
    ? { orientation: pick.orientation, position: pick.position, keep: 'start', score: pick.score }
    : { orientation: 'rotation', cx: Math.round(pick.cx * 2) / 2, cy: Math.round(pick.cy * 2) / 2, order: pick.order, score: pick.score }
}

/** Whether two axes are the same place (the kept side aside). */
export function sameAxis(a: Axis, b: Axis) {
  if (a.orientation === 'rotation' || b.orientation === 'rotation')
    return a.orientation === 'rotation' && b.orientation === 'rotation' && a.order === b.order && Math.abs(a.cx - b.cx) < 0.5 && Math.abs(a.cy - b.cy) < 0.5
  return a.orientation === b.orientation && Math.abs(a.position - b.position) < 0.5
}

/** The radius of the circle a turn applies inside: the largest round (cx, cy) that fits the picture. */
export const turnRadius = (axis: TurnAxis, width: number, height: number) => Math.max(0, Math.min(axis.cx, axis.cy, width - axis.cx, height - axis.cy))

/** The corners of the kept slice of a turn, as an angle range in radians (0 is +x, clockwise on screen). */
export function turnSlice(order: number) {
  const span = (2 * Math.PI) / order
  const from = -Math.PI / 2 - span / 2
  return { from, to: from + span }
}

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
  if (axis.orientation === 'rotation') return turnDoc(paper, doc, axis)
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

function turnDoc(paper: Paper, doc: Doc, axis: TurnAxis): Doc {
  const s = scopeFor(paper)
  const order = Math.min(MAX_ORDER, Math.max(MIN_ORDER, Math.round(axis.order)))
  const centre = new s.Point(axis.cx, axis.cy)
  const r = turnRadius(axis, doc.width, doc.height)
  if (r <= 0) return doc
  const circle = new s.Path.Circle({ center: centre, radius: r, insert: false })
  // The kept slice of that circle: the centre, then the arc as a fine polygon
  // just outside it (so the circle, not the polygon, is the boundary that counts).
  const { from, to } = turnSlice(order)
  const steps = 48
  const wedge = new s.Path({ insert: false, closed: true })
  wedge.add(centre)
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps
    wedge.add(new s.Point(axis.cx + r * 1.1 * Math.cos(t), axis.cy + r * 1.1 * Math.sin(t)))
  }
  const slice = circle.intersect(wedge, { insert: false }) as Item

  const paths: DocPath[] = []
  doc.paths.forEach((p) => {
    const item = new s.CompoundPath({ pathData: p.d, insert: false })
    // A shape that covers the whole circle (a background) is already symmetric
    // there: cutting and re-joining it would only add seams.
    const inCircle = item.intersect(circle, { insert: false }) as Item
    if (Math.abs(areaOf(inCircle) - Math.PI * r * r) < 1e-3 * r * r) return void paths.push(p)
    let whole = item.subtract(circle, { insert: false }) as Item
    const kept = item.intersect(slice, { insert: false }) as Item
    if (!isEmpty(kept))
      for (let k = 0; k < order; k++) {
        const turned = kept.clone({ insert: false }) as Item
        if (k) turned.rotate((360 * k) / order, centre)
        whole = whole.unite(turned, { insert: false }) as Item
      }
    if (isEmpty(whole)) return
    const d = serializePath(parsePath(whole.pathData))
    if (d) paths.push({ ...p, d })
  })
  return { ...doc, paths }
}

const areaOf = (item: Item) => Math.abs((item as InstanceType<Paper['Path']>).area ?? 0)

function isEmpty(item: Item) {
  return !item.pathData || Math.abs((item as InstanceType<Paper['Path']>).area ?? 0) < 1e-6 || item.bounds.isEmpty()
}
