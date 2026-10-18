/**
 * Inlay, our shared-edge tracer: every preset, from logos to photos.
 * Like inlaid wood, every piece is cut to fit its neighbours exactly.
 *
 * VTracer traces every colour region on its own, so an edge between two
 * regions is traced twice. Fitting the two copies separately leaves hairline
 * gaps and slivers; leaving them to VTracer's spline fitter gives the wobbly
 * lines and rounded corners this replaces. Instead:
 *
 *  1. Label every pixel with a palette colour (or ink / paper for line art).
 *     Anti-aliased pixels, which sit between two colours, take the closest
 *     colour *among their neighbours*, so an edge between red and blue never
 *     grows a one-pixel purple sliver.
 *  2. Merge specks smaller than `speckle`² pixels into whatever surrounds them.
 *  3. Walk the cracks between differently labelled pixels. Where three or more
 *     regions meet (or two meet diagonally) is a junction; every boundary
 *     between two junctions is one chain, with one region on each side.
 *  4. Fit each chain once (src/lib/fit.ts): corners first, then straight lines
 *     where they fit and curves where they don't.
 *  5. Build each region's outline from its chains, reversing the ones it sees
 *     from the other side. Neighbours share the exact same fitted edge: no
 *     gaps, no overlaps, which is also what a vinyl cutter wants.
 *
 * Regions are 4-connected, so two pixels touching only at a corner are
 * separate shapes, and each region is one <path> (its outline plus its holes,
 * wound oppositely so the default nonzero fill rule cuts the holes). With
 * `stacked`, a region keeps only its outline (and any holes onto
 * transparency), and paint order does the rest.
 */
import { fitChain, isFlat, type Cubic, type FitOptions } from './fit'
import { oklab, type Rgb } from './palette'
import { serializePath, type PathNode, type Pt, type Subpath } from './path'

export type InlayOptions = FitOptions & {
  /** Regions smaller than speckle × speckle pixels are merged into their surroundings. */
  speckle: number
  /**
   * Pixel art: keep every pixel. No clean-up of single pixels, and no curve
   * fitting: each boundary is its exact pixel staircase, with straight runs
   * joined into single lines.
   */
  pixels?: boolean
  /**
   * Stacked shapes, for photos: each region is drawn whole, without the holes
   * other regions sit in, and larger shapes come first so smaller ones paint
   * over them. Every hole's outline is exactly the outline of what fills it,
   * so the picture is the same as cut-out shapes, with less path data (each
   * hole isn't drawn a second time) and no hairline seams where anti-aliased
   * edges meet. A hole with transparency anywhere inside it, however deep, is
   * kept, so transparency stays transparent. Default: cut out, which is what a
   * vinyl cutter or a screen printer wants.
   */
  stacked?: boolean
} & (
    /**
     * `merge` folds colours together before any region is built, so the edge
     * between them disappears: { from: to }, traced hex to traced hex, chains
     * followed (a → b → c is a → c).
     */
    | { mode: 'palette'; palette: string[]; merge?: Record<string, string> }
    /**
     * Ink is darker than `threshold` (0–255). When null, each pixel is compared
     * with its neighbourhood instead, for photos of paper under uneven light.
     * Only ink is drawn.
     */
    | { mode: 'binary'; threshold: number | null }
  )

const VOID = -1 // outside the image, transparent pixels, and line art's paper

/** One filled shape: path data (M/L/C/Z, absolute, nonzero fill) and its colour. */
export type InlayPath = { d: string; fill: string }
/** A trace: the drawing's size in pixels and its shapes, largest first (paint order). */
export type InlayResult = { width: number; height: number; paths: InlayPath[] }

/** The trace as an SVG document. */
export function toSvg(r: InlayResult): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">\n${r.paths.map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join('\n')}\n</svg>\n`
}

/** Trace to an SVG string; `trace` gives the shapes as data. */
export const traceInlay = (rgba: ArrayLike<number>, w: number, h: number, o: InlayOptions): string => toSvg(trace(rgba, w, h, o))

