/**
 * New shapes (#210): the Pen and the Shape tool's rectangle, ellipse, polygon
 * and line, as Inlay's path model (nodes with Bézier handles), written out
 * with the same serializePath the trace uses, so a drawn shape edits with the
 * Nodes tool like a traced one. Pure functions; the canvas only feeds them
 * points.
 */
import { newId, type Doc, type DocPath } from './doc'
import { serializePath, type PathNode, type Pt, type Subpath } from './pathdata'
import type { Box } from './transform'

export type ShapeKind = 'rect' | 'ellipse' | 'polygon' | 'line'
/** The Shape tool's settings: which shape, a rectangle's corner radius (px), a polygon's sides. */
export type ShapeSettings = { kind: ShapeKind; radius: number; sides: number }
export const SHAPE_DEFAULT: ShapeSettings = { kind: 'rect', radius: 0, sides: 6 }
export const MIN_SIDES = 3
export const MAX_SIDES = 24

/** A quarter circle as one cubic: the handle is this share of the radius. */
const KAPPA = 0.5522847498

const node = (x: number, y: number, inH: Pt | null = null, out: Pt | null = null): PathNode => ({ x, y, in: inH, out })
const r2 = (v: number) => Math.round(v * 100) / 100
const rounded = (subs: Subpath[]) => serializePath(subs.map((s) => ({ closed: s.closed, nodes: s.nodes.map((n) => ({ x: r2(n.x), y: r2(n.y), in: n.in && { x: r2(n.in.x), y: r2(n.in.y) }, out: n.out && { x: r2(n.out.x), y: r2(n.out.y) } })) })))

/**
 * The box a drag from `a` to `b` draws: ⇧ makes it square (a circle, an even
 * polygon), ⌥ draws it from `a` as the centre, as in most drawing programs.
 */
export function dragBox(a: Pt, b: Pt, o: { square?: boolean; fromCentre?: boolean } = {}): Box {
  let dx = b.x - a.x
  let dy = b.y - a.y
  if (o.square) {
    const s = Math.max(Math.abs(dx), Math.abs(dy))
    dx = Math.sign(dx || 1) * s
    dy = Math.sign(dy || 1) * s
  }
  if (o.fromCentre) return { x: a.x - Math.abs(dx), y: a.y - Math.abs(dy), w: 2 * Math.abs(dx), h: 2 * Math.abs(dy) }
  return { x: Math.min(a.x, a.x + dx), y: Math.min(a.y, a.y + dy), w: Math.abs(dx), h: Math.abs(dy) }
}

/** A rectangle, clockwise from the top left, its corners rounded by `radius` (at most half the shorter side). */
export function rectPath(b: Box, radius = 0): string {
  const r = Math.max(0, Math.min(radius, b.w / 2, b.h / 2))
  const { x, y, w, h } = b
  if (r <= 0) return rounded([{ closed: true, nodes: [node(x, y), node(x + w, y), node(x + w, y + h), node(x, y + h)] }])
  const k = r * (1 - KAPPA)
  // Two nodes a corner, where the straight edge meets the arc.
  return rounded([
    {
      closed: true,
      nodes: [
        node(x + r, y, { x: x + k, y }, null),
        node(x + w - r, y, null, { x: x + w - k, y }),
        node(x + w, y + r, { x: x + w, y: y + k }, null),
        node(x + w, y + h - r, null, { x: x + w, y: y + h - k }),
        node(x + w - r, y + h, { x: x + w - k, y: y + h }, null),
        node(x + r, y + h, null, { x: x + k, y: y + h }),
        node(x, y + h - r, { x, y: y + h - k }, null),
        node(x, y + r, null, { x, y: y + k }),
      ],
    },
  ])
}

/** An ellipse filling the box: four nodes, top, right, bottom and left, each smooth. */
export function ellipsePath(b: Box): string {
  const rx = b.w / 2
  const ry = b.h / 2
  const cx = b.x + rx
  const cy = b.y + ry
  const kx = rx * KAPPA
  const ky = ry * KAPPA
  return rounded([
    {
      closed: true,
      nodes: [
        node(cx, b.y, { x: cx - kx, y: b.y }, { x: cx + kx, y: b.y }),
        node(b.x + b.w, cy, { x: b.x + b.w, y: cy - ky }, { x: b.x + b.w, y: cy + ky }),
        node(cx, b.y + b.h, { x: cx + kx, y: b.y + b.h }, { x: cx - kx, y: b.y + b.h }),
        node(b.x, cy, { x: b.x, y: cy + ky }, { x: b.x, y: cy - ky }),
      ],
    },
  ])
}

