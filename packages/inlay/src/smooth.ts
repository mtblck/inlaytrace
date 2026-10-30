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
 * A smoothed copy of `rgba` (`width` × `height`, RGBA). Transparent pixels are
 * left as they are and never averaged into their neighbours.
 */
export function smoothShading(rgba: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
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
  return src
}