/**
 * Trace RGBA pixels (`w` × `h`, 4 bytes a pixel, as from canvas getImageData)
 * into filled shapes that share their edges exactly.
 */
export function trace(rgba: ArrayLike<number>, w: number, h: number, o: InlayOptions): InlayResult {
  const { labels, colors, drawn } = o.mode === 'palette' ? labelPalette(rgba, w, h, o.palette) : labelBinary(rgba, w, h, o.threshold)
  if (o.mode === 'palette' && o.merge) mergeLabels(labels, colors, o.merge)
  // A lone pixel in pixel art is deliberate, not a stray.
  if (!o.pixels) despur(labels, w, h)
  mergeSpecks(labels, w, h, Math.max(0, Math.round(o.speckle)) ** 2)

  // Final regions: 4-connected components of drawn labels. Everything else is VOID.
  const { comp, compLabel, compArea } = components(labels, w, h, (l) => drawn[l])
  const chains = findChains(comp, w, h)
  const byComp = new Map<number, Oriented[]>()
  for (const c of chains) {
    const cubics = o.pixels ? staircase(c.pts, c.closed) : fitChain(c.pts, c.closed, o)
    if (!cubics.length) continue
    if (c.left !== VOID) addOriented(byComp, c.left, { ...c, cubics, reversed: false })
    if (c.right !== VOID) addOriented(byComp, c.right, { ...c, cubics: reverse(cubics), reversed: true })
  }

  // Stacked shapes paint over their holes, so a hole stays wherever there is
  // transparency inside it, however deep: one pixel of each transparent area.
  const voids = o.stacked ? voidSeeds(comp, w, h) : []
  const shapes: { subs: Subpath[]; fill: string; area: number }[] = []
  for (const [id, chains] of byComp) {
    let loops = assemble(chains)
    if (!loops.length) continue
    let area = compArea[id]
    if (o.stacked) {
      // The outline is the loop enclosing the most; a hole stays if there's transparency anywhere inside it.
      const outer = loops.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
      loops = loops.filter((l) => l === outer || l.touchesVoid || voids.some((p) => encloses(l.pts, p)))
      area = Math.abs(outer.area)
    }
    shapes.push({ subs: loops.map((l) => l.sub), fill: colors[compLabel[id]], area })
  }
  // Largest first: for stacked shapes that is containers before what they contain.
  shapes.sort((a, b) => b.area - a.area)
  return { width: w, height: h, paths: shapes.map((x) => ({ d: serializePath(x.subs), fill: x.fill })) }
}

/**
 * A chain as its exact pixel boundary: a line between each pair of turns.
 * The points are pixel corners about a pixel apart, so a run of them in one
 * direction is one straight edge. A closed loop starts at a turn, so its seam
 * isn't a node in the middle of an edge.
 */
export function staircase(pts: Pt[], closed: boolean): Cubic[] {
  const n = pts.length
  if (n < 2) return []
  const dir = (a: Pt, b: Pt) => `${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`
  const isTurn = (i: number) => {
    const a = pts[(i - 1 + n) % n]
    const b = pts[i]
    const c = pts[(i + 1) % n]
    return dir(a, b) !== dir(b, c)
  }
  const keep: Pt[] = []
  if (closed) {
    const start = pts.findIndex((_, i) => isTurn(i))
    if (start < 0) return [] // a loop with no turns can't happen on a pixel grid
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      if (isTurn(i)) keep.push(pts[i])
    }
    keep.push(keep[0])
  } else {
    keep.push(pts[0])
    for (let i = 1; i < n - 1; i++) if (isTurn(i)) keep.push(pts[i])
    keep.push(pts[n - 1])
  }
  const out: Cubic[] = []
  for (let i = 1; i < keep.length; i++) {
    const a = keep[i - 1]
    const b = keep[i]
    out.push([a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 }, b])
  }
  return out
}

// ---- 1. Labels ----------------------------------------------------------------------