/** A regular polygon of `sides` in the box's inscribed ellipse, a corner at the top. */
export function polygonPath(b: Box, sides: number): string {
  const n = Math.round(Math.min(MAX_SIDES, Math.max(MIN_SIDES, sides)))
  const nodes: PathNode[] = []
  for (let i = 0; i < n; i++) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / n
    nodes.push(node(b.x + b.w / 2 + (b.w / 2) * Math.cos(t), b.y + b.h / 2 + (b.h / 2) * Math.sin(t)))
  }
  return rounded([{ closed: true, nodes }])
}

/** A straight line from `a` to `b`; ⇧ holds it to the nearest 45°. */
export function lineEnd(a: Pt, b: Pt, snap45 = false): Pt {
  if (!snap45) return b
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const t = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: a.x + len * Math.cos(t), y: a.y + len * Math.sin(t) }
}
export const linePath = (a: Pt, b: Pt) => rounded([{ closed: false, nodes: [node(a.x, a.y), node(b.x, b.y)] }])

/** The Shape tool's path for a drag from `a` to `b`, or null for one too small to keep (under `min` across). */
export function shapePath(s: ShapeSettings, a: Pt, b: Pt, o: { shift?: boolean; alt?: boolean; min?: number } = {}): string | null {
  const min = o.min ?? 1
  if (s.kind === 'line') {
    const end = lineEnd(a, b, o.shift)
    return Math.hypot(end.x - a.x, end.y - a.y) < min ? null : linePath(a, end)
  }
  const box = dragBox(a, b, { square: o.shift, fromCentre: o.alt })
  if (box.w < min || box.h < min) return null
  return s.kind === 'rect' ? rectPath(box, s.radius) : s.kind === 'ellipse' ? ellipsePath(box) : polygonPath(box, s.sides)
}

// ---- The Pen -------------------------------------------------------------------------

/**
 * A node the Pen has put down: a click is a corner (no handles), a drag pulls
 * a smooth node's outgoing handle to the pointer and mirrors the incoming one.
 */
export type PenNode = { x: number; y: number; out: Pt | null }

/** A Pen node dragged out to `to`: smooth, its handles either side. */
export const penDrag = (n: Pt, to: Pt): PenNode => ({ x: n.x, y: n.y, out: { x: to.x, y: to.y } })

/** The Pen's nodes as path data: closed (filled) or open (a stroke). */
export function penPath(nodes: PenNode[], closed: boolean): string {
  const out: PathNode[] = nodes.map((n) => ({ x: n.x, y: n.y, out: n.out, in: n.out ? { x: 2 * n.x - n.out.x, y: 2 * n.y - n.out.y } : null }))
  // An open path's ends have nothing beyond them: no handle reaches outward.
  if (!closed && out.length) {
    out[0] = { ...out[0], in: null }
    out[out.length - 1] = { ...out[out.length - 1], out: null }
  }
  return rounded([{ closed, nodes: out }])
}

// ---- Into the drawing -----------------------------------------------------------------

/**
 * `doc` with a new shape: filled with `colour`, or with `stroke` a line that
 * wide in it. It goes just above the topmost selected shape, or on top of
 * everything with nothing selected, so it lands where you're working. Pass
 * `id` when the edit may run twice (a React state updater).
 */
export function addShape(doc: Doc, d: string, colour: string, stroke: number | null, above: string[] = [], id = newId()): { doc: Doc; id: string } {
  const path: DocPath = { id, d, fill: colour, ...(stroke ? { stroke } : {}) }
  const sel = new Set(above)
  let at = doc.paths.length
  if (sel.size) {
    for (let i = doc.paths.length - 1; i >= 0; i--)
      if (sel.has(doc.paths[i].id)) {
        at = i + 1
        break
      }
    // Not inside someone else's group: past the rest of a group the shape sits in.
    const g = doc.paths[at - 1]?.group
    while (g && at < doc.paths.length && doc.paths[at].group === g) at++
  }
  return { doc: { ...doc, paths: [...doc.paths.slice(0, at), path, ...doc.paths.slice(at)] }, id }
}
