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
import { regionWidths, skeletonStrokes } from './skeleton'

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
   * other regions sit in, larger shapes first so smaller ones paint over them,
   * and reaching under every neighbour painted after it. So each shared edge
   * is drawn once, by the later shape over the earlier one's colour, and no
   * hairline seam shows where anti-aliased edges meet (on photos, 12% closer
   * to the photo than without, for about a third more path data). A hole with transparency anywhere inside it, however deep, is
   * kept, so transparency stays transparent. Default: cut out, which is what a
   * vinyl cutter or a screen printer wants.
   */
  stacked?: boolean
  /**
   * Photos: specks join the colour they share the most edge with, and slivers
   * are left alone. Flat art's clean-up (specks join the nearest colour, and
   * slivers of one ink's two shades fold together) keeps thin strokes whole,
   * but on photos it kept so many real regions that files grew by half.
   */
  photo?: boolean
  /**
   * Outline art: draw thin lines of ink as lines. A colour that is mostly
   * thin, long regions (outlines, small lettering) is traced down its middle
   * as round-capped strokes of the width measured from it, and the shapes
   * around each line grow to meet under it, so a line can be moved or
   * restyled without a gap opening. Palette mode only; ignored for photos
   * and pixel art.
   */
  strokes?: boolean
  /**
   * How many times the drawing was enlarged before tracing (an upscaled small
   * image, or a full-size trace of one usually traced smaller). The widths
   * `strokes` takes as lines (2.5–8 px) grow with it. Default 1.
   */
  scale?: number
} & (
    /**
     * `merge` folds colours together before any region is built, so the edge
     * between them disappears: { from: to }, traced hex to traced hex, chains
     * followed (a → b → c is a → c).
     */
    | { mode: 'palette'; palette: string[]; merge?: Record<string, string> }
    /**
     * Ink is darker than `threshold` (0–255). With 'auto', the threshold is
     * the image's own split between ink and paper (Otsu's), so coloured ink
     * works as well as black (a page with no clear ink, such as a blank
     * scan, falls back to 128). When null, each pixel is compared with its
     * neighbourhood instead, for photos of paper under uneven light.
     * Only ink is drawn.
     */
    | { mode: 'binary'; threshold: number | 'auto' | null }
  )

const VOID = -1 // outside the image, transparent pixels, and line art's paper

/**
 * One filled shape: path data (M/L/C/Z, absolute, nonzero fill) and its
 * colour. With `stroke` (a width in px), a line drawn in that colour instead,
 * with round caps and joins.
 */
export type InlayPath = { d: string; fill: string; stroke?: number }
/** A trace: the drawing's size in pixels and its shapes, largest first (paint order). */
export type InlayResult = { width: number; height: number; paths: InlayPath[] }

/**
 * A value made safe inside a double-quoted attribute. Colours come from the
 * caller's palette as given, so a stray quote mustn't end the attribute.
 */
export const attr = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/** The trace as an SVG document. */
export function toSvg(r: InlayResult): string {
  const path = (p: InlayPath) =>
    p.stroke
      ? `<path d="${attr(p.d)}" fill="none" stroke="${attr(p.fill)}" stroke-width="${attr(p.stroke)}" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="${attr(p.d)}" fill="${attr(p.fill)}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">\n${r.paths.map(path).join('\n')}\n</svg>\n`
}

/** Trace to an SVG string; `trace` gives the shapes as data. */
export const traceInlay = (rgba: ArrayLike<number>, w: number, h: number, o: InlayOptions): string => toSvg(trace(rgba, w, h, o))

/**
 * Trace RGBA pixels (`w` × `h`, 4 bytes a pixel, as from canvas getImageData)
 * into filled shapes that share their edges exactly.
 */