/** Relabel merged colours as their targets, following chains, in place. */
export function mergeLabels(labels: Int32Array, colors: string[], merge: Record<string, string>) {
  const index = new Map(colors.map((c, i) => [c, i]))
  // Follow the chain to the last colour this palette still has: with fewer
  // colours a target can be missing, and then its own target (or nothing) wins.
  const remap = colors.map((c, i) => {
    let to = c
    let at = i
    const seen = new Set<string>()
    while (merge[to] && !seen.has(to)) {
      seen.add(to)
      to = merge[to].toLowerCase()
      const k = index.get(to)
      if (k !== undefined) at = k
    }
    return at
  })
  if (remap.every((t, i) => t === i)) return
  for (let i = 0; i < labels.length; i++) labels[i] = remap[labels[i]]
}

function labelPalette(rgba: ArrayLike<number>, w: number, h: number, palette: string[]) {
  const pal = palette.map(hexToRgb)
  const labs = pal.map(oklab)
  const n = w * h
  const labels = new Int32Array(n)
  // Pixels sitting between two palette colours (anti-aliasing, JPEG ringing):
  // decided afterwards from their neighbours.
  const unsure = new Uint8Array(n)
  const cache = new Map<number, number>()
  const transparent = pal.length
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]
    const g = rgba[i * 4 + 1]
    const b = rgba[i * 4 + 2]
    if (rgba[i * 4 + 3] < 128) {
      labels[i] = transparent
      continue
    }
    const key = (r << 16) | (g << 8) | b
    let hit = cache.get(key)
    if (hit === undefined) {
      const lab = oklab([r, g, b])
      let best = 0
      let d1 = Infinity
      let d2 = Infinity
      labs.forEach((p, k) => {
        const d = Math.hypot(lab[0] - p[0], lab[1] - p[1], lab[2] - p[2])
        if (d < d1) {
          d2 = d1
          d1 = d
          best = k
        } else if (d < d2) d2 = d
      })
      // Clearly nearer one colour than any other: sure. Otherwise between two.
      hit = best | (d2 < Infinity && d1 > 0.4 * d2 ? 0x100 : 0)
      cache.set(key, hit)
    }
    labels[i] = hit & 0xff
    unsure[i] = hit >> 8
  }
  // An unsure pixel takes the neighbouring label whose colour is nearest its own.
  const fixed = labels.slice()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!unsure[i]) continue
      const lab = oklab([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]])
      let best = -1
      let bd = Infinity
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (unsure[j]) continue
          const l = labels[j]
          if (l === transparent || l === best) continue
          const p = labs[l]
          const d = Math.hypot(lab[0] - p[0], lab[1] - p[1], lab[2] - p[2])
          if (d < bd) {
            bd = d
            best = l
          }
        }
      if (best >= 0) fixed[i] = best
    }
  const colors = [...palette.map((c) => c.toLowerCase()), '']
  const drawn = [...palette.map(() => true), false]
  return { labels: fixed, colors, drawn }
}

function labelBinary(rgba: ArrayLike<number>, w: number, h: number, threshold: number | null) {
  const n = w * h
  const lum = new Uint8Array(n)
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lum[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2])
    alpha[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0
  }
  const labels = new Int32Array(n)
  if (threshold !== null) for (let i = 0; i < n; i++) labels[i] = alpha[i] && lum[i] < threshold ? 0 : 1
  else {
    // Ink is clearly darker than its surroundings (a window a sixteenth of the
    // image across) and on the dark side of the image's overall split, so
    // a smudge on blank paper doesn't count.
    const global = otsu(lum, alpha)
    const mean = boxMean(lum, w, h, Math.max(7, Math.round(Math.min(w, h) / 32)))
    for (let i = 0; i < n; i++) labels[i] = alpha[i] && lum[i] < mean[i] - 12 && lum[i] < global + 32 ? 0 : 1
  }
  return { labels, colors: ['#000000', ''], drawn: [true, false] }
}

