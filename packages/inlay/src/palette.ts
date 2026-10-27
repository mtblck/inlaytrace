/**
 * Palette extraction for flat artwork.
 *
 * VTracer's own quantizer averages each cluster, so a flat colour that borders
 * a lighter one drifts towards it: on the sample badge the gold sun (#e9a23b)
 * came out pale peach (#e9c38f) — wrong enough to break a brand colour. Flat
 * art has a property quantizers ignore: its real colours are sharp *peaks* in
 * the histogram, and everything between them (anti-aliasing, JPEG ringing) is
 * a thin spread of low-count shades. So instead of clustering, take the peaks:
 *
 *  1. Histogram at 5 bits per channel, keeping each bin's true mean colour.
 *  2. Weigh each bin by the pixels within half the distinct-colour distance of
 *     it (OKLab), so a colour spread over several bins counts in full.
 *  3. Walk bins from heaviest to lightest; accept a bin as a new colour only
 *     if it is perceptually distinct (OKLab distance) from every colour already
 *     accepted, and its weight is a meaningful share of the image. A smaller
 *     share (a decal, lettering) is still a colour if it isn't a blend of two
 *     colours already accepted (an anti-aliased edge between them).
 *  4. Stop at the requested count.
 *  5. Given the image's `width`, fill what's left of the count with pale tints:
 *     flat colours (pixels that match their four neighbours) too close to a
 *     picked colour for step 3. A light-blue fill on white is 0.03 from it in
 *     OKLab and lies on the line from white to the blue ink, so step 3 calls
 *     it an edge between the two; but an edge is never flat, and a fill is.
 *
 * This is for logos and illustrations. Photos have no peaks (on a photo the
 * peaks raised mean error from 9.9 to 15.3), so they use `quantizePalette`.
 */
export type Rgb = [number, number, number]

export function peakPalette(
  rgba: ArrayLike<number>,
  maxColors: number,
  {
    minDistance = 0.07,
    minShare = 0.002,
    minDetail = 0.0005,
    width,
    minTint = 0.02,
    minFlat = 0.001,
  }: { minDistance?: number; minShare?: number; minDetail?: number; width?: number; minTint?: number; minFlat?: number } = {},
): string[] {
  const bins = new Map<number, Bin>()
  let opaque = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
    const bin = bins.get(key)
    if (bin) {
      bin.n++
      bin.r += r
      bin.g += g
      bin.b += b
    } else bins.set(key, { n: 1, r, g, b })
    opaque++
  }

  // A colour's weight is every pixel within half the distinct-colour distance
  // of it, not just its own bin. A flat colour is one bin either way, but a
  // photographed one (red lettering, a yellow decal) spreads over many bins
  // that are each too small: by its own bin alone the walk stopped at the
  // greys, and a photo of a grey ship with red and yellow details got 6
  // colours (black, white, greys and one blue) at any cap.
  const flat = width ? flatBins(rgba, width) : null
  const items = [...bins].map(([key, bin]) => {
    const rgb: Rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]
    return { n: bin.n, flat: flat?.get(key)?.n ?? 0, rgb, lab: oklab(rgb), weight: 0, flatWeight: 0, peak: true }
  })
  weigh(items, minDistance / 2)

  // Only local peaks are candidates (no nearby bin has more pixels), so a flat
  // colour is its own bin, not a neighbour that borrowed its weight; heaviest first.
  const sorted = items.filter((it) => it.peak).sort((a, b) => b.weight - a.weight || b.n - a.n)
  const picked: { lab: Rgb; rgb: Rgb }[] = []
  for (const it of sorted) {
    if (picked.length >= maxColors) break
    const share = it.weight / opaque
    if (share < minDetail && picked.length > 0) break
    if (!picked.every((p) => distance(p.lab, it.lab) >= minDistance)) continue
    // Below minShare a colour is a detail (a small decal, thin lettering): kept
    // only if it isn't a blend of two colours already picked, which is what
    // anti-aliased edges and JPEG ringing between them are made of. Given the
    // width, a blend that is almost never flat is an edge at any share: thin
    // blue outlines on white have so much edge that it outweighed minShare.
    const edge = share < minShare || (flat !== null && share < EDGE_SHARE && it.flatWeight < EDGE_FLAT * it.weight)
    if (edge && isBlend(it.rgb, it.lab, picked, minDistance)) continue
    picked.push({ lab: it.lab, rgb: it.rgb })
  }
  if (flat && picked.length < maxColors) picked.push(...flatTints(flat, opaque, picked, maxColors - picked.length, minTint, minFlat))
  return picked.map((p) => toHex(p.rgb))
}