export function trace(rgba: ArrayLike<number>, w: number, h: number, o: InlayOptions): InlayResult {
  const { labels, colors, drawn } = o.mode === 'palette' ? labelPalette(rgba, w, h, o.palette, !o.photo) : labelBinary(rgba, w, h, o.threshold)
  if (o.mode === 'palette' && o.merge) mergeLabels(labels, colors, o.merge)
  // A lone pixel in pixel art is deliberate, not a stray.
  if (!o.pixels) despur(labels, w, h)
  // Not photos: there it traded 2% less error for 5% more size (score:photos).
  if (!o.pixels && !(o.mode === 'palette' && o.photo)) joinDiagonals(labels, w, h, rgba, drawn)
  const labs = o.mode === 'palette' && !o.photo ? colors.map((c) => (c ? oklab(hexToRgb(c)) : null)) : undefined
  mergeSpecks(labels, w, h, Math.max(0, Math.round(o.speckle)) ** 2, labs)
  if (labs && !o.pixels) mergeSlivers(labels, w, h, labs)
  const lines = o.mode === 'palette' && o.strokes && labs && !o.pixels ? strokesOf(rgba, labels, w, h, colors, labs, drawn, o) : []

  // Final regions: 4-connected components of drawn labels. Everything else is VOID.
  const { comp, compLabel, compArea } = components(labels, w, h, (l) => drawn[l])
  const chains = findChains(comp, w, h)
  // Each chain is fitted once, then shared by every shape it bounds.
  const fitted: { chain: Chain; cubics: Cubic[]; back: Cubic[] }[] = []
  const chainsOf = new Map<number, number[]>()
  for (const c of chains) {
    const cubics = o.pixels ? staircase(c.pts, c.closed) : fitChain(c.pts, c.closed, o)
    if (!cubics.length) continue
    const i = fitted.push({ chain: c, cubics, back: reverse(cubics) }) - 1
    for (const id of new Set([c.left, c.right]))
      if (id !== VOID) {
        const list = chainsOf.get(id)
        if (list) list.push(i)
        else chainsOf.set(id, [i])
      }
  }
  /** The outline of a set of regions: the chains with exactly one side in it, walked with the set on the left. */
  const outline = (inSet: (id: number) => boolean, ids: Iterable<number>) => {
    const seen = new Set<number>()
    const out: Oriented[] = []
    for (const id of ids)
      for (const i of chainsOf.get(id) ?? []) {
        if (seen.has(i)) continue
        seen.add(i)
        const { chain, cubics, back } = fitted[i]
        const l = chain.left !== VOID && inSet(chain.left)
        const r = chain.right !== VOID && inSet(chain.right)
        if (l !== r) out.push({ ...chain, cubics: l ? cubics : back, reversed: !l })
      }
    return assemble(out)
  }

  const shapes: { subs: Subpath[]; fill: string; area: number }[] = []
  if (!o.stacked) {
    for (const id of chainsOf.keys()) {
      const loops = outline((r) => r === id, [id])
      if (loops.length) shapes.push({ subs: loops.map((l) => l.sub), fill: colors[compLabel[id]], area: compArea[id] })
    }
  } else {
    // Stacked: paint order is by outline area, largest first, so containers come
    // before what they contain. Each shape then also covers every neighbour
    // painted after it, so each shared edge is drawn once, by the later shape,
    // over solid colour. Two shapes meeting over a third left a hairline of the
    // third where their anti-aliased edges met (on a photo, 11% of the error).
    const own = new Map<number, number>()
    for (const id of chainsOf.keys()) {
      const loops = outline((r) => r === id, [id])
      if (loops.length) own.set(id, Math.max(...loops.map((l) => Math.abs(l.area))))
    }
    const order = [...own.keys()].sort((a, b) => own.get(b)! - own.get(a)! || a - b)
    const rank = new Map(order.map((id, i) => [id, i]))
    // Transparency stays transparent: a hole is kept if any is inside it, however deep.
    const voids = voidSeeds(comp, w, h)
    for (const id of order) {
      const set = new Set([id])
      for (const i of chainsOf.get(id)!) {
        const { left, right } = fitted[i].chain
        const other = left === id ? right : left
        if (other !== VOID && rank.has(other) && rank.get(other)! > rank.get(id)!) set.add(other)
      }
      const loops = outline((r) => set.has(r), set)
      if (!loops.length) continue
      const outer = loops.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
      // A hole stays if transparency is inside it, or a shape painted earlier
      // (which this one would otherwise cover). Whatever else is inside is
      // painted later: anything enclosing a shape is larger, so earlier.
      const kept = loops.filter(
        (l) => l === outer || l.touchesVoid || [...l.across].some((r) => r !== VOID && rank.get(r)! < rank.get(id)!) || voids.some((p) => encloses(l.pts, p)),
      )
      shapes.push({ subs: kept.map((l) => l.sub), fill: colors[compLabel[id]], area: own.get(id)! })
    }
  }
  // Largest first: for stacked shapes that is containers before what they contain.
  shapes.sort((a, b) => b.area - a.area)
  // Lines on top, over the seams of the shapes that meet under them.
  return { width: w, height: h, paths: [...shapes.map((x) => ({ d: serializePath(x.subs), fill: x.fill })), ...lines] }
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

/**
 * The colour an in-between pixel holds most of, read as an anti-aliased mix
 * of two palette colours (mixed as a renderer mixes them, in sRGB): the
 * pair whose mix comes nearest the pixel, if nearer than any one colour
 * (`solid`). Nearest-colour alone took the pale edge of a grey letter for
 * light blue, the palette's only colour that light. Only for a pixel more
 * than `MIX_FAR` from every colour: a pale blue fill lies on the line from
 * white to the blue ink too, and read as a mix a pale "+" eroded to white.
 */
const MIX_FAR = 0.05

type Pair = { i: number; j: number; a: Rgb; d: Rgb; len: number; span: number }

/** Every pair of palette colours, with what mixOf needs of each. */
function pairsOf(pal: Rgb[], labs: Rgb[]): Pair[] {
  const pairs: Pair[] = []
  for (let i = 0; i < pal.length; i++)
    for (let j = i + 1; j < pal.length; j++) {
      const a = pal[i]
      const d: Rgb = [pal[j][0] - a[0], pal[j][1] - a[1], pal[j][2] - a[2]]
      const len = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
      const span = Math.hypot(labs[i][0] - labs[j][0], labs[i][1] - labs[j][1], labs[i][2] - labs[j][2])
      if (len) pairs.push({ i, j, a, d, len, span })
    }
  return pairs
}

function mixOf(rgb: Rgb, lab: Rgb, pairs: Pair[], labs: Rgb[], solid: number): number | undefined {
  let best: number | undefined
  let bd = solid
  let bspan = Infinity
  for (const { i, j, a, d, len, span } of pairs) {
    const t = Math.min(1, Math.max(0, ((rgb[0] - a[0]) * d[0] + (rgb[1] - a[1]) * d[1] + (rgb[2] - a[2]) * d[2]) / len))
    const m = oklab([a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]])
    const e = Math.hypot(m[0] - lab[0], m[1] - lab[1], m[2] - lab[2])
    // Equally good fits: the closer pair. A grey is a mix of black and white,
    // and of red and cyan too, but only the first is likely in an image.
    if (e < bd - 1e-3 || (best !== undefined && e < bd + 1e-3 && span < bspan)) {
      bd = Math.min(bd, e)
      bspan = span
      // Exactly halfway: the endpoint nearer in OKLab, not the later one.
      const di = Math.hypot(lab[0] - labs[i][0], lab[1] - labs[i][1], lab[2] - labs[i][2])
      const dj = Math.hypot(lab[0] - labs[j][0], lab[1] - labs[j][1], lab[2] - labs[j][2])
      best = t < 0.5 ? i : t > 0.5 ? j : di <= dj ? i : j
    }
  }
  return best
}

