/**
 * Gap closing (#145): join a line's ends across a small break, before tracing,
 * so a drawn outline that came out in pieces (a lossy save, a faint stretch of
 * pen, a stroke that stops just short of the one it meets) is one line again,
 * and a fill inside it stays inside.
 *
 * After Fourey, Tschumperlé and Revoy, "A fast and efficient semi-guided
 * algorithm for flat coloring line-arts" (VMV 2018, GIMP's "Fill by line art
 * detection"), on the skeleton rather than the ink's border:
 *
 *  1. Thin the ink and prune its spurs. Each skeleton end is a line's end; the
 *     way it points is measured a few widths back along it, and so is the
 *     line's own width there (a local width, not the drawing's: GIMP's lesson).
 *  2. Two ends that point at each other across a gap join. An end that points
 *     at other ink close by reaches it: the T that stops short.
 *  3. A join crosses one gap only: along it, the ink of the line it starts
 *     from, then paper, then the ink it reaches, and nothing else. The paper it
 *     crosses is at most GAP_WIDTHS times the line's width and GAP_MAX px, so
 *     a gap that's drawn (a dashed line, a box left open on purpose) stays
 *     open.
 *  4. The best joins (shortest gap) are painted first, as ink the line's own
 *     width; each end joins once.
 *
 * Written for this project (MIT).
 */
import { prune, strokeWidthOf, thin } from './skeleton'

/** The widest gap closed, in the line's own widths. A drawn gap (dashes, an open box) is wider. */
export const GAP_WIDTHS = 1.6
/** …but never less than this (px): a hairline's breaks are a pixel or two whatever its width. */
const GAP_MIN = 2.5
/**
 * …and never more (px). A break from a lossy save or a faint stretch of pen
 * is a few pixels whatever the pen; on a heavy line a gap of a width is
 * plainly drawn (dashes 8 px wide with 8 px between, a chimney stopping 10 px
 * short of a roof).
 */
const GAP_MAX = 5.5
/** An end's direction is measured this many of the line's widths back along it (at least END_BACK_MIN px). */
const END_BACK = 2.5
const END_BACK_MIN = 4
/** A line shorter than this (px) has no direction to speak of: a dot, a speck. */
const END_MIN = 3
/** How straight at the other end a join must point: cos 40°. */
const FACING = Math.cos((40 * Math.PI) / 180)

const DX = [0, 1, 1, 1, 0, -1, -1, -1]
const DY = [-1, -1, 0, 1, 1, 1, 0, -1]

type End = { i: number; x: number; y: number; dx: number; dy: number; width: number }
type Join = { a: End; b: End | null; tx: number; ty: number; gap: number; width: number }

/**
 * Close small gaps in `ink` (1 = ink), in place. Returns how many joins were
 * painted.
 */
export function closeGaps(ink: Uint8Array, w: number, h: number): number {
  const skel = thin(ink, w, h)
  const width = strokeWidthOf(skel, ink, w)
  prune(skel, w, h, Math.max(3, Math.round(width)))
  const ends = endsOf(skel, ink, w, h, width)
  if (!ends.length) return 0

  const reachOf = (e: End) => Math.min(GAP_MAX, Math.max(GAP_MIN, GAP_WIDTHS * e.width))
  const joins: Join[] = []
  // End to end: both point at the other, and one gap between them.
  const cell = Math.max(8, Math.ceil(4 * width))
  const grid = new Map<number, End[]>()
  const key = (cx: number, cy: number) => cy * 65536 + cx
  for (const e of ends) {
    const k = key(Math.floor(e.x / cell), Math.floor(e.y / cell))
    const list = grid.get(k)
    if (list) list.push(e)
    else grid.set(k, [e])
  }
  for (const a of ends) {
    const cx = Math.floor(a.x / cell)
    const cy = Math.floor(a.y / cell)
    for (let gy = cy - 1; gy <= cy + 1; gy++)
      for (let gx = cx - 1; gx <= cx + 1; gx++)
        for (const b of grid.get(key(gx, gy)) ?? []) {
          if (b.i <= a.i) continue
          const vx = b.x - a.x
          const vy = b.y - a.y
          const d = Math.hypot(vx, vy)
          if (d === 0 || d > (a.width + b.width) / 2 + Math.max(reachOf(a), reachOf(b)) + 2) continue
          if ((a.dx * vx + a.dy * vy) / d < FACING || -(b.dx * vx + b.dy * vy) / d < FACING) continue
          const gap = crossing(ink, w, h, a.x, a.y, b.x, b.y)
          if (gap <= 0 || gap > Math.min(reachOf(a), reachOf(b))) continue
          joins.push({ a, b, tx: b.x, ty: b.y, gap, width: Math.min(a.width, b.width) })
        }
  }
  // End to ink: straight on from the end, across one gap, into other ink.
  for (const a of ends) {
    const hit = reach(ink, w, h, a, reachOf(a))
    // Counted a little longer than an end-to-end join of the same gap, so two ends that meet win.
    if (hit) joins.push({ a, b: null, tx: hit.x, ty: hit.y, gap: hit.gap * 1.25, width: a.width })
  }

  joins.sort((p, q) => p.gap - q.gap)
  const used = new Set<number>()
  let painted = 0
  for (const j of joins) {
    if (used.has(j.a.i) || (j.b && used.has(j.b.i))) continue
    // An earlier join may have closed this gap already.
    if (crossing(ink, w, h, j.a.x, j.a.y, j.tx, j.ty) <= 0) continue
    used.add(j.a.i)
    if (j.b) used.add(j.b.i)
    paint(ink, w, h, j.a.x, j.a.y, j.tx, j.ty, j.width / 2)
    painted++
  }
  return painted
}