/** Mean of a (2r+1)² window around each pixel, clipped at the edges, via an integral image. */
function boxMean(v: Uint8Array, w: number, h: number, r: number) {
  const W = w + 1
  const sum = new Float64Array(W * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += v[y * w + x]
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      out[y * w + x] = (sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]) / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/** Otsu's threshold over opaque pixels: the split that best separates two populations. */
export function otsu(lum: Uint8Array, alpha: Uint8Array) {
  const hist = new Array<number>(256).fill(0)
  let total = 0
  for (let i = 0; i < lum.length; i++)
    if (alpha[i]) {
      hist[lum[i]]++
      total++
    }
  let sum = 0
  for (let v = 0; v < 256; v++) sum += v * hist[v]
  let sumB = 0
  let wB = 0
  let best = 128
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > bestVar) {
      bestVar = between
      best = t + 1
    }
  }
  return best
}

const hexToRgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

// ---- 2. Spurs and specks ------------------------------------------------------------

/**
 * A pixel whose eight neighbours are at least seven of one other colour takes
 * that colour: a lone pixel jutting out of an edge, or a one-pixel nick in one.
 * Where several colours meet, JPEG noise leaves exactly these, and fitted they
 * become little bumps and notches. A pixel on a one-pixel line has two
 * neighbours of its own colour, so lines survive, though such a line loses up
 * to two pixels at each end (an end pixel looks exactly like a spur). Two passes.
 */
function despur(labels: Int32Array, w: number, h: number) {
  for (let pass = 0; pass < 2; pass++) {
    const src = labels.slice()
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const own = src[i]
        // The most common other label among the eight neighbours.
        let best = -1
        let bestCount = 0
        for (let k = 0; k < 8; k++) {
          const j = i + NEIGHBOURS[k][1] * w + NEIGHBOURS[k][0]
          const l = src[j]
          if (l === own || l === best) continue
          let c = 0
          for (let q = 0; q < 8; q++) if (src[i + NEIGHBOURS[q][1] * w + NEIGHBOURS[q][0]] === l) c++
          if (c > bestCount) {
            bestCount = c
            best = l
          }
        }
        if (bestCount >= 7) labels[i] = best
      }
  }
}

const NEIGHBOURS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const

// ---- 2b. Specks ------------------------------------------------------------------------

/**
 * 4-connected components of equal labels (two-pass union-find, linear time).
 * `keep` decides which labels count as regions; the rest are VOID.
 */
function components(labels: Int32Array, w: number, h: number, keep: (label: number) => boolean) {
  const n = w * h
  const parent = new Int32Array(n)
  const kept = new Uint8Array(n)
  const find = (i: number) => {
    let r = i
    while (parent[r] !== r) r = parent[r]
    while (parent[i] !== r) {
      const next = parent[i]
      parent[i] = r
      i = next
    }
    return r
  }
  // Labels are small integers (palette indices), so `keep` is tabulated once.
  let maxLabel = 0
  for (let i = 0; i < n; i++) if (labels[i] > maxLabel) maxLabel = labels[i]
  const keepLabel = new Uint8Array(maxLabel + 1)
  for (let l = 0; l <= maxLabel; l++) keepLabel[l] = keep(l) ? 1 : 0
  for (let i = 0, x = 0; i < n; i++, x = x === w - 1 ? 0 : x + 1) {
    const l = labels[i]
    if (!keepLabel[l]) continue
    kept[i] = 1
    parent[i] = i
    const left = x > 0 && kept[i - 1] && labels[i - 1] === l ? find(i - 1) : -1
    const up = i >= w && kept[i - w] && labels[i - w] === l ? find(i - w) : -1
    if (left >= 0 && up >= 0) {
      const r = Math.min(left, up)
      parent[left] = r
      parent[up] = r
      parent[i] = r
    } else if (left >= 0) parent[i] = left
    else if (up >= 0) parent[i] = up
  }
  const comp = new Int32Array(n)
  const idOf = new Int32Array(n).fill(-1)
  const compLabel: number[] = []
  const compArea: number[] = []
  for (let i = 0; i < n; i++) {
    if (!kept[i]) {
      comp[i] = VOID
      continue
    }
    const r = find(i)
    let id = idOf[r]
    if (id < 0) {
      id = idOf[r] = compLabel.length
      compLabel.push(labels[i])
      compArea.push(0)
    }
    comp[i] = id
    compArea[id]++
  }
  return { comp, compLabel, compArea }
}

