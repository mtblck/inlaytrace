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
 *  2. Walk bins from most to least frequent; accept a bin as a new colour only
 *     if it is perceptually distinct (OKLab distance) from every colour already
 *     accepted, and holds a meaningful share of the image.
 *  3. Stop at the requested count.
 *
 * This is for logos and illustrations. Photos have no peaks (on a photo the
 * peaks raised mean error from 9.9 to 15.3), so they use `quantizePalette`.
 */
export type Rgb = [number, number, number]

export function peakPalette(
  rgba: ArrayLike<number>,
  maxColors: number,
  { minDistance = 0.07, minShare = 0.002 }: { minDistance?: number; minShare?: number } = {},
): string[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>()
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

  const sorted = [...bins.values()].sort((a, b) => b.n - a.n)
  const picked: { lab: Rgb; rgb: Rgb }[] = []
  for (const bin of sorted) {
    if (picked.length >= maxColors) break
    if (bin.n / opaque < minShare && picked.length > 0) break
    const rgb: Rgb = [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n]
    const lab = oklab(rgb)
    if (picked.every((p) => distance(p.lab, lab) >= minDistance)) picked.push({ lab, rgb })
  }
  return picked.map((p) => toHex(p.rgb))
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
 * in its cluster, most common first.
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
  const k = Math.min(Math.max(1, Math.round(maxColors)), points.length)
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

  // Report each cluster as the mean RGB of its pixels: a colour the photo really has.
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
