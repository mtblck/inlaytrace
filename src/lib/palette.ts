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
 * The result is passed to VTracer as a fixed palette, which it matches in OKLab.
 * This is for logos and illustrations; photos have no peaks, so the poster
 * preset keeps VTracer's quantizer.
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

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
