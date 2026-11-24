/**
 * Sharpening blurry flat art before its palette is picked.
 *
 * A soft photo of a printed logo has edges that ramp over several pixels from
 * one colour to the next. Labelled pixel by pixel, the ramp's middle is
 * nearest to some third colour (a pale grey between navy and white), and the
 * trace draws it as a band round every shape: a halo. Thin lines lose their
 * colour into the ramps on both sides and drop out.
 *
 * `sharpenEdges` evens out grain first (the bilateral filter of
 * `smoothShading`), then runs a shock filter in colour: each pass, a pixel
 * partway along a ramp takes the colour of its neighbour one pixel further
 * towards the nearer end, so each half of the ramp falls towards its own
 * colour and the edge ends as a step at its middle. A pixel at a peak or a dip
 * (a thin line's middle) keeps its colour, so thin lines stay.
 *
 * Measured in docs/design-notes.md ("Blurry flat art is sharpened by a shock
 * filter, not deconvolved"). Unsharp
 * masking and Richardson–Lucy deconvolution were tried first: both brought
 * the paper grain up with the edges and the file grew; neither removed the
 * halo, since a sharper ramp is still a ramp.
 */
import { smoothShading } from './smooth'

const luma = (px: ArrayLike<number>, i: number) => 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!

/** Contrast (0–255 lightness) an edge needs to be measured. */
const EDGE_CONTRAST = 60
/** A point counts as an edge only this close to the steepest slope in its window. */
const STEEPEST = 0.8
/** Half-window, px, an edge's contrast is measured over. */
const EDGE_WINDOW = 6

/**
 * How soft the image's edges are, in px: the Gaussian blur a hard edge would
 * need to look like the image's strong edges. A step of contrast C blurred by
 * σ is steepest at C / (σ√2π), so each strong edge gives σ ≈ C / (slope · √2π),
 * with C the lightness range around it. The median over every strong edge;
 * 0 when there are none.
 *
 * Crisp art reads 0.7–0.9 (anti-aliasing), JPEG or not; the same art blurred
 * by 2 px reads 1.7–2.5, photos 0.9–1.5, a soft photo of a printed logo 2.1.
 */
export function edgeBlur(rgba: ArrayLike<number>, width: number, height: number): number {
  const n = width * height
  const L = new Float32Array(n)
  for (let p = 0; p < n; p++) L[p] = rgba[p * 4 + 3]! < 128 ? NaN : luma(rgba, p * 4)
  const slope = new Float32Array(n)
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x
      // NaN (next to transparency) fails every comparison below, so it's never an edge.
      slope[p] = Math.hypot(L[p + 1]! - L[p - 1]!, L[p + width]! - L[p - width]!) / 2
    }
  const R = EDGE_WINDOW
  const found: number[] = []
  // Every other pixel is plenty, and halves the work.
  for (let y = R; y < height - R; y += 2)
    for (let x = R; x < width - R; x += 2) {
      const p = y * width + x
      const s = slope[p]!
      if (!(s >= 4)) continue
      // Steepest point of the edge, across x or across y.
      if (!((s >= slope[p - 1]! && s >= slope[p + 1]!) || (s >= slope[p - width]! && s >= slope[p + width]!))) continue
      let lo = 255
      let hi = 0
      let steepest = 0
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const q = p + dy * width + dx
          const v = L[q]!
          if (v < lo) lo = v
          if (v > hi) hi = v
          if (slope[q]! > steepest) steepest = slope[q]!
        }
      // Only an edge's steepest point: JPEG's ringing beside a hard edge is a gentle slope with the edge's whole contrast in view.
      if (hi - lo >= EDGE_CONTRAST && s >= STEEPEST * steepest) found.push((hi - lo) / (s * Math.sqrt(2 * Math.PI)))
    }
  if (!found.length) return 0
  found.sort((a, b) => a - b)
  return found[found.length >> 1]!
}

