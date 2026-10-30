/**
 * Edge-preserving smoothing for painted art, before its palette is picked.
 *
 * A painted poster's skin shadow is a soft ramp with brush and JPEG noise on
 * it. Labelled pixel by pixel, the noise flips each pixel between the two
 * nearest palette colours, and the shadow traces as ragged patches. A
 * bilateral filter averages each pixel with neighbours of a similar colour
 * only, so the noise inside a shadow evens out and the edges between colours
 * (an arm against the dark coat, a line on a face) stay where they are.
 *
 * On a painted film poster traced at 2× in Illustration, this turned the
 * blotchy arm and neck shadows into whole shapes, kept the face lines, and cut
 * the file from 3.3 MB to 2.1 MB; the filter took 4 s of the trace. Stronger
 * (radius 6, three passes at sigma 25) began to wash out lines in the hair.
 */

/** Neighbourhood radius, px. */
const RADIUS = 4
/** Spatial falloff (Gaussian sigma, px). */
const SIGMA_SPACE = 3
/** Colour falloff (Gaussian sigma, RGB distance). */
const SIGMA_COLOR = 30
const PASSES = 3

/**
 * A smoothed copy of `rgba` (`width` × `height`, RGBA). Transparent pixels, and
 * any marked in `keep` (one entry per pixel, non-zero to keep), are left as
 * they are and never averaged into their neighbours.
 */
export function smoothShading(rgba: ArrayLike<number>, width: number, height: number, keep?: ArrayLike<number>): Uint8ClampedArray {
  const dxs: number[] = []
  const dys: number[] = []
  const ws: number[] = []
  for (let dy = -RADIUS; dy <= RADIUS; dy++)
    for (let dx = -RADIUS; dx <= RADIUS; dx++)
      if (dx * dx + dy * dy <= RADIUS * RADIUS) {
        dxs.push(dx)
        dys.push(dy)
        ws.push(Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA_SPACE ** 2)))
      }
  const n = ws.length
  const offsets = Int32Array.from(dxs, (dx, k) => (dys[k] * width + dx) * 4)
  const spatial = Float32Array.from(ws)
  // Indexed by squared RGB distance.
  const near = Float32Array.from({ length: 3 * 255 * 255 + 1 }, (_, d2) => Math.exp(-d2 / (2 * SIGMA_COLOR ** 2)))
  let src = Uint8ClampedArray.from(rgba)
  // Kept pixels are made transparent while smoothing, so they are skipped, then put back.
  const kept: number[] = []
  if (keep)
    for (let p = 0; p < width * height; p++)
      if (keep[p] && src[p * 4 + 3] >= 128) {
        kept.push(p, src[p * 4 + 3])
        src[p * 4 + 3] = 0
      }
  for (let pass = 0; pass < PASSES; pass++) {
    const out = new Uint8ClampedArray(src)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (src[i + 3] < 128) continue
        const r = src[i]
        const g = src[i + 1]
        const b = src[i + 2]
        // Away from the border every tap is inside the image.
        const inside = x >= RADIUS && y >= RADIUS && x < width - RADIUS && y < height - RADIUS
        let sr = 0
        let sg = 0
        let sb = 0
        let sw = 0
        for (let k = 0; k < n; k++) {
          if (!inside) {
            const nx = x + dxs[k]
            const ny = y + dys[k]
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          }
          const j = i + offsets[k]
          if (src[j + 3] < 128) continue
          const dr = src[j] - r
          const dg = src[j + 1] - g
          const db = src[j + 2] - b
          const w = spatial[k] * near[dr * dr + dg * dg + db * db]
          sr += w * src[j]
          sg += w * src[j + 1]
          sb += w * src[j + 2]
          sw += w
        }
        out[i] = sr / sw
        out[i + 1] = sg / sw
        out[i + 2] = sb / sw
      }
    src = out
  }
  for (let k = 0; k < kept.length; k += 2) src[kept[k] * 4 + 3] = kept[k + 1]
  return src
}

