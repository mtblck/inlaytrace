/**
 * Skeleton strokes: thin ink to a one-pixel skeleton and fit it as strokes
 * down the middle. Centerline traces a whole drawing this way; outline art
 * (`strokes` in the colour tracer) traces just its thin lines.
 *
 *  1. Thin the ink to a one-pixel skeleton (Zhang and Suen, "A fast parallel
 *     algorithm for thinning digital patterns", CACM 1984).
 *  2. Measure the stroke width: the ink's area over the skeleton's length.
 *  3. Prune spurs: short branches that thinning grows from bumps in the
 *     outline, anything shorter than the stroke is wide.
 *  4. Walk the skeleton into chains between ends and junctions. Thinning bends
 *     the skeleton toward each junction, so within a stroke width of one the
 *     arms are dropped and drawn straight on to where their own lines meet.
 *     Where strokes cross or branch, chains that carry on in the same
 *     direction are joined, so a plotter lifts its pen less. Thinning also
 *     rounds a sharp corner off, turning inside it, so a corner's arms are
 *     drawn straight on to where they meet.
 *  5. Fit each chain with the same curve fitter as outlines.
 */
import { fitChain, isFlat, type Cubic } from './fit'
import type { PathNode, Pt, Subpath } from './path'

/** The ink's skeleton as fitted subpaths (open, or closed for a loop), and the stroke width measured from the ink. `thinned` is the skeleton, if already thinned; it is pruned in place. */
export function skeletonStrokes(ink: Uint8Array, w: number, h: number, o: { tolerance: number; cornerAngle: number }, thinned?: Uint8Array): { subs: Subpath[]; measured: number } {
  const skel = thinned ?? thin(ink, w, h)
  const measured = strokeWidthOf(skel, ink, w)
  prune(skel, w, h, Math.max(3, Math.round(measured)))
  const subs: Subpath[] = []
  for (const c of joinStraight(refitJunctions(walk(skel, w, h), measured)).map((c) => refitCorners(c, measured, ink, w, h))) {
    if (c.pts.length < 2) continue
    const cubics = c.pts.length < 4 ? polyline(c.pts) : fitChain(c.pts, c.closed, { tolerance: o.tolerance, cornerAngle: o.cornerAngle, smoothing: 6 })
    if (cubics.length) subs.push(toSubpath(cubics, c.closed))
  }
  return { subs, measured }
}

// ---- Width ---------------------------------------------------------------------

/**
 * The stroke width: the ink's area over the skeleton's length. (The distance
 * transform's median is out by a pixel on even widths, where the skeleton
 * can't sit on the middle.)
 */
function strokeWidthOf(skel: Uint8Array, ink: Uint8Array, w: number) {
  let area = 0
  let length = 0
  for (let i = 0; i < ink.length; i++) {
    area += ink[i]
    if (!skel[i]) continue
    // Half of each step to a neighbour, so every step is counted once.
    const x = i % w
    if (x + 1 < w && skel[i + 1]) length += 1
    if (skel[i + w]) length += 1
    if (x + 1 < w && skel[i + w + 1]) length += Math.SQRT2
    if (x > 0 && skel[i + w - 1]) length += Math.SQRT2
  }
  return length > 0 ? Math.max(1, area / length) : 1
}

/**
 * Each of `m` regions of the ink (`comp`, VOID outside): its skeleton's length
 * and its stroke width (and the skeleton itself, thinning being local to each region), measured as `strokeWidthOf` does (0 where it thins to
 * a single pixel, which no stroke can be drawn along).
 */
export function regionWidths(ink: Uint8Array, w: number, h: number, comp: Int32Array, m: number): { width: Float64Array; length: Float64Array; skel: Uint8Array } {
  const skel = thin(ink, w, h)
  const area = new Float64Array(m)
  const length = new Float64Array(m)
  for (let i = 0; i < ink.length; i++) {
    const c = comp[i]
    if (!ink[i] || c < 0) continue
    area[c]++
    if (!skel[i]) continue
    const x = i % w
    if (x + 1 < w && skel[i + 1]) length[c] += 1
    if (skel[i + w]) length[c] += 1
    if (x + 1 < w && skel[i + w + 1]) length[c] += Math.SQRT2
    if (x > 0 && skel[i + w - 1]) length[c] += Math.SQRT2
  }
  return { width: area.map((a, c) => (length[c] > 0 ? Math.max(1, a / length[c]) : 0)), length, skel }
}