/** Below this measured blur (px), edges are left as they are. */
export const SOFT_EDGES = 1.5
/** Passes per px of blur: each moves an edge's ramp one pixel nearer its ends. */
const PASSES_PER_PX = 4.5
const MAX_PASSES = 12
/** Smoothing (Gaussian σ, px) of the copy each pass decides on, so grain doesn't. */
const DECIDE_SIGMA = 1.5
/** How far either way (px) a pass looks to see which end of the ramp a pixel is nearer. */
const LOOK = 3
/** Colour difference (RGB distance) across that look below which a pixel isn't on an edge. */
const MIN_STEP = 12
/** Smoothing (Gaussian σ, px) of the edge directions. */
const DIRECTION_SIGMA = 1.5

/**
 * A copy of `rgba` (`width` × `height`, RGBA) with soft edges made hard.
 * `blur` is how soft they are (`edgeBlur`, measured when left out); below
 * `SOFT_EDGES` the image is only copied. `scale` is how many times the image
 * was enlarged before this: enlarging softens edges by as much, so the
 * threshold and the most passes grow with it. Transparent pixels are left as
 * they are, and their colour never seeps in.
 */
export function sharpenEdges(rgba: ArrayLike<number>, width: number, height: number, blur = edgeBlur(rgba, width, height), scale = 1): Uint8ClampedArray {
  const k = Math.max(1, scale)
  if (blur < SOFT_EDGES * k || width < 3 || height < 3) return Uint8ClampedArray.from(rgba)
  const passes = Math.min(MAX_PASSES * k, Math.round(PASSES_PER_PX * blur))
  const smooth = smoothShading(rgba, width, height)
  const n = width * height
  const opaque = new Uint8Array(n)
  for (let p = 0; p < n; p++) opaque[p] = rgba[p * 4 + 3]! >= 128 ? 1 : 0
  let ch: Float32Array[] = [0, 1, 2].map((c) => Float32Array.from({ length: n }, (_, p) => smooth[p * 4 + c]!))
  extend(ch, opaque, width, height)
  for (let pass = 0; pass < passes; pass++) ch = shockPass(ch, width, height, opaque)
  const out = Uint8ClampedArray.from(rgba)
  for (let c = 0; c < 3; c++) for (let p = 0; p < n; p++) if (opaque[p]) out[p * 4 + c] = ch[c]![p]!
  return out
}

/** How far (px) opaque colours are carried into transparency: past every blur and look of a pass. */
const EXTEND = Math.ceil(3 * DECIDE_SIGMA + 3 * DIRECTION_SIGMA + LOOK + 2)

/**
 * Transparent pixels given the colour of the opaque ones beside them, ring by
 * ring, out to EXTEND px, so the blurs and looks across a cut-out edge see
 * the shape's own colour, not the black that canvases keep under alpha 0
 * (which put a dark rim round a background-removed logo).
 */
function extend(ch: Float32Array[], opaque: Uint8Array, w: number, h: number) {
  const known = Uint8Array.from(opaque)
  let ring: number[] = []
  for (let r = 0; r < EXTEND; r++) {
    ring = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (known[p]) continue
        let sum0 = 0
        let sum1 = 0
        let sum2 = 0
        let m = 0
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
          if (q >= 0 && known[q]) {
            sum0 += ch[0]![q]!
            sum1 += ch[1]![q]!
            sum2 += ch[2]![q]!
            m++
          }
        if (!m) continue
        ch[0]![p] = sum0 / m
        ch[1]![p] = sum1 / m
        ch[2]![p] = sum2 / m
        ring.push(p)
      }
    if (!ring.length) break
    for (const p of ring) known[p] = 1
  }
}

/**
 * The unit direction across the edge at each pixel: the main axis of the
 * colour structure tensor (the three channels' gradients, from the smoothed
 * copy a pass decides on), smoothed so that a ramp's pixels agree. Zero where
 * the image is flat. Gradients from a less smoothed copy (σ 0.7, or Sobel)
 * left ramps in low-contrast detail (a grille) half sharpened.
 */