function labelPalette(rgba: ArrayLike<number>, w: number, h: number, palette: string[], flat: boolean) {
  const pal = palette.map(hexToRgb)
  const labs = pal.map(oklab)
  const pairs = flat ? pairsOf(pal, labs) : null
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
      const between = d2 < Infinity && d1 > 0.4 * d2
      if (between && pairs && d1 > MIX_FAR) best = mixOf([r, g, b], lab, pairs, labs, d1) ?? best
      hit = best | (between ? 0x100 : 0)
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
      let kinds = 0
      let seen = -1
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (unsure[j]) continue
          const l = labels[j]
          if (l === transparent) continue
          if (l !== seen) (seen = l), kinds++
          if (l === best) continue
          const p = labs[l]
          const d = Math.hypot(lab[0] - p[0], lab[1] - p[1], lab[2] - p[2])
          if (d < bd) {
            bd = d
            best = l
          }
        }
      // Next to one colour only, it isn't an edge between two: it's a stroke
      // too thin to have sure pixels of its own (a 1.5 px grey letter on
      // white), and taking the paper's colour erased the text.
      if (flat && kinds === 1 && best !== labels[i]) continue
      if (best >= 0) fixed[i] = best
    }
  const colors = [...palette.map((c) => c.toLowerCase()), '']
  const drawn = [...palette.map(() => true), false]
  return { labels: fixed, colors, drawn }
}