// ---- Thinning ------------------------------------------------------------------

/** The eight neighbours P2…P9, clockwise from north, as offsets. */
const DX = [0, 1, 1, 1, 0, -1, -1, -1]
const DY = [-1, -1, 0, 1, 1, 1, 0, -1]

function neighbours(img: Uint8Array, w: number, h: number, x: number, y: number) {
  const p: number[] = []
  for (let k = 0; k < 8; k++) {
    const nx = x + DX[k]
    const ny = y + DY[k]
    p.push(nx >= 0 && nx < w && ny >= 0 && ny < h ? img[ny * w + nx] : 0)
  }
  return p
}

/** 0 → 1 transitions round the neighbourhood: 1 on a line or an end, 3+ at a junction. */
const crossings = (p: number[]) => {
  let n = 0
  for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) n++
  return n
}

/** How many 8-connected groups the set neighbours form among themselves. */
function pieces(p: number[]) {
  const seen = [false, false, false, false, false, false, false, false]
  let groups = 0
  for (let k = 0; k < 8; k++) {
    if (!p[k] || seen[k]) continue
    groups++
    const stack = [k]
    seen[k] = true
    while (stack.length) {
      const a = stack.pop()!
      for (let b = 0; b < 8; b++)
        if (p[b] && !seen[b] && Math.abs(DX[a] - DX[b]) <= 1 && Math.abs(DY[a] - DY[b]) <= 1) {
          seen[b] = true
          stack.push(b)
        }
    }
  }
  return groups
}

/** A neighbourhood as a byte: bit k set when neighbour P(k+2) (clockwise from north) is ink. */
const unbits = (m: number) => [0, 1, 2, 3, 4, 5, 6, 7].map((k) => (m >> k) & 1)
/** For every neighbourhood: removable on Zhang–Suen's first and second sub-pass, and redundant afterwards. */
const ZS1 = new Uint8Array(256)
const ZS2 = new Uint8Array(256)
const SPARE = new Uint8Array(256)
for (let m = 0; m < 256; m++) {
  const p = unbits(m)
  const b = p.reduce((s, v) => s + v, 0)
  const ok = b >= 2 && b <= 6 && crossings(p) === 1
  // P2 P4 P6 and P4 P6 P8 on the first pass; P2 P4 P8 and P2 P6 P8 on the second.
  ZS1[m] = ok && !(p[0] * p[2] * p[4]) && !(p[2] * p[4] * p[6]) ? 1 : 0
  ZS2[m] = ok && !(p[0] * p[2] * p[6]) && !(p[0] * p[4] * p[6]) ? 1 : 0
  SPARE[m] = b >= 2 && pieces(p) === 1 ? 1 : 0
}

