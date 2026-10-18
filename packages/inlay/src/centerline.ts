/**
 * Centerline tracing: single strokes down the middle of the ink, for pen
 * plotters, engravers and handwriting, instead of outlines round it.
 *
 *  1. Threshold the image to ink and paper (as line art does), and fold specks
 *     and pinholes into their surroundings so they don't become stray strokes
 *     or little loops.
 *  2. Thin the ink to a one-pixel skeleton (Zhang and Suen, "A fast parallel
 *     algorithm for thinning digital patterns", CACM 1984).
 *  3. Measure the stroke width: the ink's area over the skeleton's length.
 *  4. Prune spurs: short branches that thinning grows from bumps in the
 *     outline, anything shorter than the stroke is wide.
 *  5. Walk the skeleton into chains between ends and junctions. Where strokes
 *     cross or branch, chains that carry on in the same direction are joined,
 *     so a plotter lifts its pen less.
 *  6. Fit each chain with the same curve fitter as outlines, and draw it as an
 *     open (or, for a loop, closed) stroke with round caps and joins.
 *
 * Everything here is written for this project (MIT); no GPL tracer is used.
 */
import { fitChain, isFlat, type Cubic } from './fit'
import { serializePath, type PathNode, type Pt, type Subpath } from './path'
import { labelBinary, mergeSpecks } from './inlay'

export type CenterlineOptions = {
  /** Ink is darker than this (0–255); null compares each pixel with its neighbourhood instead. */
  threshold: number | null
  /** Ink and paper regions smaller than speckle × speckle pixels are folded into their surroundings. */
  speckle: number
  /** Max distance in pixels between the skeleton and the fitted stroke. */
  tolerance: number
  /** Turns sharper than this (degrees from straight) are corners. */
  cornerAngle: number
  /** The stroke width in pixels; measured from the ink when left out. */
  strokeWidth?: number
  /** The stroke colour. Default black. */
  color?: string
}

/** One stroked path: open subpaths (and closed loops), drawn with round caps and joins. */
export type CenterlinePath = { d: string; stroke: string; strokeWidth: number }
export type CenterlineResult = {
  width: number
  height: number
  paths: CenterlinePath[]
  /** The stroke width measured from the ink, in pixels (whatever `strokeWidth` asked for). */
  measuredWidth: number
}

/** Trace to an SVG string; `centerline` gives the strokes as data. */
export const traceCenterline = (rgba: ArrayLike<number>, w: number, h: number, o: CenterlineOptions): string => centerlineToSvg(centerline(rgba, w, h, o))

export function centerlineToSvg(r: CenterlineResult): string {
  const paths = r.paths.map((p) => `<path d="${p.d}" fill="none" stroke="${p.stroke}" stroke-width="${round(p.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">\n${paths.join('\n')}\n</svg>\n`
}

const round = (n: number) => Math.round(n * 100) / 100

export function centerline(rgba: ArrayLike<number>, w: number, h: number, o: CenterlineOptions): CenterlineResult {
  const { labels } = labelBinary(rgba, w, h, o.threshold)
  mergeSpecks(labels, w, h, Math.max(0, Math.round(o.speckle)) ** 2)
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = labels[i] === 0 ? 1 : 0

  const skel = thin(ink, w, h)
  const measured = strokeWidthOf(skel, ink, w)
  const width = o.strokeWidth && o.strokeWidth > 0 ? o.strokeWidth : measured
  prune(skel, w, h, Math.max(3, Math.round(measured)))

  const chains = joinStraight(walk(skel, w, h))
  const subs: Subpath[] = []
  for (const c of chains) {
    if (c.pts.length < 2) continue
    const cubics = c.pts.length < 4 ? polyline(c.pts) : fitChain(c.pts, c.closed, { tolerance: o.tolerance, cornerAngle: o.cornerAngle, smoothing: 6 })
    if (cubics.length) subs.push(toSubpath(cubics, c.closed))
  }
  const paths = subs.length ? [{ d: serializePath(subs), stroke: o.color ?? '#000000', strokeWidth: round(width) }] : []
  return { width: w, height: h, paths, measuredWidth: round(measured) }
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