export function labelBinary(rgba: ArrayLike<number>, w: number, h: number, threshold: number | 'auto' | null) {
  const n = w * h
  const lum = new Uint8Array(n)
  const alpha = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    lum[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2])
    alpha[i] = rgba[i * 4 + 3] >= 128 ? 1 : 0
  }
  const labels = new Int32Array(n)
  if (threshold !== null) {
    // A fixed 128 assumes black ink: a mid-blue line (luminance 122, JPEG
    // noise either side of it) came out in pieces. The image's own split
    // falls between the ink and the paper whatever their colours.
    const t = threshold === 'auto' ? autoThreshold(lum, alpha) : threshold
    for (let i = 0; i < n; i++) labels[i] = alpha[i] && lum[i] < t ? 0 : 1
  } else {
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

/** Below this gap between the two sides' mean luminance, Otsu has split one population. */
const MIN_INK_CONTRAST = 40

/**
 * Otsu's split, unless it falls inside a single population: a blank page
 * photographed with some noise splits down its own middle, and half of it
 * would trace as ink. Then the fixed 128 it replaced.
 */
function autoThreshold(lum: Uint8Array, alpha: Uint8Array) {
  const t = otsu(lum, alpha)
  let dark = 0
  let darkSum = 0
  let light = 0
  let lightSum = 0
  for (let i = 0; i < lum.length; i++) {
    if (!alpha[i]) continue
    if (lum[i] < t) {
      dark++
      darkSum += lum[i]
    } else {
      light++
      lightSum += lum[i]
    }
  }
  return dark && light && lightSum / light - darkSum / dark >= MIN_INK_CONTRAST ? t : 128
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

/**
 * Regions are 4-connected, so a line one pixel wide that runs diagonally, a
 * staircase of pixels touching only at corners, fell apart into specks, and
 * mergeSpecks then erased them: a 1 px outline at a slant traced as dashes or
 * not at all. Where two pixels of a colour touch only at a corner, across two
 * of another (a 2 × 2 checkerboard), one pair has to be joined. Join the pair
 * that isn't the background (the commonest label, or one that isn't drawn),
 * so the paper parts and the line goes on; between two inks, the pair whose
 * colour the corner pixel is nearer. The corner pixel that joins them is the
 * one whose colour is nearer the pair's: the anti-aliased half of the step.
 */
export function joinDiagonals(labels: Int32Array, w: number, h: number, rgba: ArrayLike<number>, drawn: boolean[]) {
  const count = new Map<number, number>()
  for (let i = 0; i < labels.length; i++) count.set(labels[i], (count.get(labels[i]) ?? 0) + 1)
  let paper = -1
  for (const [l, c] of count) if (paper < 0 || c > count.get(paper)!) paper = l
  const back = (l: number) => l === paper || !drawn[l]
  const far = (i: number, a: number, b: number) =>
    Math.hypot(rgba[i * 4] - (rgba[a * 4] + rgba[b * 4]) / 2, rgba[i * 4 + 1] - (rgba[a * 4 + 1] + rgba[b * 4 + 1]) / 2, rgba[i * 4 + 2] - (rgba[a * 4 + 2] + rgba[b * 4 + 2]) / 2)
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const tl = y * w + x
      const tr = tl + 1
      const bl = tl + w
      const br = bl + 1
      // Either diagonal can be the pair: tl–br across tr and bl, or tr–bl across tl and br.
      if (labels[tl] !== labels[br] || labels[tr] !== labels[bl] || labels[tl] === labels[tr]) continue
      const a = labels[tl]
      const b = labels[tr]
      let joinMain: boolean
      if (back(a) !== back(b)) joinMain = back(b)
      else {
        // Each pair's cost: how far its best corner pixel's colour is from it.
        const costMain = Math.min(far(tr, tl, br), far(bl, tl, br))
        const costAnti = Math.min(far(tl, tr, bl), far(br, tr, bl))
        joinMain = costMain <= costAnti
      }
      if (joinMain) labels[far(tr, tl, br) <= far(bl, tl, br) ? tr : bl] = a
      else labels[far(tl, tr, bl) <= far(br, tr, bl) ? tl : br] = b
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
export function mergeSpecks(labels: Int32Array, w: number, h: number, minArea: number, labs?: (Rgb | null)[]) {
  if (minArea <= 1) return
  for (let pass = 0; pass < 8; pass++) if (!mergeSpecksOnce(labels, w, h, minArea, labs)) return
}

/**
 * A speck at least this far (OKLab) from every colour around it is a shape,
 * not noise: a letter or a dot on paper. Ringing and anti-aliasing specks are
 * blends, close to a neighbour; grey text on white is 0.47 from it.
 */
const SPECK_CONTRAST = 0.25
/**
 * But only from this share of the speck size up, and never under 6 px, so
 * raising Speckle still clears dust and text: at the default 8 (64 px) a
 * letter of 1.5 px strokes (10–40 px) stays and a 2 × 2 dot goes.
 */
const SPECK_SHAPE = 1 / 8
const SPECK_MIN = 6
/** One pass of mergeSpecks; false when there was nothing left to merge. */
function mergeSpecksOnce(labels: Int32Array, w: number, h: number, minArea: number, labs?: (Rgb | null)[]) {
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
    const begin = start[id]
    const end = start[id + 1]
    const own = labels[pixels[begin]]
    const votes = new Map<number, number>()
    let joined = false
    for (let k = begin; k < end; k++) {
      const i = pixels[k]
      const x = i % w
      const y = (i - x) / w
      const vote = (j: number) => {
        const l = labels[j]
        if (l !== own) votes.set(l, (votes.get(l) ?? 0) + 1)
        else if (comp[j] !== id) joined = true
      }
      if (x > 0) vote(i - 1)
      if (x < w - 1) vote(i + 1)
      if (y > 0) vote(i - w)
      if (y < h - 1) vote(i + w)
    }
    // A neighbour merged into this speck's own colour earlier in the pass, so
    // it is part of a larger region now: the next pass decides whether it's
    // still small. (Flat art only: on photos waiting kept regions that, merged
    // a pass early as before, cost nothing visible.)
    if (joined && labs) continue
    let best = own
    let most = 0
    const mine = labs?.[own]
    if (mine) {
      // Nearest colour first: a stroke broken into pieces of two shades of
      // its ink rejoins the ink, rather than the paper it mostly touches.
      let near = Infinity
      for (const [l, v] of votes) {
        const lab = labs![l]
        const d = lab ? Math.hypot(lab[0] - mine[0], lab[1] - mine[1], lab[2] - mine[2]) : Infinity
        if (d < near || (d === near && v > most)) (near = d), (most = v), (best = l)
      }
      // Nothing around it is anywhere near its colour: a letter, not noise.
      // (Not one with only transparency around it: that's dust on nothing.)
      if (near > SPECK_CONTRAST && near < Infinity && end - begin >= Math.max(SPECK_MIN, minArea * SPECK_SHAPE)) continue
    } else for (const [l, v] of votes) if (v > most) (most = v), (best = l)
    if (best !== own) {
      for (let k = begin; k < end; k++) labels[pixels[k]] = best
      changed = true
    }
  }
  return changed
}

/** Regions narrower than this on average (2 × area / perimeter, px) are slivers. */
const SLIVER_WIDTH = 2
/** A sliver joins a neighbour only this close in colour (OKLab): two shades of one ink (0.08–0.11 apart), not a grey hairline on white (#d4d4d4 is 0.13 from it). */
const SLIVER_DISTANCE = 0.12

/**
 * Fold slivers into a neighbour of nearly the same colour. JPEG and WebP
 * smear a thin stroke into two shades of its ink (a 3 px letter stem came
 * out dark at its edges and lighter down the middle), and a one-pixel strip
 * of one shade inside the other fitted as a spike shooting out of the
 * letter. A hairline of a colour of its own has no neighbour that close, so
 * it stays. Within a pass a sliver waits if a neighbour has already moved,
 * so two side by side don't just swap colours.
 */
function mergeSlivers(labels: Int32Array, w: number, h: number, labs: (Rgb | null)[]) {
  for (let pass = 0; pass < 4; pass++) {
    const { comp, compArea } = components(labels, w, h, () => true)
    const m = compArea.length
    const perimeter = new Int32Array(m)
    const label = new Int32Array(m)
    // Each region's neighbouring regions.
    const around = new Map<number, Set<number>>()
    const touch = (a: number, b: number) => {
      const id = comp[a]
      perimeter[id]++
      let c = around.get(id)
      if (!c) around.set(id, (c = new Set()))
      c.add(comp[b])
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        label[comp[i]] = labels[i]
        if (x < w - 1 && comp[i + 1] !== comp[i]) touch(i, i + 1), touch(i + 1, i)
        if (y < h - 1 && comp[i + w] !== comp[i]) touch(i, i + w), touch(i + w, i)
      }
    const to = new Int32Array(m).fill(-1)
    let changed = false
    // Smallest first, so a fleck of one shade inside a letter joins the
    // letter, not the letter the fleck.
    for (const [id, near] of [...around].sort((a, b) => compArea[a[0]] - compArea[b[0]])) {
      if ((2 * compArea[id]) / perimeter[id] >= SLIVER_WIDTH) continue
      const mine = labs[label[id]]
      if (!mine || [...near].some((n) => to[n] >= 0)) continue
      let best = -1
      let bd = SLIVER_DISTANCE
      for (const n of near) {
        const lab = labs[label[n]]
        const d = lab ? Math.hypot(lab[0] - mine[0], lab[1] - mine[1], lab[2] - mine[2]) : Infinity
        if (d < bd) (bd = d), (best = label[n])
      }
      if (best < 0) continue
      to[id] = best
      changed = true
    }
    if (!changed) return
    for (let i = 0; i < w * h; i++) if (to[comp[i]] >= 0) labels[i] = to[comp[i]]
  }
}

/** A part of a region is thin enough to be a line up to this wide (px), times `scale`. */
const LINE_WIDEST = 8
/** And long enough: at least this many times as long as it is wide, so a dot stays a shape. */
const LINE_LENGTH = 3
/** A colour is drawn as lines when at least this share of it is in thin, long parts. */
const LINE_SHARE = 0.3
/** A line colour is at least this far (OKLab) from the paper. */
const LINE_CONTRAST = 0.25
/** Lines measured thinner than this (px, times `scale`) stay shapes: a centreline can't follow small lettering. */
const LINE_WIDTH = 2.5
/** Pieces of a colour's ink more than this many times wider or thinner than its usual width stay shapes. */
const LINE_SPREAD = 1.2
/** And pieces shorter than this many times their width stay shapes: a letter's skeleton is all branches. */
const LINE_PIECE = 8
/** How far off the line–paper blend (a share of the distance between them) its shades and edges may stray. */
const LINE_OFF = 0.15

/**
 * The thin, long parts of the `keep` labels' 4-connected regions, as a mask,
 * and their thick parts. A pixel is thick when it lies within a disc wider
 * than `widest` that fits inside its region (a solid area, a dot, a heading's
 * strokes); what remains of each region falls into parts, and a part is thin
 * when no wider than `widest` and at least LINE_LENGTH times as long as wide.
 * So an outline that runs into a solid area of the same ink is still a line.
 * Depths are in thirds of a pixel, by a 3-4 chamfer distance from the edge.
 */
function thinParts(labels: Int32Array, w: number, h: number, keep: (label: number) => boolean, widest: number) {
  const n = w * h
  // Regions by label: the distances step diagonally too, so pixels of one
  // colour touching only at a corner count as one region here, which is close enough.
  const comp = new Int32Array(n)
  for (let i = 0; i < n; i++) comp[i] = keep(labels[i]) ? labels[i] : VOID
  const depth = chamfer(comp, w, h, 1)
  // A width of 2·depth/3 − 1: an edge pixel is 1 deep, a 3 px line's middle 2.
  const core = 1.5 * (widest + 1)
  const reach = new Int32Array(n)
  for (let i = 0; i < n; i++) if (comp[i] !== VOID && depth[i] > core) reach[i] = depth[i]
  chamfer(comp, w, h, -1, reach)
  const thick = new Uint8Array(n)
  const rest = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    if (comp[i] === VOID) continue
    if (reach[i] > 0) thick[i] = 1
    else rest[i] = labels[i]
  }
  const parts = components(rest, w, h, (l) => l >= 0)
  const deepest = new Int32Array(parts.compArea.length)
  for (let i = 0; i < n; i++) if (parts.comp[i] !== VOID && depth[i] > deepest[parts.comp[i]]) deepest[parts.comp[i]] = depth[i]
  const thinPart = deepest.map((d, id) => {
    const wide = (2 * d) / 3 - 1
    return wide <= widest && parts.compArea[id] >= LINE_LENGTH * wide ** 2 ? 1 : 0
  })
  const thin = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (parts.comp[i] !== VOID && thinPart[parts.comp[i]]) thin[i] = 1
  return { thin, thick }
}

/**
 * A 3-4 chamfer pass over `comp`'s regions, two sweeps. With `sign` 1 it is
 * each pixel's distance in from its region's edge; with −1 it spreads `into`
 * outwards, falling by the distance, so each pixel gets the most any pixel
 * reaches it with (a disc of that radius round each start).
 */
function chamfer(comp: Int32Array, w: number, h: number, sign: 1 | -1, into?: Int32Array) {
  const n = w * h
  const d = into ?? new Int32Array(n)
  if (!into)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const c = comp[i]
        const edge = c === VOID || x === 0 || y === 0 || x === w - 1 || y === h - 1 || comp[i - 1] !== c || comp[i + 1] !== c || comp[i - w] !== c || comp[i + w] !== c
        d[i] = edge ? 3 : 1 << 30
      }
  // In from the edge: the least of each neighbour plus the step. Out from the
  // starts: the most of each neighbour less it, which is the same negated.
  const s = sign
  for (let i = 0; i < n; i++) d[i] *= s
  const sweep = (i: number, j: number, step: number) => {
    const c = comp[i]
    if (c !== VOID && comp[j] === c) {
      const v = d[j] + step
      if (v < d[i]) d[i] = v
    }
  }
  for (let y = 1; y < h - 1; y++)
    for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) {
      sweep(i, i - 1, 3)
      sweep(i, i - w, 3)
      sweep(i, i - w - 1, 4)
      sweep(i, i - w + 1, 4)
    }
  for (let y = h - 2; y > 0; y--)
    for (let x = w - 2, i = y * w + x; x > 0; x--, i--) {
      sweep(i, i + 1, 3)
      sweep(i, i + w, 3)
      sweep(i, i + w + 1, 4)
      sweep(i, i + w - 1, 4)
    }
  for (let i = 0; i < n; i++) d[i] *= s
  return d
}

