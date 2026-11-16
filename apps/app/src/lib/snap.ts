/**
 * Snapping (#213): a dragged node lands exactly on another shape's node when
 * it comes within a few screen pixels of one, and on whole pixels when the
 * grid is on. Moving shapes snaps the same way, by whichever of their nodes is
 * nearest a node of the shapes standing still.
 */
import type { Pt } from './pathdata'
import type { Box } from './transform'

export type SnapSettings = { nodes: boolean; grid: boolean }
export const SNAP_DEFAULT: SnapSettings = { nodes: true, grid: false }
/** How near, in screen pixels, a point must come to snap. */
export const SNAP_PX = 6
/** Moving shapes, at most this many of their nodes are tried, spread evenly. */
const MAX_MOVING = 400

/** Points hashed into square cells, for finding the nearest one quickly. */
export class SnapIndex {
  private cells = new Map<string, Pt[]>()
  constructor(
    points: Iterable<Pt>,
    private cell: number,
  ) {
    for (const p of points) {
      const k = this.at(p.x, p.y)
      const list = this.cells.get(k)
      if (list) list.push(p)
      else this.cells.set(k, [p])
    }
  }
  private at = (x: number, y: number) => `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`
  /** The nearest point within `tol` of `p` (no further than a cell) that `ok` allows, or null. */
  nearest(p: Pt, tol: number, ok?: (q: Pt) => boolean): Pt | null {
    let best: Pt | null = null
    let bd = Math.min(tol, this.cell)
    const cx = Math.floor(p.x / this.cell)
    const cy = Math.floor(p.y / this.cell)
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (const q of this.cells.get(`${x},${y}`) ?? []) {
          const d = Math.hypot(q.x - p.x, q.y - p.y)
          if (d <= bd && (!ok || ok(q))) {
            bd = d
            best = q
          }
        }
    return best
  }
}

/** Where a dragged point lands: on a node within `tol`, else on the pixel grid if it's on, else where it is. `node` says which. */
export function snapPoint(p: Pt, index: SnapIndex | null, grid: boolean, tol: number): { at: Pt; node: boolean } {
  const q = index?.nearest(p, tol)
  if (q) return { at: { x: q.x, y: q.y }, node: true }
  if (grid) return { at: { x: Math.round(p.x), y: Math.round(p.y) }, node: false }
  return { at: p, node: false }
}

/**
 * A move of shapes by (dx, dy), snapped: so that the moving node nearest a
 * still node lands on it, else so the shapes' bounds start on whole pixels if
 * the grid is on. An axis `held` (⇧ keeps a move level or upright) doesn't
 * change. `at` is the node it snapped to, if any.
 */
export function snapMove(
  dx: number,
  dy: number,
  held: { x: boolean; y: boolean },
  moving: Pt[],
  box: Box | null,
  index: SnapIndex | null,
  grid: boolean,
  tol: number,
): { dx: number; dy: number; at: Pt | null } {
  const lockX = held.x
  const lockY = held.y
  if (index && moving.length) {
    const step = Math.max(1, Math.ceil(moving.length / MAX_MOVING))
    let best: { dx: number; dy: number; d: number; at: Pt } | null = null
    for (let i = 0; i < moving.length; i += step) {
      const p = { x: moving[i].x + dx, y: moving[i].y + dy }
      // On a held axis the node can only land on a still one already level with it.
      const level = lockX || lockY ? (q: Pt) => (!lockX || Math.abs(q.x - p.x) <= 1e-6) && (!lockY || Math.abs(q.y - p.y) <= 1e-6) : undefined
      const q = index.nearest(p, best ? best.d : tol, level)
      if (!q) continue
      const ndx = lockX ? 0 : dx + q.x - p.x
      const ndy = lockY ? 0 : dy + q.y - p.y
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (!best || d < best.d) best = { dx: ndx, dy: ndy, d, at: q }
    }
    if (best) return { dx: best.dx, dy: best.dy, at: best.at }
  }
  if (grid && box) return { dx: lockX ? 0 : Math.round(box.x + dx) - box.x, dy: lockY ? 0 : Math.round(box.y + dy) - box.y, at: null }
  return { dx, dy, at: null }
}