/** Below this share of flat pixels, a colour is an edge's, not a fill's. */
const EDGE_FLAT = 0.05
/**
 * But only below this share of the image: 1 px grey rules or a dithered fill
 * are never flat either, and at 8% of a logo they are a colour of their own.
 */
const EDGE_SHARE = 0.02

type Bin = { n: number; r: number; g: number; b: number }

/**
 * The image's flat pixels, binned as peakPalette bins them. A pixel is flat
 * when its four neighbours are within 8 of it in every channel: inside a fill,
 * never on an anti-aliased edge or in JPEG ringing.
 */
function flatBins(rgba: ArrayLike<number>, w: number) {
  const h = Math.floor(rgba.length / 4 / w)
  const bins = new Map<number, Bin>()
  const near = (i: number, j: number) =>
    rgba[j + 3] >= 128 && Math.abs(rgba[i] - rgba[j]) <= 8 && Math.abs(rgba[i + 1] - rgba[j + 1]) <= 8 && Math.abs(rgba[i + 2] - rgba[j + 2]) <= 8
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      if (rgba[i + 3] < 128 || !near(i, i - 4) || !near(i, i + 4) || !near(i, i - 4 * w) || !near(i, i + 4 * w)) continue
      const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)
      const bin = bins.get(key)
      if (bin) {
        bin.n++
        bin.r += rgba[i]
        bin.g += rgba[i + 1]
        bin.b += rgba[i + 2]
      } else bins.set(key, { n: 1, r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] })
    }
  return bins
}

/**
 * Each item's weight (the pixels of every bin within `radius` of it in OKLab)
 * and flat weight, and whether it is a local peak (no bin within
 * `radius` has more). A grid of `radius` cells keeps it near linear.
 */
function weigh<T extends { n: number; flat: number; lab: Rgb; weight: number; flatWeight: number; peak: boolean }>(items: T[], radius: number) {
  radius = Math.max(radius, 1e-3) // a zero radius would make every grid cell infinite
  const cell = (v: number) => Math.floor(v / radius)
  const grid = new Map<string, T[]>()
  for (const it of items) {
    const k = `${cell(it.lab[0])},${cell(it.lab[1])},${cell(it.lab[2])}`
    const list = grid.get(k)
    if (list) list.push(it)
    else grid.set(k, [it])
  }
  for (const it of items) {
    const [cl, ca, cb] = it.lab.map(cell)
    for (let i = cl - 1; i <= cl + 1; i++)
      for (let j = ca - 1; j <= ca + 1; j++)
        for (let k = cb - 1; k <= cb + 1; k++)
          for (const o of grid.get(`${i},${j},${k}`) ?? [])
            if (distance(o.lab, it.lab) <= radius) {
              it.weight += o.n
              it.flatWeight += o.flat
              if (o.n > it.n) it.peak = false
            }
  }
}

/**
 * Pale tints: flat colours at least `minTint` from every colour picked, each
 * flat over at least `minFlat` of the image, heaviest first. On a
 * sinking-ship illustration (blue outlines on white, the ship and moon filled
 * with pale blues) this found the three fills and nothing else.
 */
function flatTints(flat: Map<number, Bin>, opaque: number, picked: { lab: Rgb }[], room: number, minTint: number, minFlat: number) {
  // As in the main walk, but over flat pixels only, and closer together.
  const items = [...flat.values()].map((bin) => {
    const rgb: Rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]
    return { n: bin.n, flat: bin.n, rgb, lab: oklab(rgb), weight: 0, flatWeight: 0, peak: true }
  })
  weigh(items, minTint / 2)
  const out: { lab: Rgb; rgb: Rgb }[] = []
  for (const it of items.filter((it) => it.peak && it.weight >= minFlat * opaque).sort((a, b) => b.weight - a.weight)) {
    if (out.length >= room) break
    if ([...picked, ...out].every((p) => distance(p.lab, it.lab) >= minTint)) out.push({ lab: it.lab, rgb: it.rgb })
  }
  return out
}

/**
 * Whether a colour lies near the line between two picked colours, mixed as a
 * renderer mixes them (in sRGB): the nearest mix is within `tolerance` (OKLab).
 */
function isBlend(rgb: Rgb, lab: Rgb, picked: { rgb: Rgb }[], tolerance: number) {
  for (let i = 0; i < picked.length; i++)
    for (let j = i + 1; j < picked.length; j++) {
      const a = picked[i].rgb
      const b = picked[j].rgb
      const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const len = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
      if (!len) continue
      const t = Math.min(1, Math.max(0, ((rgb[0] - a[0]) * d[0] + (rgb[1] - a[1]) * d[1] + (rgb[2] - a[2]) * d[2]) / len))
      if (distance(oklab([a[0] + t * d[0], a[1] + t * d[1], a[2] + t * d[2]]), lab) < tolerance) return true
    }
  return false
}