/**
 * Relabel every region smaller than `minArea` with the label it shares the
 * most edge with, smallest first, until none is left (at most eight passes).
 *
 * One pass isn't enough: when a speck has joined a slightly larger small
 * region, and that region then joins a third, the speck's pixels keep the
 * label they took and are stranded as a new speck. On photos that left
 * thousands of fragments, and a larger `speckle` left more, not fewer.
 */
function mergeSpecks(labels: Int32Array, w: number, h: number, minArea: number) {
  if (minArea <= 1) return
  for (let pass = 0; pass < 8; pass++) if (!mergeSpecksOnce(labels, w, h, minArea)) return
}

/** One pass of mergeSpecks; false when there was nothing left to merge. */
function mergeSpecksOnce(labels: Int32Array, w: number, h: number, minArea: number) {
  const { comp, compArea } = components(labels, w, h, () => true)
  const small = compArea.map((a, id) => ({ a, id })).filter((c) => c.a < minArea)
  if (!small.length) return false
  let changed = false
  // Pixels grouped by component (counting sort).
  const start = new Int32Array(compArea.length + 1)
  for (let i = 0; i < compArea.length; i++) start[i + 1] = start[i] + compArea[i]
  const fill = start.slice(0, compArea.length)
  const pixels = new Int32Array(w * h)
  for (let i = 0; i < w * h; i++) pixels[fill[comp[i]]++] = i
  small.sort((p, q) => p.a - q.a)
  for (const { id } of small) {
    const own = labels[pixels[start[id]]]
    const votes = new Map<number, number>()
    for (let k = start[id]; k < start[id + 1]; k++) {
      const i = pixels[k]
      const x = i % w
      const y = (i - x) / w
      const vote = (j: number) => {
        const l = labels[j]
        if (l !== own) votes.set(l, (votes.get(l) ?? 0) + 1)
      }
      if (x > 0) vote(i - 1)
      if (x < w - 1) vote(i + 1)
      if (y > 0) vote(i - w)
      if (y < h - 1) vote(i + w)
    }
    let best = own
    let most = 0
    for (const [l, v] of votes) if (v > most) (most = v), (best = l)
    if (best !== own) {
      for (let k = start[id]; k < start[id + 1]; k++) labels[pixels[k]] = best
      changed = true
    }
  }
  return changed
}

// ---- 3. Chains -------------------------------------------------------------------------

type Chain = {
  pts: Pt[]
  closed: boolean
  /** Region on the left / right walking from pts[0] (screen coordinates, y down). */
  left: number
  right: number
  /** Grid vertex ids of the two ends (equal for a closed chain). */
  from: number
  to: number
  /** Direction of the first and last crack, as unit steps. */
  first: Pt
  last: Pt
}