/** Each skeleton end of a line long enough to have a direction: where it is, which way it points, and the line's width there. */
function endsOf(skel: Uint8Array, ink: Uint8Array, w: number, h: number, width: number): End[] {
  const ends: End[] = []
  const back = Math.max(END_BACK_MIN, Math.round(END_BACK * width))
  for (let i = 0; i < skel.length; i++) {
    if (!skel[i]) continue
    const x = i % w
    const y = (i / w) | 0
    if (degree(skel, w, h, x, y) !== 1) continue
    // Walk back along the line, to a junction or `back` pixels.
    const path = [i]
    let prev = -1
    let cur = i
    while (path.length <= back) {
      const cx = cur % w
      const cy = (cur / w) | 0
      let next = -1
      let count = 0
      for (let k = 0; k < 8; k++) {
        const nx = cx + DX[k]
        const ny = cy + DY[k]
        const j = ny * w + nx
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || !skel[j] || j === prev || path.includes(j)) continue
        next = j
        count++
      }
      if (count !== 1) break
      prev = cur
      cur = next
      path.push(cur)
      if (degree(skel, w, h, cur % w, (cur / w) | 0) > 2) break
    }
    if (path.length < END_MIN) continue
    const bx = cur % w
    const by = (cur / w) | 0
    const l = Math.hypot(x - bx, y - by)
    if (!l) continue
    // The line's width a little way back from its end, where it's whole.
    const mid = path[Math.floor(path.length / 2)]
    ends.push({ i, x: x + 0.5, y: y + 0.5, dx: (x - bx) / l, dy: (y - by) / l, width: Math.max(1, 2 * radiusAt(ink, w, h, mid % w, (mid / w) | 0, 2 * width + 2)) })
  }
  return ends
}

function degree(img: Uint8Array, w: number, h: number, x: number, y: number) {
  let d = 0
  for (let k = 0; k < 8; k++) {
    const nx = x + DX[k]
    const ny = y + DY[k]
    if (nx >= 0 && nx < w && ny >= 0 && ny < h && img[ny * w + nx]) d++
  }
  return d
}

/** Distance from pixel (x, y)'s centre to the nearest paper, up to `max`: half the line's width there. */
function radiusAt(ink: Uint8Array, w: number, h: number, x: number, y: number, max: number) {
  let best = max
  const r = Math.ceil(max)
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || ink[ny * w + nx]) continue
      // To the paper pixel's near edge, not its centre.
      const d = Math.hypot(Math.max(0, Math.abs(dx) - 0.5), Math.max(0, Math.abs(dy) - 0.5))
      if (d < best) best = d
    }
  return best
}

/**
 * Along the segment from (ax, ay) to (bx, by), sampled every half pixel: the
 * length of paper crossed, when it's ink, then one stretch of paper, then
 * ink; 0 when it never leaves the ink; -1 when it crosses more than one gap
 * (another line in between) or ends on paper.
 */
function crossing(ink: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number): number {
  const d = Math.hypot(bx - ax, by - ay)
  const steps = Math.max(1, Math.ceil(d * 2))
  let state = 0 // 0: in the first ink, 1: crossing paper, 2: in the far ink
  let gap = 0
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    const px = Math.floor(ax + (bx - ax) * t)
    const py = Math.floor(ay + (by - ay) * t)
    const on = px >= 0 && px < w && py >= 0 && py < h && ink[py * w + px] === 1
    if (state === 0 && !on) state = 1
    else if (state === 1 && on) state = 2
    else if (state === 2 && !on) return -1
    if (state === 1) gap += d / steps
  }
  if (state === 1) return -1
  return state === 0 ? 0 : gap
}

/** Straight on from end `e`: out of its own ink, across paper no wider than `max`, into other ink. */
function reach(ink: Uint8Array, w: number, h: number, e: End, max: number): { x: number; y: number; gap: number } | null {
  const step = 0.5
  let left = false
  let gap = 0
  for (let t = step; t <= e.width + max + 1; t += step) {
    const x = e.x + e.dx * t
    const y = e.y + e.dy * t
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || px >= w || py < 0 || py >= h) return null
    const on = ink[py * w + px] === 1
    if (!left) {
      if (!on) left = true
      else continue
    }
    if (!on) {
      gap += step
      if (gap > max) return null
      continue
    }
    // Into ink: a little way in, so the join overlaps it.
    return { x: x + e.dx * Math.min(1, e.width / 2), y: y + e.dy * Math.min(1, e.width / 2), gap }
  }
  return null
}

/** Ink along the segment, `r` px either side of it (a round-capped stroke). */
function paint(ink: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, r: number) {
  const rr = Math.max(0.75, r)
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy || 1
  for (let y = Math.max(0, Math.floor(Math.min(ay, by) - rr)); y <= Math.min(h - 1, Math.ceil(Math.max(ay, by) + rr)); y++)
    for (let x = Math.max(0, Math.floor(Math.min(ax, bx) - rr)); x <= Math.min(w - 1, Math.ceil(Math.max(ax, bx) + rr)); x++) {
      const px = x + 0.5
      const py = y + 0.5
      const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2))
      if ((px - ax - vx * t) ** 2 + (py - ay - vy * t) ** 2 <= rr * rr) ink[y * w + x] = 1
    }
}