export function oklab([r, g, b]: Rgb): Rgb {
  const lin = (c: number) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/**
 * A photo's palette: `maxColors` colours that best summarise it, by k-means in
 * OKLab (so the clusters are perceptual, not RGB boxes).
 *
 * It clusters a 5-bit-per-channel histogram, each bin weighted by its pixel
 * count, rather than the pixels themselves: the same answer to within a bin,
 * at a fraction of the work. It's deterministic: the first centre is the most
 * common colour, and each next one is the colour farthest from those chosen,
 * weighted by how common it is (k-means++ without the dice), so a photo traces
 * the same way every time. Each colour returned is the true mean of the pixels
 * in its cluster, most common first. `maxColors` is rounded and taken as at
 * least 1 (so 0 or NaN gives one colour); fewer come back when the image has
 * fewer distinct colours, and none when every pixel is transparent.
 */
export function quantizePalette(rgba: ArrayLike<number>, maxColors: number, { iterations = 16 }: { iterations?: number } = {}): string[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)
    const bin = bins.get(key)
    if (bin) {
      bin.n++
      bin.r += rgba[i]
      bin.g += rgba[i + 1]
      bin.b += rgba[i + 2]
    } else bins.set(key, { n: 1, r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] })
  }
  const points = [...bins.values()]
    .sort((a, b) => b.n - a.n)
    .map((bin) => {
      const rgb: Rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]
      return { n: bin.n, rgb, lab: oklab(rgb) }
    })
  const k = Math.min(Number.isFinite(maxColors) ? Math.max(1, Math.round(maxColors)) : 1, points.length)
  if (!k) return []

  // Seeds: the most common colour, then repeatedly the farthest (count × distance²).
  const centres: Rgb[] = [points[0].lab]
  const nearest = points.map((p) => distance2(p.lab, centres[0]))
  while (centres.length < k) {
    let best = 0
    let bestScore = -1
    points.forEach((p, i) => {
      const score = p.n * nearest[i]
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    })
    if (bestScore <= 0) break // fewer distinct colours than asked for
    centres.push(points[best].lab)
    points.forEach((p, i) => (nearest[i] = Math.min(nearest[i], distance2(p.lab, points[best].lab))))
  }

  // Lloyd iterations, weighted by count.
  const assign = new Int32Array(points.length)
  for (let it = 0; it < iterations; it++) {
    let moved = false
    points.forEach((p, i) => {
      let best = 0
      let bestD = Infinity
      centres.forEach((c, j) => {
        const d = distance2(p.lab, c)
        if (d < bestD) {
          bestD = d
          best = j
        }
      })
      if (assign[i] !== best || it === 0) moved = true
      assign[i] = best
    })
    const sums = centres.map(() => ({ n: 0, l: 0, a: 0, b: 0 }))
    points.forEach((p, i) => {
      const s = sums[assign[i]]
      s.n += p.n
      s.l += p.lab[0] * p.n
      s.a += p.lab[1] * p.n
      s.b += p.lab[2] * p.n
    })
    sums.forEach((s, j) => {
      if (s.n) centres[j] = [s.l / s.n, s.a / s.n, s.b / s.n]
    })
    if (!moved) break
  }

  // Report each cluster as the mean RGB of its pixels (a blend of the photo's colours, not a
  // drift towards a neighbour cluster).
  const out = centres.map(() => ({ n: 0, r: 0, g: 0, b: 0 }))
  points.forEach((p, i) => {
    const o = out[assign[i]]
    o.n += p.n
    o.r += p.rgb[0] * p.n
    o.g += p.rgb[1] * p.n
    o.b += p.rgb[2] * p.n
  })
  const hexes = out
    .filter((o) => o.n)
    .sort((a, b) => b.n - a.n)
    .map((o) => toHex([o.r / o.n, o.g / o.n, o.b / o.n]))
  return [...new Set(hexes)]
}

const distance2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

/**
 * Pixel art's palette: its colours exactly, most-used first. Pixel art has a
 * handful of deliberate colours, and a one-pixel eye matters as much as the
 * sky, so nothing is merged or dropped for being rare or close to another.
 * Beyond `maxColors` distinct colours (a photo picked as pixel art), the
 * rarest ones take their nearest kept colour when pixels are labelled.
 */
export function exactPalette(rgba: ArrayLike<number>, maxColors: number): string[] {
  const counts = new Map<number, number>()
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, Math.max(1, maxColors))
    .map(([k]) => `#${k.toString(16).padStart(6, '0')}`)
}