function findChains(comp: Int32Array, w: number, h: number): Chain[] {
  const C = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? VOID : comp[y * w + x])
  // Cracks: horizontal at (x, y) runs (x,y)→(x+1,y), between the pixels above and below;
  // vertical at (x, y) runs (x,y)→(x,y+1), between the pixels left and right.
  const W1 = w + 1
  const hEdge = new Uint8Array(W1 * (h + 1))
  const vEdge = new Uint8Array(W1 * (h + 1))
  for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) if (C(x, y - 1) !== C(x, y)) hEdge[y * W1 + x] = 1
  for (let y = 0; y < h; y++) for (let x = 0; x <= w; x++) if (C(x - 1, y) !== C(x, y)) vEdge[y * W1 + x] = 1

  const degree = (x: number, y: number) =>
    (x > 0 && hEdge[y * W1 + x - 1] ? 1 : 0) + (x < w && hEdge[y * W1 + x] ? 1 : 0) + (y > 0 && vEdge[(y - 1) * W1 + x] ? 1 : 0) + (y < h && vEdge[y * W1 + x] ? 1 : 0)

  // Each step leaves vertex (x, y) in one of four directions.
  const DIRS: Pt[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ]
  const has = (x: number, y: number, d: number) =>
    d === 0 ? x < w && hEdge[y * W1 + x] : d === 1 ? y < h && vEdge[y * W1 + x] : d === 2 ? x > 0 && hEdge[y * W1 + x - 1] : y > 0 && vEdge[(y - 1) * W1 + x]
  const take = (x: number, y: number, d: number) => {
    if (d === 0) hEdge[y * W1 + x] = 0
    else if (d === 1) vEdge[y * W1 + x] = 0
    else if (d === 2) hEdge[y * W1 + x - 1] = 0
    else vEdge[(y - 1) * W1 + x] = 0
  }
  // The regions either side of a step from (x, y) in direction d.
  const sides = (x: number, y: number, d: number): [number, number] =>
    d === 0 ? [C(x, y - 1), C(x, y)] : d === 1 ? [C(x, y), C(x - 1, y)] : d === 2 ? [C(x - 1, y), C(x - 1, y - 1)] : [C(x - 1, y - 1), C(x, y - 1)]

  const junction = new Uint8Array(W1 * (h + 1))
  for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) if (degree(x, y) >= 3) junction[y * W1 + x] = 1

  const chains: Chain[] = []
  const walk = (sx: number, sy: number, d0: number) => {
    const [left, right] = sides(sx, sy, d0)
    const pts: Pt[] = [{ x: sx, y: sy }]
    let x = sx
    let y = sy
    let d = d0
    let last = d0
    for (;;) {
      take(x, y, d)
      x += DIRS[d].x
      y += DIRS[d].y
      last = d
      if (junction[y * W1 + x] || (x === sx && y === sy)) break
      // A plain boundary vertex has exactly one other crack; prefer going straight, then either turn.
      const next = [d, (d + 1) % 4, (d + 3) % 4].find((k) => has(x, y, k))
      if (next === undefined) break
      // Keep only the corners of the staircase: straight runs need no inner points.
      if (next !== d) pts.push({ x, y })
      d = next
    }
    const closed = x === sx && y === sy && !junction[sy * W1 + sx]
    if (!closed) pts.push({ x, y })
    chains.push({ pts, closed, left, right, from: sy * W1 + sx, to: y * W1 + x, first: DIRS[d0], last: DIRS[last] })
  }

  for (let y = 0; y <= h; y++)
    for (let x = 0; x <= w; x++) {
      if (!junction[y * W1 + x]) continue
      for (let d = 0; d < 4; d++) while (has(x, y, d)) walk(x, y, d)
    }
  // What is left are closed loops with no junction on them.
  for (let y = 0; y <= h; y++)
    for (let x = 0; x < w; x++) if (hEdge[y * W1 + x]) walk(x, y, 0)
  for (let y = 0; y < h; y++)
    for (let x = 0; x <= w; x++) if (vEdge[y * W1 + x]) walk(x, y, 1)
  return chains
}

// ---- 5. Outlines ----------------------------------------------------------------------

type Oriented = Chain & { cubics: Cubic[]; reversed: boolean }

function addOriented(map: Map<number, Oriented[]>, id: number, c: Oriented) {
  const list = map.get(id)
  if (list) list.push(c)
  else map.set(id, [c])
}

const reverse = (cubics: Cubic[]): Cubic[] => cubics.map(([a, b, c, d]) => [d, c, b, a] as Cubic).reverse()

/** A region's closed loop: its fitted subpath, signed area, whether VOID is across any of it, and its exact pixel-crack outline. */
type Loop = { sub: Subpath; area: number; touchesVoid: boolean; pts: Pt[] }
/** The region on the far side of a chain, as this region walks it. */
const across = (c: Oriented) => (c.reversed ? c.left : c.right)