function thin(ink: Uint8Array, w: number, h: number): Uint8Array {
  // Work on a copy with a blank one-pixel border, so no neighbour is off the edge.
  const W = w + 2
  const img = new Uint8Array(W * (h + 2))
  const live: number[] = []
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (ink[y * w + x]) {
        img[(y + 1) * W + x + 1] = 1
        live.push((y + 1) * W + x + 1)
      }
  const off = DX.map((dx, k) => DY[k] * W + dx)
  const mask = (i: number) => {
    let m = 0
    for (let k = 0; k < 8; k++) if (img[i + off[k]]) m |= 1 << k
    return m
  }
  // Only pixels on the edge of the ink can go, and only a neighbour of one that
  // just went can become an edge: keep that frontier rather than rescanning
  // all the ink each pass (thick strokes take dozens of passes).
  const stamp = new Int32Array(img.length)
  const gone: number[] = []
  let edge = live.filter((i) => mask(i) !== 255)
  // Done when both sub-passes in a row remove nothing.
  for (let round = 0, quiet = 0; quiet < 2 && edge.length; round++) {
    const table = round % 2 ? ZS2 : ZS1
    gone.length = 0
    for (const i of edge) if (img[i] && table[mask(i)]) gone.push(i)
    for (const i of gone) img[i] = 0
    quiet = gone.length ? 0 : quiet + 1
    const next: number[] = []
    const add = (i: number) => {
      if (img[i] && stamp[i] !== round + 1) {
        stamp[i] = round + 1
        next.push(i)
      }
    }
    for (const i of edge) add(i)
    for (const i of gone) for (let k = 0; k < 8; k++) add(i + off[k])
    edge = next
  }
  // Zhang–Suen leaves the line two pixels thick in places (staircases, the
  // corners of turns). Remove any pixel whose neighbours stay 8-connected to
  // each other without it, except a line's ends, until none is left: every
  // line pixel then has exactly two neighbours.
  edge.sort((a, b) => a - b) // in raster order, so the result doesn't depend on how thinning went
  for (let changed = true; changed; ) {
    changed = false
    for (const i of edge)
      if (img[i] && SPARE[mask(i)]) {
        img[i] = 0
        changed = true
      }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = img[(y + 1) * W + x + 1]
  return out
}

// ---- Spurs ---------------------------------------------------------------------

const degree = (img: Uint8Array, w: number, h: number, i: number) => neighbours(img, w, h, i % w, (i / w) | 0).reduce((s, v) => s + v, 0)

/** Remove branches from an end to a junction shorter than `min` pixels, until none are left. */
function prune(skel: Uint8Array, w: number, h: number, min: number) {
  for (let pass = 0; pass < 4; pass++) {
    let removed = false
    for (let i = 0; i < skel.length; i++) {
      if (!skel[i] || degree(skel, w, h, i) !== 1) continue
      // Walk from this end until a junction, another end, or `min` pixels.
      const path = [i]
      let prev = -1
      let cur = i
      let atJunction = false
      while (path.length <= min) {
        const x = cur % w
        const y = (cur / w) | 0
        const next: number[] = []
        for (let k = 0; k < 8; k++) {
          const nx = x + DX[k]
          const ny = y + DY[k]
          const j = ny * w + nx
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && skel[j] && j !== prev && !path.includes(j)) next.push(j)
        }
        if (next.length !== 1 || degree(skel, w, h, next[0]) > 2) {
          atJunction = next.length >= 1
          break
        }
        prev = cur
        cur = next[0]
        path.push(cur)
      }
      // A branch that reaches a junction within `min` is a spur; an isolated
      // short stroke (a dot, a dash) is kept.
      if (atJunction && path.length <= min) {
        for (const j of path) skel[j] = 0
        removed = true
      }
    }
    if (!removed) break
  }
}

// ---- Chains --------------------------------------------------------------------

type Chain = { pts: Pt[]; closed: boolean }

/**
 * Walk the skeleton into chains. Nodes are ends (one neighbour) and junction
 * pixels (three or more); adjacent junction pixels form one junction, met at
 * its centre. What's left once every chain from a node is walked is loops.
 */
function walk(skel: Uint8Array, w: number, h: number): Chain[] {
  const n = w * h
  const isNode = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (skel[i] && degree(skel, w, h, i) !== 2) isNode[i] = 1
  // Group touching junction pixels; each group meets at its centroid.
  const group = new Int32Array(n).fill(-1)
  const centres: Pt[] = []
  for (let i = 0; i < n; i++) {
    if (!isNode[i] || group[i] >= 0) continue
    const g = centres.length
    const stack = [i]
    group[i] = g
    let sx = 0
    let sy = 0
    let c = 0
    while (stack.length) {
      const j = stack.pop()!
      sx += (j % w) + 0.5
      sy += ((j / w) | 0) + 0.5
      c++
      const x = j % w
      const y = (j / w) | 0
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k]
        const ny = y + DY[k]
        const m = ny * w + nx
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && isNode[m] && group[m] < 0 && degree(skel, w, h, m) > 2 && degree(skel, w, h, j) > 2) {
          group[m] = g
          stack.push(m)
        }
      }
    }
    centres.push({ x: sx / c, y: sy / c })
  }

  const used = new Uint8Array(n) // path pixels already in a chain
  const centre = (i: number): Pt => ({ x: (i % w) + 0.5, y: ((i / w) | 0) + 0.5 })
  const next = (i: number, from: number) => {
    const x = i % w
    const y = (i / w) | 0
    // 4-neighbours first, so a staircase is walked, not cut across.
    for (const k of [0, 2, 4, 6, 1, 3, 5, 7]) {
      const nx = x + DX[k]
      const ny = y + DY[k]
      const j = ny * w + nx
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && skel[j] && j !== from && !used[j] && !(isNode[j] && group[j] === group[from] && group[from] >= 0)) return j
    }
    return -1
  }
  const chains: Chain[] = []
  const linked = new Set<string>()
  for (let i = 0; i < n; i++) {
    if (!isNode[i]) continue
    const x = i % w
    const y = (i / w) | 0
    for (let k = 0; k < 8; k++) {
      const nx = x + DX[k]
      const ny = y + DY[k]
      const j = ny * w + nx
      if (nx < 0 || nx >= w || ny < 0 || ny >= h || !skel[j] || used[j]) continue
      if (isNode[j]) {
        // Two nodes side by side in different groups: a one-step chain, once.
        if (group[j] === group[i]) continue
        const key = [group[i], group[j]].sort().join(',')
        if (linked.has(key)) continue
        linked.add(key)
        chains.push({ pts: [centres[group[i]], centres[group[j]]], closed: false })
        continue
      }
      const pts: Pt[] = [centres[group[i]]]
      let prev = i
      let cur = j
      while (cur >= 0 && !isNode[cur]) {
        used[cur] = 1
        pts.push(centre(cur))
        const nxt = next(cur, prev)
        prev = cur
        cur = nxt
      }
      if (cur >= 0) {
        // Out of a junction and straight back into it: a kink inside the junction, not a stroke.
        if (group[cur] === group[i] && pts.length <= 3) continue
        pts.push(centres[group[cur]])
      }
      chains.push({ pts, closed: false })
    }
  }
  // Loops: rings with no ends or junctions.
  for (let i = 0; i < n; i++) {
    if (!skel[i] || used[i] || isNode[i]) continue
    const pts: Pt[] = []
    let prev = -1
    let cur = i
    while (cur >= 0 && !used[cur]) {
      used[cur] = 1
      pts.push(centre(cur))
      const nxt = next(cur, prev)
      prev = cur
      cur = nxt
    }
    chains.push({ pts, closed: pts.length > 2 })
  }
  return chains
}