/** A line pixel is this much darker than its closing (0–255 lightness) at least. */
const LINE_DEPTH = 6
/** And darkened by this many times that depth, */
const LINE_GAIN = 2
/** but by no more than this: a line already well apart from its sides (brows on skin) keeps its colour. */
const LINE_MAX = 30
/** A line is kept only when it spans this many times the radius (bounding-box diagonal): texture is short. */
const LINE_SPAN = 4

/**
 * Painted outlines made plain, before the palette is picked. A painter's line
 * between two near-equal colours (a mouth on a shadowed face, dark trousers
 * against a dark background) is only a few levels darker than either side, so
 * it labels as one of them and is lost. A black-hat filter (the image's
 * closing minus the image, over `radius` px) finds lines up to about twice
 * that wide that are darker than both sides; each is darkened by twice its
 * depth, at most LINE_MAX, colour kept, so it labels apart from both sides.
 * Only lines that run a while are kept: brick, foliage and brush texture are
 * dark too, but short. When `lines` (one entry per pixel) is given, each
 * pixel darkened is marked in it with 1, for `smoothShading`'s `keep` and
 * the tracer's `lines`, which leave them be.
 *
 * On a painted film poster at 2× (radius 3), with smoothing, this brought back
 * the mouth, eyes, brows and jaw lines Illustration lost, and the outline
 * parting dark trousers from a dark background, for twice the paths (2.1 to
 * 3.6 MB). The trousers merged with the background until the lines were marked:
 * the outline was found, but smoothing blurred it back into its sides, and,
 * left unsmoothed, it labelled as the near-black of the trousers, close
 * enough to the dark grey on either side to be folded in as a sliver.
 */
export function boostLines(rgba: ArrayLike<number>, width: number, height: number, radius = 2, lines?: Uint8Array): Uint8ClampedArray {
  const n = width * height
  const out = Uint8ClampedArray.from(rgba)
  const lum = new Float32Array(n)
  for (let i = 0; i < n; i++) lum[i] = 0.299 * out[i * 4] + 0.587 * out[i * 4 + 1] + 0.114 * out[i * 4 + 2]
  // Closing: the brightest over a square, then the darkest over it, each separable.
  const sweep = (src: Float32Array, max: boolean) => {
    const across = new Float32Array(n)
    const down = new Float32Array(n)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let v = src[y * width + x]
        for (let k = Math.max(0, x - radius); k <= Math.min(width - 1, x + radius); k++) v = max ? Math.max(v, src[y * width + k]) : Math.min(v, src[y * width + k])
        across[y * width + x] = v
      }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let v = across[y * width + x]
        for (let k = Math.max(0, y - radius); k <= Math.min(height - 1, y + radius); k++) v = max ? Math.max(v, across[k * width + x]) : Math.min(v, across[k * width + x])
        down[y * width + x] = v
      }
    return down
  }
  const closed = sweep(sweep(lum, true), false)
  const depth = new Float32Array(n)
  for (let i = 0; i < n; i++) if (out[i * 4 + 3] >= 128 && closed[i] - lum[i] > LINE_DEPTH) depth[i] = closed[i] - lum[i]
  // Each 8-connected line, kept when its extent is long enough.
  const seen = new Uint8Array(n)
  const stack: number[] = []
  const piece: number[] = []
  const span = LINE_SPAN * radius
  for (let s = 0; s < n; s++) {
    if (!depth[s] || seen[s]) continue
    seen[s] = 1
    stack.push(s)
    piece.length = 0
    let x0 = width
    let x1 = 0
    let y0 = height
    let y1 = 0
    while (stack.length) {
      const i = stack.pop()!
      piece.push(i)
      const x = i % width
      const y = (i - x) / width
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (depth[j] && !seen[j]) {
            seen[j] = 1
            stack.push(j)
          }
        }
    }
    if (Math.hypot(x1 - x0, y1 - y0) < span) continue
    for (const i of piece) {
      const target = Math.max(0, lum[i] - Math.min(LINE_MAX, LINE_GAIN * depth[i]))
      const f = lum[i] > 0 ? target / lum[i] : 0
      out[i * 4] *= f
      out[i * 4 + 1] *= f
      out[i * 4 + 2] *= f
      if (lines) lines[i] = 1
    }
  }
  return out
}