/**
 * Join a region's chains into closed loops, each walked with the region on its
 * left, with each loop's signed area and whether anything across it is VOID.
 */
function assemble(chains: Oriented[]): Loop[] {
  const subs: Loop[] = []
  const open: Oriented[] = []
  for (const c of chains) {
    if (c.closed) subs.push(loopOf(c.cubics, across(c) === VOID, c.pts))
    else open.push(c)
  }
  const start = (c: Oriented) => (c.reversed ? c.to : c.from)
  const end = (c: Oriented) => (c.reversed ? c.from : c.to)
  const firstDir = (c: Oriented) => (c.reversed ? neg(c.last) : c.first)
  const lastDir = (c: Oriented) => (c.reversed ? neg(c.first) : c.last)
  const byStart = new Map<number, Oriented[]>()
  for (const c of open) {
    const k = start(c)
    const list = byStart.get(k)
    if (list) list.push(c)
    else byStart.set(k, [c])
  }
  const used = new Set<Oriented>()
  for (const first of open) {
    if (used.has(first)) continue
    const loop: Cubic[] = []
    const pts: Pt[] = []
    let touchesVoid = false
    let c: Oriented | undefined = first
    while (c && !used.has(c)) {
      used.add(c)
      loop.push(...c.cubics)
      pts.push(...c.pts)
      if (across(c) === VOID) touchesVoid = true
      if (end(c) === start(first)) break
      const into = lastDir(c)
      // Where the region touches itself at a corner, turn left: regions are
      // 4-connected, so the loop goes round this side of the touching point.
      c = (byStart.get(end(c)) ?? [])
        .filter((n) => !used.has(n))
        .sort((a, b) => cross(into, firstDir(a)) - cross(into, firstDir(b)))[0]
    }
    if (loop.length) subs.push(loopOf(loop, touchesVoid, pts))
  }
  return subs
}

/** A loop and its signed area (shoelace over its cubics' end points: enough to rank and orient). */
function loopOf(cubics: Cubic[], touchesVoid: boolean, pts: Pt[]): Loop {
  let area = 0
  for (const [a, , , d] of cubics) area += a.x * d.y - d.x * a.y
  return { sub: toSubpath(cubics), area: area / 2, touchesVoid, pts }
}

/** One pixel centre from each 4-connected area of VOID (transparent pixels) in the image. */
function voidSeeds(comp: Int32Array, w: number, h: number): Pt[] {
  const seen = new Uint8Array(w * h)
  const seeds: Pt[] = []
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (comp[start] !== VOID || seen[start]) continue
    seeds.push({ x: (start % w) + 0.5, y: Math.floor(start / w) + 0.5 })
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      const x = i % w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w])
        if (j >= 0 && j < w * h && comp[j] === VOID && !seen[j]) {
          seen[j] = 1
          stack.push(j)
        }
    }
  }
  return seeds
}

/**
 * Whether a point is inside a loop's pixel-crack outline (even-odd ray cast).
 * The outline runs along pixel edges and the point is a pixel centre, so it is
 * never on the line.
 */
function encloses(pts: Pt[], p: Pt): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

const neg = (p: Pt): Pt => ({ x: -p.x, y: -p.y })
/** y-down screen coordinates: negative is a left turn. */
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x

/** Cubics end to end → a closed subpath; straight ones carry no handles. Two decimals. */
function toSubpath(cubics: Cubic[]): Subpath {
  const r = (p: Pt) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })
  const nodes: PathNode[] = []
  for (const c of cubics) {
    if (!nodes.length) nodes.push({ ...r(c[0]), in: null, out: null })
    const flat = isFlat(c)
    if (!flat) nodes[nodes.length - 1].out = r(c[1])
    nodes.push({ ...r(c[3]), in: flat ? null : r(c[2]), out: null })
  }
  // The last node is the first again: fold it in so the subpath closes on itself.
  if (nodes.length > 1) {
    const last = nodes.pop()!
    nodes[0].in = last.in
  }
  return { closed: true, nodes }
}