/**
 * Thinning pulls the skeleton toward a junction: a T's stem bends to meet the
 * bar, and an X's two strokes run together for a stroke's width at the
 * crossing. Within `width` of a junction the skeleton is the junction's shape,
 * not the strokes', so each arm is cut back there, its direction measured just
 * outside, and all the arms are drawn straight on to the point nearest every
 * arm's line (least squares), which is where the strokes really meet. If the
 * arms are near parallel, or that point is further than `width` from the
 * junction, the junction's centre stays.
 */
function refitJunctions(chains: Chain[], width: number): Chain[] {
  const key = (p: Pt) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`
  type End = { chain: Chain; atStart: boolean }
  const ends = new Map<string, End[]>()
  for (const c of chains)
    if (!c.closed)
      for (const atStart of [true, false]) {
        const k = key(atStart ? c.pts[0] : c.pts[c.pts.length - 1])
        ends.set(k, [...(ends.get(k) ?? []), { chain: c, atStart }])
      }
  const cut = Math.max(2, width)
  const reach = Math.max(6, width)
  // Where each end is cut back to: an index into its chain, counted from that end.
  const cuts = new Map<Chain, { start?: number; end?: number; startAt?: Pt; endAt?: Pt }>()
  for (const [, list] of ends) {
    if (list.length < 3) continue
    const at = list[0].atStart ? list[0].chain.pts[0] : list[0].chain.pts[list[0].chain.pts.length - 1]
    const arms: { end: End; from: number; a: Pt; d: Pt }[] = []
    for (const e of list) {
      const pts = e.atStart ? e.chain.pts : [...e.chain.pts].reverse()
      // An arm too short to measure, or one that comes back to this junction, keeps its shape.
      if (e.chain.pts[0] === e.chain.pts[e.chain.pts.length - 1] || key(e.chain.pts[0]) === key(e.chain.pts[e.chain.pts.length - 1])) continue
      const from = pts.findIndex((p) => Math.hypot(p.x - at.x, p.y - at.y) >= cut)
      const to = pts.findIndex((p) => Math.hypot(p.x - at.x, p.y - at.y) >= cut + reach)
      if (from < 0 || to < 0 || to >= pts.length - 1) continue
      const a = pts[from]
      const b = pts[to]
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
      arms.push({ end: e, from, a, d: { x: (b.x - a.x) / l, y: (b.y - a.y) / l } })
    }
    if (arms.length < 2) continue
    // The point nearest every arm's line: Σ(I − ddᵀ) p = Σ(I − ddᵀ) a.
    let [m00, m01, m11, v0, v1] = [0, 0, 0, 0, 0]
    for (const { a, d } of arms) {
      const [p00, p01, p11] = [1 - d.x * d.x, -d.x * d.y, 1 - d.y * d.y]
      m00 += p00
      m01 += p01
      m11 += p11
      v0 += p00 * a.x + p01 * a.y
      v1 += p01 * a.x + p11 * a.y
    }
    const det = m00 * m11 - m01 * m01
    let meet = at
    if (det > 0.05 * arms.length * arms.length) {
      const p = { x: (m11 * v0 - m01 * v1) / det, y: (m00 * v1 - m01 * v0) / det }
      if (Math.hypot(p.x - at.x, p.y - at.y) <= cut) meet = p
    }
    for (const { end, from } of arms) {
      const c = cuts.get(end.chain) ?? {}
      if (end.atStart) {
        c.start = from
        c.startAt = meet
      } else {
        c.end = from
        c.endAt = meet
      }
      cuts.set(end.chain, c)
    }
    // Arms left alone still end at the meeting point, so every end here stays joined.
    for (const e of list)
      if (!arms.some((x) => x.end === e)) {
        const c = cuts.get(e.chain) ?? {}
        if (e.atStart) {
          c.start ??= 0
          c.startAt = meet
        } else {
          c.end ??= 0
          c.endAt = meet
        }
        cuts.set(e.chain, c)
      }
  }
  return chains.map((c) => {
    const k = cuts.get(c)
    if (!k) return c
    const n = c.pts.length
    const s = k.start ?? 0
    const e = n - 1 - (k.end ?? 0)
    // Cut back from both ends past each other: a short link between two junctions keeps its points.
    const pts = e > s ? c.pts.slice(s, e + 1) : [...c.pts]
    const cutStart = e > s && s > 0
    const cutEnd = e > s && e < n - 1
    if (k.startAt) cutStart ? pts.unshift(k.startAt) : (pts[0] = k.startAt)
    if (k.endAt) cutEnd ? pts.push(k.endAt) : (pts[pts.length - 1] = k.endAt)
    return { pts, closed: false }
  })
}

/** A chain turns this much (radians) across a corner before it's redrawn as one: 60°. */
const CORNER_TURN = Math.PI / 3

/**
 * Sharp corners drawn sharp. Thinning a stroke that turns sharply cuts the
 * corner: the skeleton turns inside it, short of the point by up to a few
 * stroke widths (a flag's swallowtail comes out rounded). Where the chain's
 * direction just before a point and just after it (measured outside a stroke
 * width of it, as at junctions) differs by more than CORNER_TURN, the points
 * within a stroke width are replaced by where the two arms' lines meet, if
 * the ink runs on toward that point past where the stroke's edge would be.
 * A rounded corner or a small ring turns as much, but its ink stops half a
 * width out, so it keeps its shape.
 */
function refitCorners(c: Chain, width: number, ink: Uint8Array, w: number, h: number): Chain {
  const pts = c.pts
  const n = pts.length
  const cut = Math.max(2, width)
  const reach = Math.max(6, width)
  if (n < 4) return c
  const s = [0]
  for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const at = (t: number): Pt => {
    let j = 1
    while (j < n - 1 && s[j] < t) j++
    const f = s[j] > s[j - 1] ? (t - s[j - 1]) / (s[j] - s[j - 1]) : 0
    return { x: pts[j - 1].x + f * (pts[j].x - pts[j - 1].x), y: pts[j - 1].y + f * (pts[j].y - pts[j - 1].y) }
  }
  const unit = (a: Pt, b: Pt): Pt => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
  }
  const isInk = (p: Pt) => {
    const x = Math.floor(p.x)
    const y = Math.floor(p.y)
    return x >= 0 && y >= 0 && x < w && y < h && ink[y * w + x] === 1
  }
  type Corner = { i: number; turn: number; apex: Pt }
  const found: Corner[] = []
  for (let i = 1; i < n - 1; i++) {
    if (s[i] - cut - reach < 0 || s[i] + cut + reach > s[n - 1]) continue
    const pa = at(s[i] - cut)
    const d1 = unit(at(s[i] - cut - reach), pa)
    const qa = at(s[i] + cut)
    const d2 = unit(qa, at(s[i] + cut + reach))
    const turn = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)))
    if (turn < CORNER_TURN) continue
    // Where pa + u·d1 meets qa − v·d2.
    const det = d1.x * -d2.y - d1.y * -d2.x
    if (Math.abs(det) < 1e-6) continue
    const u = ((qa.x - pa.x) * -d2.y - (qa.y - pa.y) * -d2.x) / det
    if (u < 0) continue
    const apex = { x: pa.x + u * d1.x, y: pa.y + u * d1.y }
    const off = Math.hypot(apex.x - pts[i].x, apex.y - pts[i].y)
    if (off < 0.5 || off > 3 * width || !isInk(apex)) continue
    // The ink runs on past the stroke's edge toward the point: a rounded
    // corner (or a small ring) ends half a width out, a cut-off point doesn't.
    const past = width / 2 + 1.5
    if (!isInk({ x: pts[i].x + ((apex.x - pts[i].x) / off) * past, y: pts[i].y + ((apex.y - pts[i].y) / off) * past })) continue
    const last = found[found.length - 1]
    if (last && s[i] - s[last.i] < 2 * cut) {
      if (turn > last.turn) found[found.length - 1] = { i, turn, apex }
    } else found.push({ i, turn, apex })
  }
  if (!found.length) return c
  const out: Pt[] = []
  let k = 0
  for (let i = 0; i < n; i++) {
    const f = found[k]
    if (f && s[i] > s[f.i] - cut) {
      if (s[i] < s[f.i] + cut) continue
      out.push(f.apex)
      k++
      i--
      continue
    }
    out.push(pts[i])
  }
  for (; k < found.length; k++) out.push(found[k].apex)
  return { ...c, pts: out }
}

/** The direction a chain leaves its start, measured a few pixels along it. */
function leaving(pts: Pt[]): Pt {
  const a = pts[0]
  const b = pts[Math.min(pts.length - 1, 6)]
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l }
}

/**
 * Join chains that meet end to end and carry straight on (within 30°), so a
 * line through a crossing is one stroke. Each end joins at most once.
 */
function joinStraight(chains: Chain[]): Chain[] {
  const key = (p: Pt) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`
  type End = { chain: Chain; atStart: boolean }
  const live = new Set(chains.filter((c) => !c.closed))
  const ends = new Map<string, End[]>()
  const addEnds = (c: Chain) => {
    for (const atStart of [true, false]) {
      const k = key(atStart ? c.pts[0] : c.pts[c.pts.length - 1])
      const list = ends.get(k) ?? []
      list.push({ chain: c, atStart })
      ends.set(k, list)
    }
  }
  live.forEach(addEnds)
  const out = chains.filter((c) => c.closed)
  const outward = (e: End) => leaving(e.atStart ? e.chain.pts : [...e.chain.pts].reverse())
  for (const [, list] of ends) {
    // Pair the ends here that point most nearly opposite ways.
    for (;;) {
      const here = list.filter((e) => live.has(e.chain))
      let best: [End, End] | null = null
      let bestDot = -Math.cos((150 * Math.PI) / 180)
      for (let a = 0; a < here.length; a++)
        for (let b = a + 1; b < here.length; b++) {
          if (here[a].chain === here[b].chain) continue
          const da = outward(here[a])
          const db = outward(here[b])
          const dot = da.x * db.x + da.y * db.y
          if (dot < -bestDot) {
            bestDot = -dot
            best = [here[a], here[b]]
          }
        }
      if (!best) break
      const [ea, eb] = best
      const a = ea.atStart ? [...ea.chain.pts].reverse() : ea.chain.pts
      const b = eb.atStart ? eb.chain.pts : [...eb.chain.pts].reverse()
      const joined: Chain = { pts: [...a, ...b.slice(1)], closed: false }
      live.delete(ea.chain)
      live.delete(eb.chain)
      live.add(joined)
      addEnds(joined)
      // A joined chain whose two ends meet is a loop.
      if (key(joined.pts[0]) === key(joined.pts[joined.pts.length - 1]) && joined.pts.length > 3) {
        live.delete(joined)
        out.push({ pts: joined.pts.slice(0, -1), closed: true })
      }
    }
  }
  return [...out, ...live]
}

// ---- Output --------------------------------------------------------------------

const polyline = (pts: Pt[]): Cubic[] => pts.slice(1).map((b, i) => [pts[i], pts[i], b, b] as Cubic)

function toSubpath(cubics: Cubic[], closed: boolean): Subpath {
  const r = (p: Pt) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })
  const nodes: PathNode[] = []
  for (const c of cubics) {
    if (!nodes.length) nodes.push({ ...r(c[0]), in: null, out: null })
    const flat = isFlat(c)
    if (!flat) nodes[nodes.length - 1].out = r(c[1])
    nodes.push({ ...r(c[3]), in: flat ? null : r(c[2]), out: null })
  }
  if (closed && nodes.length > 1) {
    const last = nodes.pop()!
    nodes[0].in = last.in
  }
  return { closed, nodes }
}