function directions(smooth: Float32Array[], w: number, h: number): [Float32Array, Float32Array] {
  const n = w * h
  const jxx = new Float32Array(n)
  const jxy = new Float32Array(n)
  const jyy = new Float32Array(n)
  for (const f of smooth)
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x
        const gx = (f[p + 1]! - f[p - 1]!) / 2
        const gy = (f[p + w]! - f[p - w]!) / 2
        jxx[p] += gx * gx
        jxy[p] += gx * gy
        jyy[p] += gy * gy
      }
  const a = gauss(jxx, w, h, DIRECTION_SIGMA)
  const b = gauss(jxy, w, h, DIRECTION_SIGMA)
  const c = gauss(jyy, w, h, DIRECTION_SIGMA)
  const ex = new Float32Array(n)
  const ey = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const A = a[p]!
    const B = b[p]!
    const C = c[p]!
    const l1 = (A + C) / 2 + Math.sqrt(((A - C) / 2) ** 2 + B * B)
    // Either row of (J − λ₁I) gives the eigenvector; take the longer, which is the stable one.
    let x = B
    let y = l1 - A
    if (Math.abs(x) + Math.abs(y) < Math.abs(l1 - C) + Math.abs(B)) {
      x = l1 - C
      y = B
    }
    const m = Math.hypot(x, y)
    if (m > 1e-6) {
      ex[p] = x / m
      ey[p] = y / m
    }
  }
  return [ex, ey]
}

/**
 * One shock-filter pass (see the top of the file); returns new channels. The
 * directions are measured again each pass, since they turn as edges sharpen.
 */
function shockPass(ch: Float32Array[], w: number, h: number, opaque: Uint8Array): Float32Array[] {
  const decide = ch.map((c) => gauss(c, w, h, DECIDE_SIGMA))
  const [ex, ey] = directions(decide, w, h)
  const next = ch.map((c) => Float32Array.from(c))
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const dx = ex[p]!
      const dy = ey[p]!
      if (!opaque[p] || (dx === 0 && dy === 0)) continue
      let toA = 0
      let toB = 0
      let dot = 0
      let across = 0
      for (let k = 0; k < 3; k++) {
        const f = decide[k]!
        const v = f[p]!
        const a = bilinear(f, w, h, x + LOOK * dx, y + LOOK * dy) - v
        const b = bilinear(f, w, h, x - LOOK * dx, y - LOOK * dy) - v
        toA += a * a
        toB += b * b
        dot += a * b
        across += (a - b) ** 2
      }
      // Flat, or a peak or dip (both sides the same way from it): leave it.
      if (across < MIN_STEP * MIN_STEP || dot >= 0) continue
      const s = toA < toB ? 1 : -1
      for (let k = 0; k < 3; k++) next[k]![p] = bilinear(ch[k]!, w, h, x + s * dx, y + s * dy)
    }
  return next
}

function bilinear(f: Float32Array, w: number, h: number, x: number, y: number): number {
  x = Math.min(w - 1.001, Math.max(0, x))
  y = Math.min(h - 1.001, Math.max(0, y))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const p = y0 * w + x0
  return (f[p]! * (1 - fx) + f[p + 1]! * fx) * (1 - fy) + (f[p + w]! * (1 - fx) + f[p + w + 1]! * fx) * fy
}

/** Separable Gaussian blur of a plane, edges clamped. */
function gauss(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma)
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let acc = 0
      if (x >= r && x < w - r) for (let i = -r; i <= r; i++) acc += k[i + r]! * src[row + x + i]!
      else for (let i = -r; i <= r; i++) acc += k[i + r]! * src[row + Math.min(w - 1, Math.max(0, x + i))]!
      tmp[row + x] = acc
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0
      if (y >= r && y < h - r) for (let i = -r; i <= r; i++) acc += k[i + r]! * tmp[(y + i) * w + x]!
      else for (let i = -r; i <= r; i++) acc += k[i + r]! * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]!
      out[y * w + x] = acc
    }
  return out
}