/**
 * Outline art's lines. Finds the colours that are mostly thin, long parts (an
 * outline 3 px wide), traces those parts down their middle as strokes (one
 * path a colour, at the width measured from its ink), and hands their pixels
 * to the shapes either side, which meet under the line's middle. The paper is
 * never a line, however thin its gaps.
 */
function strokesOf(rgba: ArrayLike<number>, labels: Int32Array, w: number, h: number, colors: string[], labs: (Rgb | null)[], drawn: boolean[], o: FitOptions & { scale?: number }): InlayPath[] {
  const n = w * h
  const k = Math.max(1, o.scale ?? 1)
  const widest = LINE_WIDEST * k
  const { thin } = thinParts(labels, w, h, (l) => drawn[l], widest)
  // Colours that are mostly lines, but never the paper: the commonest colour,
  // unless more of the image is transparent than that.
  const total = new Map<number, number>()
  const inLines = new Map<number, number>()
  let clear = 0
  for (let i = 0; i < n; i++) {
    const l = labels[i]
    if (!drawn[l]) {
      clear++
      continue
    }
    total.set(l, (total.get(l) ?? 0) + 1)
    if (thin[i]) inLines.set(l, (inLines.get(l) ?? 0) + 1)
  }
  const [commonest, most] = [...total].reduce((a, b) => (b[1] > a[1] ? b : a), [-1, -1])
  const paper = most >= clear ? commonest : -1
  // A line stands out from the paper; a pale fill squeezed between two lines doesn't.
  const contrasts = (l: number) => paper < 0 || dist(labs[l]!, labs[paper]!) >= LINE_CONTRAST
  const lineColours = [...inLines].filter(([l, a]) => l !== paper && contrasts(l) && a >= LINE_SHARE * total.get(l)!).map(([l]) => l)
  if (!lineColours.length) return []

  const line = new Uint8Array(n)
  const out: InlayPath[] = []
  const lab = labCache(rgba)
  // Most line first: a shade of it (lossy compression leaves two) goes into
  // its ink, and has little of its own left after.
  for (const l of lineColours.sort((a, b) => inLines.get(b)! - inLines.get(a)!)) {
    // On transparency there's no paper to blend with: blends are taken from white (or, for a pale line, black).
    const ground: Rgb = paper >= 0 ? labs[paper]! : labs[l]![0] > 0.5 ? [0, 0, 0] : [1, 0, 0]
    const inky = blendTest(labs[l]!, ground)
    const like = labs.map((c, j) => j === l || (j !== paper && drawn[j] && !!c && inky(c)))
    // The line's ink: the thin parts of its colour and its shades taken
    // together, which a lossy save can cut into pieces too short to count alone.
    const mask = new Int32Array(n)
    for (let i = 0; i < n; i++) mask[i] = like[labels[i]] && !line[i] ? 1 : 0
    const parts = thinParts(mask, w, h, (v) => v === 1, widest)
    const ink = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (!line[i] && ((thin[i] && like[labels[i]]) || parts.thin[i])) ink[i] = 1
    // Then its anti-aliased edges, and blots where it bends, short of solid
    // areas of its colour and of lines already drawn.
    edgesOf(ink, (i) => line[i] === 1 || parts.thick[i] === 1, w, (i) => rgba[i * 4 + 3] >= 128 && inky(lab(i)))
    // Each piece of ink is measured on its own, and only long pieces near
    // the colour's usual width are drawn as lines: lettering too small to
    // follow, specks that thin to a point, short marks and heavier strokes (a
    // heading in the same ink, whose letters' skeletons would branch) stay
    // shapes. And unless most of the ink is lines, none of it is.
    const pieces = components(Int32Array.from(ink), w, h, (v) => v === 1)
    const { width, length, skel } = regionWidths(ink, w, h, pieces.comp, pieces.compArea.length)
    const long = (c: number) => width[c] >= LINE_WIDTH * k && length[c] >= LINE_PIECE * width[c]
    const usual = weightedMedian(width, pieces.compArea, (c) => long(c))
    const fits = (c: number) => long(c) && width[c] >= usual / LINE_SPREAD && width[c] <= usual * LINE_SPREAD
    let kept = 0
    let all = 0
    for (let c = 0; c < pieces.compArea.length; c++) {
      all += pieces.compArea[c]
      if (fits(c)) kept += pieces.compArea[c]
    }
    if (kept < LINE_SHARE * all) continue
    for (let i = 0; i < n; i++) if (ink[i] && !fits(pieces.comp[i])) ink[i] = skel[i] = 0
    const { subs, measured } = skeletonStrokes(ink, w, h, o, skel)
    if (!subs.length) continue
    out.push({ d: serializePath(subs), fill: colors[l], stroke: Math.round(measured * 100) / 100 })
    for (let i = 0; i < n; i++) if (ink[i]) line[i] = 1
  }
  if (!out.length) return out
  // The shapes either side grow into the line, a pixel a step, so they meet
  // under its middle.
  const taken = new Uint8Array(n)
  const queued = new Uint8Array(n)
  for (let i = 0; i < n; i++) if (!line[i]) taken[i] = 1
  let front: number[] = []
  const push = (j: number, to: number[]) => {
    if (taken[j] || queued[j]) return
    queued[j] = 1
    to.push(j)
  }
  for (let i = 0; i < n; i++) {
    if (!taken[i]) continue
    const x = i % w
    if (x > 0) push(i - 1, front)
    if (x < w - 1) push(i + 1, front)
    if (i >= w) push(i - w, front)
    if (i + w < n) push(i + w, front)
  }
  while (front.length) {
    const grown: number[] = []
    for (const i of front) {
      const x = i % w
      const from = x > 0 && taken[i - 1] ? i - 1 : x < w - 1 && taken[i + 1] ? i + 1 : i >= w && taken[i - w] ? i - w : i + w < n && taken[i + w] ? i + w : -1
      if (from < 0) continue
      labels[i] = labels[from]
      grown.push(i)
    }
    const next: number[] = []
    for (const i of grown) taken[i] = 1
    for (const i of grown) {
      const x = i % w
      if (x > 0) push(i - 1, next)
      if (x < w - 1) push(i + 1, next)
      if (i >= w) push(i - w, next)
      if (i + w < n) push(i + w, next)
    }
    front = next
  }
  return out
}

/** The median of `values` weighted by `weights`, over the indices `ok` takes; 0 if none. */
function weightedMedian(values: ArrayLike<number>, weights: ArrayLike<number>, ok: (i: number) => boolean): number {
  const order: number[] = []
  let total = 0
  for (let i = 0; i < values.length; i++)
    if (ok(i)) {
      order.push(i)
      total += weights[i]
    }
  order.sort((a, b) => values[a] - values[b])
  let run = 0
  for (const i of order) if ((run += weights[i]) >= total / 2) return values[i]
  return 0
}

const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** OKLab of each pixel, cached by its colour (a drawing has few). */
function labCache(rgba: ArrayLike<number>): (i: number) => Rgb {
  const cache = new Map<number, Rgb>()
  return (i) => {
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]
    let v = cache.get(key)
    if (!v) cache.set(key, (v = oklab([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]])))
    return v
  }
}

/** Whether a colour lies between the paper and the line (or beyond, darker), nearer the line. */
function blendTest(line: Rgb, paper: Rgb): (lab: Rgb) => boolean {
  const span = [line[0] - paper[0], line[1] - paper[1], line[2] - paper[2]]
  const len2 = span[0] ** 2 + span[1] ** 2 + span[2] ** 2
  return (lab) => {
    if (!len2) return false
    const d = [lab[0] - paper[0], lab[1] - paper[1], lab[2] - paper[2]]
    const t = (d[0] * span[0] + d[1] * span[1] + d[2] * span[2]) / len2
    const off = (d[0] - t * span[0]) ** 2 + (d[1] - t * span[1]) ** 2 + (d[2] - t * span[2]) ** 2
    return t >= 0.5 && t <= 2 && off <= LINE_OFF ** 2 * len2
  }
}

/**
 * Grows a line's ink into every touching opaque pixel that passes `inky`,
 * short of `blocked` ones: its anti-aliased edges, and stretches the palette
 * gave a darker shade. Without them a line comes out broken and thinner than
 * drawn.
 */
function edgesOf(ink: Uint8Array, blocked: (i: number) => boolean, w: number, inky: (i: number) => boolean) {
  const n = ink.length
  const seen = ink.slice()
  let front: number[] = []
  for (let i = 0; i < n; i++) if (ink[i]) front.push(i)
  const visit = (j: number, to: number[]) => {
    if (seen[j]) return
    seen[j] = 1
    if (blocked(j) || !inky(j)) return
    ink[j] = 1
    to.push(j)
  }
  while (front.length) {
    const next: number[] = []
    for (const i of front) {
      const x = i % w
      if (x > 0) visit(i - 1, next)
      if (x < w - 1) visit(i + 1, next)
      if (i >= w) visit(i - w, next)
      if (i + w < n) visit(i + w, next)
    }
    front = next
  }
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

const reverse = (cubics: Cubic[]): Cubic[] => cubics.map(([a, b, c, d]) => [d, c, b, a] as Cubic).reverse()

/** A region's closed loop: its fitted subpath, signed area, whether VOID is across any of it, and its exact pixel-crack outline. */
type Loop = { sub: Subpath; area: number; touchesVoid: boolean; pts: Pt[]; across: Set<number> }
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
    if (c.closed) subs.push(loopOf(c.cubics, across(c) === VOID, c.pts, new Set([across(c)])))
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
    const acrossIds = new Set<number>()
    let c: Oriented | undefined = first
    while (c && !used.has(c)) {
      used.add(c)
      loop.push(...c.cubics)
      pts.push(...(c.reversed ? [...c.pts].reverse() : c.pts))
      if (across(c) === VOID) touchesVoid = true
      acrossIds.add(across(c))
      if (end(c) === start(first)) break
      const into = lastDir(c)
      // Where the region touches itself at a corner, turn left: regions are
      // 4-connected, so the loop goes round this side of the touching point.
      c = (byStart.get(end(c)) ?? [])
        .filter((n) => !used.has(n))
        .sort((a, b) => cross(into, firstDir(a)) - cross(into, firstDir(b)))[0]
    }
    if (loop.length) subs.push(loopOf(loop, touchesVoid, pts, acrossIds))
  }
  return subs
}

/** A loop and its signed area (shoelace over its cubics' end points: enough to rank and orient). */
function loopOf(cubics: Cubic[], touchesVoid: boolean, pts: Pt[], acrossIds: Set<number>): Loop {
  let area = 0
  for (const [a, , , d] of cubics) area += a.x * d.y - d.x * a.y
  return { sub: toSubpath(cubics), area: area / 2, touchesVoid, pts, across: acrossIds }
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
