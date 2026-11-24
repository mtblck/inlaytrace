/**
 * Taking the blur out of a soft picture of flat art, before its palette is picked.
 *
 * A blurry photo of a printed logo has edges that ramp over many pixels from
 * one colour to the next. Labelled pixel by pixel, the ramp's middle is
 * nearest to some third colour, and the trace draws it as a band round every
 * shape: a halo. Sharpening filters don't help: a sharper ramp is still a
 * ramp, and a shock filter only turns the band solid (docs/design-notes.md,
 * "Blurry flat art is solved for, not sharpened").
 *
 * `deblur` instead looks for the flat picture that explains the photo. It
 * measures how blurred the image is, place by place (a photo taken at an
 * angle is sharper on one side), and which few colours its flat areas are
 * made of. Then it searches for the map of those colours that, blurred the
 * same way, looks most like the photo, with boundaries no longer than they
 * need to be. A halo's band never survives that search: a step between its
 * two neighbours, blurred, already matches the photo there, so the band buys
 * nothing and costs boundary. A thin line does survive, since no blurred step
 * between its neighbours makes a dip.
 *
 * The map found is of square pixels, and the photo's own texture (print has
 * one) ripples its edges by a pixel or so. Under a blur the photo cannot say
 * where an edge runs to better than that, so each boundary is smoothed along
 * its length before the result is drawn (`boundaries`): arcs come out
 * smooth, corners stay where they are, and an edge a line fits is drawn as
 * that line, exactly straight. The result is
 * drawn at full size with clean anti-aliased edges, for the tracer to label
 * as it would crisp art.
 *
 * Two things about the photo are worked out first, since either one wrong
 * puts every edge in the wrong place:
 *
 * - What was blurred. A lens blurs light; a resize, a filter or an upscale
 *   blurs the stored (sRGB) values. The same step blurred each way differs:
 *   as light, white outweighs black, and the stored ramp's middle sits well
 *   inside the dark side. Solving a stored blur as light draws every dark
 *   outline about half a blur too fat. The ramps of the starkest edges tell
 *   the two apart (`blurredAsLight`).
 * - Colour fringes (red and blue landing a pixel or two off green, common in
 *   phone photos), which are measured and undone, or each edge would carry
 *   an orange or blue rim that no blurred step explains.
 */

/** Below this measured blur (px), an image is left as it is. */
export const SOFT_EDGES = 1.5

/** Linear light (0–1) to sRGB (0–1). */
const enc = (v: number) => (v <= 0.0031308 ? 12.92 * Math.max(v, 0) : 1.055 * v ** (1 / 2.4) - 0.055)
/** Slope of `enc`: how much a small error in linear light shows. */
const encSlope = (v: number) => (v <= 0.0031308 ? 12.92 : (1.055 / 2.4) * v ** (1 / 2.4 - 1))

/** sRGB (0–255, any float) to linear light, 0–1. */
const toLight = (v: number) => {
  const s = Math.min(1, Math.max(0, v / 255))
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/**
 * The units a blur happened in. `to` takes a stored value (0–255) there (0–1),
 * `back` returns it (0–1 of 255), and `shows` is back's slope: how much a
 * small error in those units shows on screen.
 */
type Space = { to: (v: number) => number; back: (u: number) => number; shows: (u: number) => number }
/** Blurred as stored: by a resize, a filter, an upscale. */
const STORED: Space = { to: (v) => Math.min(1, Math.max(0, v / 255)), back: (u) => u, shows: () => 1 }
/** Blurred as light: by a lens. */
const LIGHT: Space = { to: toLight, back: enc, shows: encSlope }

/** A 1-D Gaussian of the given sigma, out to 3 sigma, summing to 1. */
function gauss1(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma))
  const k = new Float32Array(2 * r + 1)
  let sum = 0
  for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma))
  for (let i = 0; i < k.length; i++) k[i]! /= sum
  return k
}

/** `src` (w × h) blurred by a Gaussian; edges repeat. */
function blur(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const k = gauss1(sigma)
  const r = (k.length - 1) >> 1
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r]! * src[row + Math.min(w - 1, Math.max(0, x + i))]!
      tmp[row + x] = s
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let i = -r; i <= r; i++) s += k[i + r]! * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]!
      out[y * w + x] = s
    }
  return out
}

/** `src` at (x, y), between pixels; edges repeat. */
function sample(src: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = Math.min(w - 1, Math.max(0, x))
  const cy = Math.min(h - 1, Math.max(0, y))
  const x0 = Math.min(w - 2 < 0 ? 0 : w - 2, Math.floor(cx))
  const y0 = Math.min(h - 2 < 0 ? 0 : h - 2, Math.floor(cy))
  const fx = cx - x0
  const fy = cy - y0
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  return (src[y0 * w + x0]! * (1 - fx) + src[y0 * w + x1]! * fx) * (1 - fy) + (src[y1 * w + x0]! * (1 - fx) + src[y1 * w + x1]! * fx) * fy
}

/** A coarse grid of values with weights, evened out and read back anywhere: empty cells take their neighbours'. */
function gridField(values: Float32Array, weights: Float32Array, gw: number, gh: number, spread = 1.5): (gx: number, gy: number) => number {
  const num = new Float32Array(gw * gh)
  let top = 0
  for (let i = 0; i < num.length; i++) {
    num[i] = values[i]! * weights[i]!
    if (weights[i]! > top) top = weights[i]!
  }
  const n = blur(num, gw, gh, spread)
  const d = blur(weights, gw, gh, spread)
  const field = new Float32Array(gw * gh)
  let any = false
  for (let i = 0; i < field.length; i++)
    if (d[i]! > 1e-6 * top) {
      field[i] = n[i]! / d[i]!
      any = true
    } else field[i] = NaN
  // Cells too far from any measurement take the nearest filled cell's value, ring by ring.
  for (let pass = 0; any && pass < gw + gh; pass++) {
    let left = false
    const prev = Float32Array.from(field)
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x
        if (!Number.isNaN(prev[i]!)) continue
        let s = 0
        let c = 0
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            const yy = y + dy
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue
            const v = prev[yy * gw + xx]!
            if (!Number.isNaN(v)) (s += v), c++
          }
        if (c) field[i] = s / c
        else left = true
      }
    if (!left) break
  }
  if (!any) field.fill(0)
  return (gx, gy) => sample(field, gw, gh, gx, gy)
}

/* ------------------------------------------------------------------ colour fringes */

/** Half-size block (px) a channel's offset is measured over, and how far apart blocks start. */
const FRINGE_BLOCK = 32
const FRINGE_STEP = 32
/** Furthest offset looked for, in half-size px. */
const FRINGE_REACH = 6
/** Offsets under this (px) over nine tenths of the picture are left alone… */
const FRINGE_MIN = 0.5
/** …as are offsets under this share of the blur: blurred colours' edges differ a little by channel anyway. */
const FRINGE_PER_BLUR = 0.25
/** How far (blocks) the measured offsets are evened out: a lens's fringe changes slowly across the picture. */
const FRINGE_SPREAD = 2

/**
 * Red and blue moved back onto green. Each is compared with green block by
 * block, at half size: the offset at which its edges line up best with
 * green's, across and down. The offsets, evened out into a smooth field (they
 * grow towards a lens's edge, and with the blur), are then undone. Returns
 * null when no block is off by enough to matter. Channels are 0–255 floats.
 */
function alignChannels(ch: Float32Array[], w: number, h: number, blurPx: number): Float32Array[] | null {
  const hw = w >> 1
  const hh = h >> 1
  const B = FRINGE_BLOCK
  if (hw < B + 2 * FRINGE_REACH + 2 || hh < B + 2 * FRINGE_REACH + 2) return null
  const gw = Math.floor((hw - B) / FRINGE_STEP) + 1
  const gh = Math.floor((hh - B) / FRINGE_STEP) + 1
  const n = w * h
  // Total offsets so far, per moved channel (red, blue) and axis.
  const total = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  let cur = ch
  let moved = false
  for (let round = 0; round < 2; round++) {
    const grads = cur.map((c) => {
      const half = new Float32Array(hw * hh)
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) half[y * hw + x] = (c[2 * y * w + 2 * x]! + c[2 * y * w + 2 * x + 1]! + c[(2 * y + 1) * w + 2 * x]! + c[(2 * y + 1) * w + 2 * x + 1]!) / 4
      const s = blur(half, hw, hh, 1)
      const gx = new Float32Array(hw * hh)
      const gy = new Float32Array(hw * hh)
      for (let y = 1; y < hh - 1; y++)
        for (let x = 1; x < hw - 1; x++) {
          gx[y * hw + x] = (s[y * hw + x + 1]! - s[y * hw + x - 1]!) / 2
          gy[y * hw + x] = (s[(y + 1) * hw + x]! - s[(y - 1) * hw + x]!) / 2
        }
      return [gx, gy]
    })
    let biggest = 0
    const fields: ((gx: number, gy: number) => number)[] = []
    for (const c of [0, 2])
      for (let axis = 0; axis < 2; axis++) {
        const ref = grads[1]![axis]!
        const mov = grads[c]![axis]!
        const step = axis === 0 ? 1 : hw
        const vals = new Float32Array(gw * gh)
        const wts = new Float32Array(gw * gh)
        const score = new Float32Array(2 * FRINGE_REACH + 1)
        for (let by = 0; by < gh; by++)
          for (let bx = 0; bx < gw; bx++) {
            const x0 = bx * FRINGE_STEP
            const y0 = by * FRINGE_STEP
            let e = 0
            for (let y = y0; y < y0 + B; y++) for (let x = x0; x < x0 + B; x++) e += ref[y * hw + x]! ** 2
            // Too little edge in this block to measure anything.
            if (e < B * B * 4) continue
            let best = 0
            for (let d = -FRINGE_REACH; d <= FRINGE_REACH; d++) {
              let dot = 0
              let own = 0
              for (let y = y0; y < y0 + B; y++)
                for (let x = x0; x < x0 + B; x++) {
                  const xx = axis === 0 ? x + d : x
                  const yy = axis === 0 ? y : y + d
                  if (xx < 0 || yy < 0 || xx >= hw || yy >= hh) continue
                  const v = mov[y * hw + x + d * step]!
                  dot += ref[y * hw + x]! * v
                  own += v * v
                }
              score[d + FRINGE_REACH] = dot / Math.sqrt(e * own + 1e-9)
              if (score[d + FRINGE_REACH]! > score[best]!) best = d + FRINGE_REACH
            }
            if (best === 0 || best === score.length - 1 || score[best]! <= 0) continue
            const curve = score[best - 1]! - 2 * score[best]! + score[best + 1]!
            const off = curve < 0 ? (0.5 * (score[best - 1]! - score[best + 1]!)) / curve : 0
            // In full-size px.
            vals[by * gw + bx] = 2 * (best - FRINGE_REACH + off)
            wts[by * gw + bx] = score[best]! * Math.sqrt(e)
          }
        const field = gridField(vals, wts, gw, gh, FRINGE_SPREAD)
        fields.push(field)
        const sizes: number[] = []
        for (let i = 0; i < gw * gh; i++) if (wts[i]! > 0) sizes.push(Math.abs(field(i % gw, Math.floor(i / gw))))
        sizes.sort((x, y) => x - y)
        // A tenth of the picture fringed is a fringe; one odd block is not.
        if (sizes.length) biggest = Math.max(biggest, sizes[Math.floor(sizes.length * 0.9)]!)
      }
    if (biggest < Math.max(FRINGE_MIN, FRINGE_PER_BLUR * blurPx)) break
    moved = true
    const next = [new Float32Array(n), cur[1]!, new Float32Array(n)]
    for (let k = 0; k < 2; k++) {
      const c = k * 2
      const tx = total[k * 2]!
      const ty = total[k * 2 + 1]!
      const fx = fields[k * 2]!
      const fy = fields[k * 2 + 1]!
      for (let y = 0; y < h; y++) {
        const gy = (y / 2 - B / 2) / FRINGE_STEP
        for (let x = 0; x < w; x++) {
          const gx = (x / 2 - B / 2) / FRINGE_STEP
          const p = y * w + x
          tx[p]! += fx(gx, gy)
          ty[p]! += fy(gx, gy)
          next[c]![p] = sample(ch[c]!, w, h, x + tx[p]!, y + ty[p]!)
        }
      }
    }
    cur = next
  }
  return moved ? cur : null
}

/* ------------------------------------------------------------------ how blurred, where */

/** Contrast (of 255) an edge needs to be measured: only bold edges, whose two sides are surely flat. */
const EDGE_CONTRAST = 40
/** How far (px) either side of an edge its ramp is followed. */
const EDGE_REACH = 30
/** Block (px) the edges' blurs are pooled over, and how far apart blocks start. */
const BLUR_BLOCK = 96
const BLUR_STEP = 48

/**
 * Every bold edge's ramp: from a point where the image is steepest, the
 * values along the way uphill, out to where they level off either side.
 * `each` gets the point, the slope there, and the ramp as `prof[lo..hi]`
 * (dark end first).
 */
function ramps(lum: Float32Array, w: number, h: number, reach: number, each: (x: number, y: number, slope: number, prof: Float32Array, lo: number, hi: number) => void) {
  const g = blur(lum, w, h, 1)
  const gx = new Float32Array(w * h)
  const gy = new Float32Array(w * h)
  const mag = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      gx[p] = (g[p + 1]! - g[p - 1]!) / 2
      gy[p] = (g[p + w]! - g[p - w]!) / 2
      mag[p] = Math.hypot(gx[p]!, gy[p]!)
    }
  const prof = new Float32Array(2 * reach + 1)
  let seen = 0
  for (let y = 3; y < h - 3; y++)
    for (let x = 3; x < w - 3; x++) {
      const p = y * w + x
      const m = mag[p]!
      // A third of the candidates is plenty: picked by a hash, since every third in order would keep to the same edges of a regular picture.
      if (!(m > 1) || (Math.imul(seen++, 0x9e3779b1) >>> 0) % 3) continue
      const dx = gx[p]! / m
      const dy = gy[p]! / m
      if (sample(mag, w, h, x + dx, y + dy) > m || sample(mag, w, h, x - dx, y - dy) > m) continue
      for (let t = -reach; t <= reach; t++) prof[t + reach] = sample(g, w, h, x + dx * t, y + dy * t)
      let hi = reach
      while (hi < 2 * reach - 1 && prof[hi + 1]! - prof[hi]! > 0.04 * m) hi++
      let lo = reach
      while (lo > 0 && prof[lo]! - prof[lo - 1]! > 0.04 * m) lo--
      if (prof[hi]! - prof[lo]! >= EDGE_CONTRAST) each(x, y, m, prof, lo, hi)
    }
}

type BlurMap = {
  /** The typical blur, px: the median over every bold edge; 0 when there are none. */
  median: number
  /** The blur at any pixel. */
  at: (x: number, y: number) => number
}

/**
 * How soft the image's edges are, and where. A step of contrast C blurred by
 * a Gaussian of sigma s is steepest at C / (s√2π), so every bold edge gives
 * s = C / (slope √2π), C being the rise of its ramp. Pooled by block (medians:
 * thin lines read too sharp, soft shadows too blurred) and evened out into a
 * map. `lum` is 0–255, in the space the blur happened in.
 */
function measureBlur(lum: Float32Array, w: number, h: number): BlurMap {
  const found: number[] = []
  ramps(lum, w, h, EDGE_REACH, (x, y, slope, prof, lo, hi) => {
    const s = (prof[hi]! - prof[lo]!) / (slope * Math.sqrt(2 * Math.PI))
    // The ramps are read off a copy smoothed by 1 px, which widened them.
    found.push(x, y, Math.sqrt(Math.max(s * s - 1, 0.01)))
  })
  if (!found.length) return { median: 0, at: () => 0 }
  const all: number[] = []
  for (let i = 2; i < found.length; i += 3) all.push(found[i]!)
  all.sort((a, b) => a - b)
  const median = all[all.length >> 1]!
  const gw = Math.max(1, Math.floor((w - BLUR_BLOCK) / BLUR_STEP) + 1)
  const gh = Math.max(1, Math.floor((h - BLUR_BLOCK) / BLUR_STEP) + 1)
  const cells: number[][] = Array.from({ length: gw * gh }, () => [])
  for (let i = 0; i < found.length; i += 3) {
    // Blocks overlap by half: each edge is in up to four.
    const cx = (found[i]! - BLUR_BLOCK / 2) / BLUR_STEP
    const cy = (found[i + 1]! - BLUR_BLOCK / 2) / BLUR_STEP
    for (const by of [Math.floor(cy), Math.ceil(cy)])
      for (const bx of [Math.floor(cx), Math.ceil(cx)]) {
        const x = Math.min(gw - 1, Math.max(0, bx))
        const y = Math.min(gh - 1, Math.max(0, by))
        cells[y * gw + x]!.push(found[i + 2]!)
      }
  }
  const vals = new Float32Array(gw * gh)
  const wts = new Float32Array(gw * gh)
  cells.forEach((c, i) => {
    if (c.length < 8) return
    c.sort((a, b) => a - b)
    // A soft shadow's edge reads far blurrier than the picture is: cap it.
    vals[i] = Math.min(c[c.length >> 1]!, 3 * median)
    wts[i] = Math.min(c.length, 60)
  })
  if (!wts.some((v) => v > 0)) return { median, at: () => median }
  const field = gridField(vals, wts, gw, gh)
  return { median, at: (x, y) => field((x - BLUR_BLOCK / 2) / BLUR_STEP, (y - BLUR_BLOCK / 2) / BLUR_STEP) }
}

/** Contrast (of 255) an edge needs to say which kind of blur it had, and how far (px) either side it is followed. */
const STARK = 128
const STARK_REACH = 60
/** How much (of its rise) a ramp's ends may drift beyond it and still count as level. */
const LEVEL = 0.08
/** How lopsided (bright half longer, as a share of the whole) stark edges' ramps are when light was blurred. */
const LOPSIDED = 0.011

/**
 * Whether the blur happened to light (a lens out of focus) or to the stored
 * values (a resize, a filter, an upscale). Light blurs in linear units, where
 * white outweighs black many times over, so on screen a blurred black-white
 * edge has a long bright shoulder and a short dark toe; blurred as stored, it
 * is even. The lopsidedness of the starkest edges' ramps (how much further the
 * 84% point is from the middle than the 16% point) tells them apart.
 * `lum` is luma as stored, 0–255.
 */
function blurredAsLight(lum: Float32Array, w: number, h: number): boolean {
  const skew: number[] = []
  ramps(lum, w, h, STARK_REACH, (_x, _y, _slope, prof, lo, hi) => {
    const a = prof[lo]!
    const range = prof[hi]! - a
    if (range < STARK) return
    // Only a step between two wide areas: a thin line's ramp ends at its middle, rounded off, which reads as lopsided.
    const beyond = Math.max(3, hi - lo)
    if (lo - beyond < 0 || hi + beyond >= prof.length) return
    if (Math.abs(prof[lo - beyond]! - a) > LEVEL * range || Math.abs(prof[hi + beyond]! - prof[hi]!) > LEVEL * range) return
    const cross = (share: number) => {
      let i = lo + 1
      while (i < hi && (prof[i]! - a) / range < share) i++
      const q0 = (prof[i - 1]! - a) / range
      const q1 = (prof[i]! - a) / range
      return i - 1 + (q1 > q0 ? (share - q0) / (q1 - q0) : 0)
    }
    const x16 = cross(0.16)
    const x50 = cross(0.5)
    const x84 = cross(0.84)
    if (x84 - x16 > 0.5) skew.push((x84 - x50 - (x50 - x16)) / (x84 - x16))
  })
  if (skew.length < 20) return false
  skew.sort((a, b) => a - b)
  return skew[skew.length >> 1]! > LOPSIDED
}

/**
 * How soft the image's edges are, in px: the Gaussian blur a hard edge would
 * need to look like the image's bold edges (their median). 0 when it has no
 * bold edges. Crisp art reads under 1, anti-aliasing and all.
 */
export function edgeBlur(rgba: ArrayLike<number>, width: number, height: number): number {
  const lum = new Float32Array(width * height)
  for (let p = 0; p < lum.length; p++) lum[p] = 0.2126 * rgba[p * 4]! + 0.7152 * rgba[p * 4 + 1]! + 0.0722 * rgba[p * 4 + 2]!
  return measureBlur(lum, width, height).median
}

/* ------------------------------------------------------------------ the flat colours */

type Rgb3 = [number, number, number]

/** Colours closer than this (RGB distance) are one colour. */
const SAME_COLOUR = 36
/** A flat colour needs this share of the flat pixels. */
const MIN_SHARE = 0.0008
/** Past this distance from every blend of two flat colours, a pixel is a colour of its own (a thin line's). */
const NOT_A_BLEND = 26

/** Distance from `p` to the segment a–b. */
function offSegment(p0: number, p1: number, p2: number, a: Rgb3, b: Rgb3): number {
  const ab0 = b[0] - a[0]
  const ab1 = b[1] - a[1]
  const ab2 = b[2] - a[2]
  const t = Math.min(1, Math.max(0, ((p0 - a[0]) * ab0 + (p1 - a[1]) * ab1 + (p2 - a[2]) * ab2) / (ab0 * ab0 + ab1 * ab1 + ab2 * ab2 + 1e-9)))
  return Math.hypot(p0 - a[0] - t * ab0, p1 - a[1] - t * ab1, p2 - a[2] - t * ab2)
}

/** Which pixels sit in a flat area: every channel of the smoothed planes within FLAT levels across the 5 × 5 around them. */
function flatMask(sm: Float32Array[], w: number, h: number): Uint8Array {
  const flat = new Uint8Array(w * h)
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      let ok = true
      for (let c = 0; c < 3 && ok; c++) {
        let lo = 255
        let hi = 0
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const v = sm[c]![(y + dy) * w + x + dx]!
            if (v < lo) lo = v
            if (v > hi) hi = v
          }
        ok = hi - lo < FLAT
      }
      if (ok) flat[y * w + x] = 1
    }
  return flat
}
const FLAT = 14

/**
 * The colours the picture is made of, from a blurred copy of it (sRGB planes,
 * 0–255). First the colours of its flat areas, where blur changes nothing:
 * the commonest, each far enough from the ones before. Then up to three more
 * that no blend of two of those explains, the colours of lines too thin to
 * have a flat middle (an orange pinstripe on navy): the strongest tenth of
 * such pixels, since blur only ever dilutes a thin line's colour.
 */
function flatColours(s: Float32Array[], w: number, h: number): Rgb3[] {
  const n = w * h
  const sm = s.map((c) => blur(c, w, h, 1))
  const counts = new Map<number, [number, number, number, number]>()
  const mask = flatMask(sm, w, h)
  let flat = 0
  for (let p = 0; p < n; p++) {
    if (!mask[p]) continue
    flat++
    const key = ((sm[0]![p]! >> 3) << 10) | ((sm[1]![p]! >> 3) << 5) | (sm[2]![p]! >> 3)
    const e = counts.get(key)
    if (e) (e[0] += sm[0]![p]!), (e[1] += sm[1]![p]!), (e[2] += sm[2]![p]!), e[3]++
    else counts.set(key, [sm[0]![p]!, sm[1]![p]!, sm[2]![p]!, 1])
  }
  const palette: Rgb3[] = []
  for (const e of [...counts.values()].sort((a, b) => b[3] - a[3])) {
    if (e[3] < flat * MIN_SHARE) break
    const c: Rgb3 = [e[0] / e[3], e[1] / e[3], e[2] / e[3]]
    if (palette.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) > SAME_COLOUR)) palette.push(c)
    if (palette.length >= 12) break
  }
  if (palette.length < 2) return palette
  const soft = s.map((c) => blur(c, w, h, 0.7))
  const off = new Float32Array(n)
  for (let extra = 0; extra < 3; extra++) {
    const far: number[] = []
    for (let p = 0; p < n; p++) {
      let d = Infinity
      for (let i = 0; i < palette.length && d > NOT_A_BLEND; i++) for (let j = i + 1; j < palette.length && d > NOT_A_BLEND; j++) d = Math.min(d, offSegment(soft[0]![p]!, soft[1]![p]!, soft[2]![p]!, palette[i]!, palette[j]!))
      off[p] = d
      if (d > NOT_A_BLEND) far.push(p)
    }
    if (far.length < n * 0.0005) break
    // `off` stops counting once a pixel is explained, so measure the far ones in full.
    for (const p of far) {
      let d = Infinity
      for (let i = 0; i < palette.length; i++) for (let j = i + 1; j < palette.length; j++) d = Math.min(d, offSegment(soft[0]![p]!, soft[1]![p]!, soft[2]![p]!, palette[i]!, palette[j]!))
      off[p] = d
    }
    far.sort((a, b) => off[b]! - off[a]!)
    const top = far.slice(0, Math.max(20, Math.floor(far.length / 10)))
    const mean = (ps: number[]): Rgb3 => {
      const m: Rgb3 = [0, 0, 0]
      for (const p of ps) for (let c = 0; c < 3; c++) m[c]! += soft[c]![p]! / ps.length
      return m
    }
    const centre = mean(top)
    const near = top.filter((p) => Math.hypot(soft[0]![p]! - centre[0], soft[1]![p]! - centre[1], soft[2]![p]! - centre[2]) < 40)
    if (near.length < 10) break
    palette.push(mean(near))
  }
  return palette
}

/** Colours further apart than this are never one colour under uneven light. */
const SHADE_REACH = 60
/** Where two colours meet, a real edge is at least this steep, as a share of what their difference blurred would be. */
const SHADE_STEEP = 0.35
/** Smoothing (px) of the copy that steepness is measured on. */
const SHADE_SMOOTH = 2.5

/**
 * The palette without the colours that are only another colour under uneven
 * light: a photo's white paper darkens towards a corner, and reads as two
 * near-whites meeting along a line no edge runs along. Where two close
 * colours' pixels meet, a real edge between them, however blurred, is about
 * as steep as their difference spread over the blur; lighting is many times
 * gentler. A colour that meets a commoner one only that gently is folded into
 * it (`start` is relabelled in place), and the search then treats the
 * difference as lighting. Returns the colours kept.
 */
function dropShades(s: Float32Array[], w: number, h: number, sigma: Float32Array, palette: Rgb3[], start: Uint8Array): Rgb3[] {
  const K = palette.length
  const sm = s.map((c) => blur(c, w, h, 1))
  const flat = flatMask(sm, w, h)
  const wide = s.map((c) => blur(c, w, h, SHADE_SMOOTH))
  const steep = new Float64Array(K * K)
  const met = new Float64Array(K * K)
  const count = new Float64Array(K)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const a = start[p]!
      count[a]!++
      for (const q of [x + 1 < w ? p + 1 : -1, y + 1 < h ? p + w : -1]) {
        if (q < 0) continue
        const b = start[q]!
        // Only where both sides are flat: a ramp between two other colours passes through every colour between them.
        if (a === b || !flat[p] || !flat[q]) continue
        // The slope across the pair, over a 6 px run of a well-smoothed copy: grain alone is steeper than uneven light between neighbours.
        const step = q - p
        const far = step === 1 ? Math.min(3, x, w - 1 - x) : Math.min(3, y, h - 1 - y)
        if (!far) continue
        const slope = Math.hypot(wide[0]![p + far * step]! - wide[0]![p - far * step]!, wide[1]![p + far * step]! - wide[1]![p - far * step]!, wide[2]![p + far * step]! - wide[2]![p - far * step]!) / (2 * far)
        const i = Math.min(a, b) * K + Math.max(a, b)
        // As a share of the steepest a blurred step between the two could be here.
        steep[i]! += slope * Math.sqrt(sigma[p]! ** 2 + SHADE_SMOOTH ** 2) * Math.sqrt(2 * Math.PI)
        met[i]!++
      }
    }
  const into = Int32Array.from({ length: K }, (_, k) => k)
  const order = [...Array(K).keys()].sort((a, b) => count[a]! - count[b]!)
  for (const k of order) {
    let best = -1
    for (let j = 0; j < K; j++) {
      if (j === k || count[j]! <= count[k]! || into[j] !== j) continue
      const d = Math.hypot(palette[k]![0] - palette[j]![0], palette[k]![1] - palette[j]![1], palette[k]![2] - palette[j]![2])
      const i = Math.min(k, j) * K + Math.max(k, j)
      if (d > SHADE_REACH || met[i]! < 30 || steep[i]! / met[i]! / d >= SHADE_STEEP) continue
      if (best < 0 || count[j]! > count[best]!) best = j
    }
    if (best >= 0) into[k] = best
  }
  // A colour folded into one that was itself folded follows it all the way, unless that takes it too far:
  // a real colour beside a blend of itself and a third must not end up as the third.
  const home = (k: number) => {
    while (into[k] !== k) k = into[k]!
    return k
  }
  for (const k of order) {
    const j = home(k)
    if (j !== k && Math.hypot(palette[k]![0] - palette[j]![0], palette[k]![1] - palette[j]![1], palette[k]![2] - palette[j]![2]) > SHADE_REACH) into[k] = k
  }
  const kept: Rgb3[] = []
  const index = new Int32Array(K).fill(-1)
  for (let k = 0; k < K; k++) if (into[k] === k) (index[k] = kept.length), kept.push(palette[k]!)
  for (let p = 0; p < start.length; p++) start[p] = index[home(start[p]!)]!
  return kept
}

/* ------------------------------------------------------------------ the search */

/** Blur (work px) the search handles: more is treated as this. */
const MAX_WORK_BLUR = 5
/** Blur levels a kernel is kept for, each this much wider than the last. */
const LEVEL_RATIO = 1.08
/** How much boundary costs against misfit: higher is smoother and loses thin detail. */
const BOUNDARY_COST = 0.03
/** Scale (work px) the boundary's length is measured at… */
const BOUNDARY_SIGMA = 1.2
/** …growing with the blur there, by this much of it, up to BOUNDARY_SIGMA_MAX. */
const BOUNDARY_PER_BLUR = 0.5
const BOUNDARY_SIGMA_MAX = 3
/** Sweeps at most, and the share of pixels a sweep must still change to earn another. */
const SWEEPS = 24
const SETTLED = 2e-4
/** Sweeps between fresh looks at the slow lighting. */
const RESHADE = 3
/** Slow lighting (a vignette, uneven paper) is set aside, measured over this many work px. */
const SHADE_SIGMA = 20
/** A colour this near the line between two others (of 255), and not within this share of either end, is what they blend to. */
const BLEND_OFF = 26
const BLEND_ENDS = 0.2
/**
 * An area of a blend's colour is re-read as the two it blends only when no
 * deeper than this many blurs, and a pixel. A line fades to the blend's colour
 * while it is under about 2.3 blurs wide, and is first read at about twice
 * its width, so that deep.
 */
const BLEND_DEPTH = 2.3
/** Away from the two colours themselves, only a line is re-read, at least this many times longer than wide: a blob re-read is a speck. */
const BLEND_LONG = 8
/**
 * And only a line with this share of its rim on the one colour: a line through
 * a field of it. A strip between two colours can as well be the wider, duller
 * strip it was first read as, and the blur leaves nothing to tell the two by.
 */
const BLEND_WITHIN = 0.75
/** Rounds of re-reading, and the sweeps that tidy up after each. */
const BLEND_ROUNDS = 2
const BLEND_SWEEPS = 4
/** An area nowhere over two pixels wide goes where the misfit that costs is under this many times the boundary saved. */
const SLIVER_WORTH = 12

/**
 * The label map (one palette index per pixel of a w × h picture) that, with
 * each pixel blurred by its own `sigma`, best matches `obs` (three planes,
 * 0–1, in the units of `space`: those the blur happened in), at the least
 * boundary.
 *
 * Starts from each pixel's nearest colour and improves it pixel by pixel,
 * down the picture and back up: a pixel takes a neighbour's label at once
 * wherever that lowers
 *
 *     Σ weight² (blurred labels − photo)²  +  cost × boundary length,
 *
 * the misfit weighted by how visible it is (in light, the sRGB curve's slope:
 * a small error in a dark area shows more), the boundary measured by how
 * little each pixel's neighbourhood shares its label. A flip's effect on the
 * misfit is known from the misfit blurred back through the pixel's kernel,
 * and the misfit is kept up to date as flips are made. When that settles,
 * thin areas of a colour two others blend to are re-read as those two
 * (`unblend`), and slivers between areas are given to them (`dropSlivers`):
 * neither is reached by any run of single flips. A generator: it pauses
 * after every sweep.
 */
function* solve(obs: Float32Array[], w: number, h: number, sigma: Float32Array, palette: Rgb3[], start: Uint8Array, space: Space): Generator<undefined, Uint8Array> {
  // Kernels for each blur level.
  let top = 0.5
  for (let p = 0; p < sigma.length; p++) top = Math.max(top, Math.min(MAX_WORK_BLUR, sigma[p]!))
  const levels: { r: number; k: Float32Array; self: number }[] = []
  for (let s = 0.5; ; s *= LEVEL_RATIO) {
    const r = Math.max(1, Math.ceil(2.5 * s))
    const k = new Float32Array((2 * r + 1) ** 2)
    let sum = 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) sum += k[(dy + r) * (2 * r + 1) + dx + r] = Math.exp(-(dx * dx + dy * dy) / (2 * s * s))
    let self = 0
    for (let i = 0; i < k.length; i++) {
      k[i]! /= sum
      self += k[i]! ** 2
    }
    levels.push({ r, k, self })
    if (s >= top) break
  }
  // Padding: the widest kernel and one more (the summed table below looks a pixel past it), and no less than the boundary's smallest neighbourhood.
  const P = Math.max(levels[levels.length - 1]!.r + 1, Math.ceil(2.5 * BOUNDARY_SIGMA))
  const W = w + 2 * P
  const H = h + 2 * P
  const N = W * H
  const inner = (x: number, y: number) => Math.min(h - 1, Math.max(0, y - P)) * w + Math.min(w - 1, Math.max(0, x - P))
  // Everything padded by the widest kernel, edges repeated, so no loop below checks bounds.
  const level = new Uint8Array(N)
  const lab = new Uint8Array(N)
  const target = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]
  const weight2 = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]
  const smoothObs = obs.map((c) => blur(c, w, h, 2))
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x
      const q = inner(x, y)
      level[p] = Math.min(levels.length - 1, Math.max(0, Math.round(Math.log(Math.max(0.5, Math.min(MAX_WORK_BLUR, sigma[q]!)) / 0.5) / Math.log(LEVEL_RATIO))))
      lab[p] = start[q]!
      const interior = x >= P && y >= P && x < W - P && y < H - P
      for (let c = 0; c < 3; c++) {
        target[c]![p] = obs[c]![q]!
        // The padding is never fitted.
        weight2[c]![p] = interior ? space.shows(Math.max(smoothObs[c]![q]!, 1e-4)) ** 2 : 0
      }
    }
  const C = palette.map((c) => [space.to(c[0]), space.to(c[1]), space.to(c[2])])
  // The model: labels' colours, blurred.
  const model = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]
  const near = new Int32Array((W + 1) * (H + 1))
  const rebuild = () => {
    // Where a pixel's whole window is one label, its blur is that colour: count label changes with a summed table.
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x
        const edge = (x + 1 < W && lab[p + 1] !== lab[p]) || (y + 1 < H && lab[p + W] !== lab[p]) ? 1 : 0
        near[(y + 1) * (W + 1) + x + 1] = edge + near[y * (W + 1) + x + 1]! + near[(y + 1) * (W + 1) + x]! - near[y * (W + 1) + x]!
      }
    for (let y = P; y < H - P; y++)
      for (let x = P; x < W - P; x++) {
        const p = y * W + x
        const { r, k } = levels[level[p]!]!
        const x0 = x - r - 1
        const y0 = y - r - 1
        const changes = near[(y + r + 1) * (W + 1) + x + r + 1]! - near[y0 * (W + 1) + x + r + 1]! - near[(y + r + 1) * (W + 1) + x0]! + near[y0 * (W + 1) + x0]!
        if (!changes) {
          const c = C[lab[p]!]!
          model[0]![p] = c[0]!
          model[1]![p] = c[1]!
          model[2]![p] = c[2]!
          continue
        }
        let m0 = 0
        let m1 = 0
        let m2 = 0
        let i = 0
        for (let dy = -r; dy <= r; dy++) {
          let q = p + dy * W - r
          for (let dx = -r; dx <= r; dx++, q++, i++) {
            const c = C[lab[q]!]!
            const kv = k[i]!
            m0 += kv * c[0]!
            m1 += kv * c[1]!
            m2 += kv * c[2]!
          }
        }
        model[0]![p] = m0
        model[1]![p] = m1
        model[2]![p] = m2
      }
  }
  rebuild()
  // Slow lighting, set aside: the misfit's low frequencies, taken out of what is fitted.
  const shade = [new Float32Array(N), new Float32Array(N), new Float32Array(N)]
  const q4w = Math.ceil(w / 4)
  const q4h = Math.ceil(h / 4)
  const reshade = () => {
    for (let c = 0; c < 3; c++) {
      // Smoothed as it shows (weighted by the sRGB slope), or a bright area's misfit would swamp the dark area beside it.
      const small = new Float32Array(q4w * q4h)
      const cnt = new Float32Array(q4w * q4h)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = (y + P) * W + x + P
          const i = (y >> 2) * q4w + (x >> 2)
          small[i]! += Math.sqrt(weight2[c]![p]!) * (target[c]![p]! + shade[c]![p]! - model[c]![p]!)
          cnt[i]!++
        }
      for (let i = 0; i < small.length; i++) small[i]! /= cnt[i]!
      const low = blur(small, q4w, q4h, SHADE_SIGMA / 4)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = (y + P) * W + x + P
          const s = sample(low, q4w, q4h, (x - 1.5) / 4, (y - 1.5) / 4) / Math.sqrt(weight2[c]![p]!)
          target[c]![p] = target[c]![p]! + shade[c]![p]! - s
          shade[c]![p] = s
        }
    }
  }
  // Boundary: how much of a pixel's neighbourhood shares each label. The neighbourhood grows with the blur:
  // a wiggle much finer than the blur is noise, since the photo can't show it.
  const scales: { r: number; k: Float32Array; k0: number }[] = []
  for (let rho = BOUNDARY_SIGMA; ; rho *= 1.25) {
    const r = Math.ceil(2.5 * rho)
    const k = new Float32Array((2 * r + 1) ** 2)
    let sum = 0
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) sum += k[(dy + r) * (2 * r + 1) + dx + r] = Math.exp(-(dx * dx + dy * dy) / (2 * rho * rho))
    for (let i = 0; i < k.length; i++) k[i]! /= sum
    scales.push({ r, k, k0: k[r * (2 * r + 1) + r]! })
    if (rho * 1.25 > BOUNDARY_SIGMA_MAX || r >= P) break
  }
  const scaleOf = new Uint8Array(N)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const rho = BOUNDARY_PER_BLUR * Math.min(MAX_WORK_BLUR, sigma[inner(x, y)]!)
      scaleOf[y * W + x] = Math.min(scales.length - 1, Math.max(0, Math.round(Math.log(Math.max(rho, BOUNDARY_SIGMA) / BOUNDARY_SIGMA) / Math.log(1.25))))
    }
  // What flipping p from a to b adds to the boundary's length.
  const longer = (p: number, a: number, b: number): number => {
    const { r, k, k0 } = scales[scaleOf[p]!]!
    let d = 0
    let i = 0
    for (let dy = -r; dy <= r; dy++) {
      let q = p + dy * W - r
      for (let dx = -r; dx <= r; dx++, q++, i++) {
        const l = lab[q]!
        if (l === a) d += k[i]!
        else if (l === b) d -= k[i]!
      }
    }
    return 2 * (d - k0)
  }
  // The weighted misfit, kept up to date: three values a pixel.
  const owed = new Float32Array(3 * N)
  const settle = () => {
    for (let p = 0; p < N; p++) for (let c = 0; c < 3; c++) owed[3 * p + c] = weight2[c]![p]! * (model[c]![p]! - target[c]![p]!)
  }
  // A pixel's change of colour, spread into the model.
  const spread = (p: number, d0: number, d1: number, d2: number) => {
    const r = levels[Math.min(levels.length - 1, level[p]! + 2)]!.r
    for (let dy = -r; dy <= r; dy++) {
      let q = p + dy * W - r
      for (let dx = -r; dx <= r; dx++, q++) {
        // Each pixel is blurred by its own kernel.
        const lv = levels[level[q]!]!
        const rr = lv.r
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue
        const kv = lv.k[(dy + rr) * (2 * rr + 1) + dx + rr]!
        model[0]![q]! += kv * d0
        model[1]![q]! += kv * d1
        model[2]![q]! += kv * d2
        owed[3 * q]! += weight2[0]![q]! * kv * d0
        owed[3 * q + 1]! += weight2[1]![q]! * kv * d1
        owed[3 * q + 2]! += weight2[2]![q]! * kv * d2
      }
    }
  }
  // The padding repeats the picture's outermost pixels: their labels as they are now, the model kept up as `spread` does.
  const repad = () => {
    const R = levels[levels.length - 1]!.r
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (x >= P && y >= P && x < W - P && y < H - P) {
          x = W - P - 1
          continue
        }
        const p = y * W + x
        const a = lab[p]!
        const l = lab[Math.min(H - P - 1, Math.max(P, y)) * W + Math.min(W - P - 1, Math.max(P, x))]!
        if (a === l) continue
        lab[p] = l
        const d0 = C[l]![0]! - C[a]![0]!
        const d1 = C[l]![1]! - C[a]![1]!
        const d2 = C[l]![2]! - C[a]![2]!
        // Only the picture's own pixels are fitted: those whose kernels reach this one.
        for (let qy = Math.max(P, y - R); qy <= Math.min(H - P - 1, y + R); qy++)
          for (let qx = Math.max(P, x - R); qx <= Math.min(W - P - 1, x + R); qx++) {
            const q = qy * W + qx
            const lv = levels[level[q]!]!
            const rr = lv.r
            const dx = x - qx
            const dy = y - qy
            if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue
            const kv = lv.k[(dy + rr) * (2 * rr + 1) + dx + rr]!
            model[0]![q]! += kv * d0
            model[1]![q]! += kv * d1
            model[2]![q]! += kv * d2
            owed[3 * q]! += weight2[0]![q]! * kv * d0
            owed[3 * q + 1]! += weight2[1]![q]! * kv * d1
            owed[3 * q + 2]! += weight2[2]![q]! * kv * d2
          }
      }
  }
  const steps = [1, -1, W, -W]
  const inside = w * h
  let sweep = 0
  // One sweep; returns how many pixels it flipped.
  const pass = (): number => {
    if (sweep % RESHADE === 0) {
      repad()
      reshade()
      settle()
    }
    let flips = 0
    // Down the picture and back up by turns, so no direction is favoured.
    for (let i = 0; i < inside; i++) {
      const j = sweep & 1 ? inside - 1 - i : i
      const p = (P + Math.floor(j / w)) * W + P + (j % w)
      const a = lab[p]!
      let best = 0
      let bestL = -1
      let tried = -1
      let g0 = 0
      let g1 = 0
      let g2 = 0
      for (let s = 0; s < 4; s++) {
        const b = lab[p + steps[s]!]!
        if (b === a || b === tried || b === bestL) continue
        const lv = levels[level[p]!]!
        if (tried < 0 && bestL < 0) {
          // The misfit blurred back to here: what a flip would change, per unit of colour. Through this pixel's own
          // kernel, where its neighbours' differ by a level or two at most.
          const { r, k } = lv
          let i = 0
          for (let dy = -r; dy <= r; dy++) {
            let q = 3 * (p + dy * W - r)
            for (let dx = -r; dx <= r; dx++, q += 3, i++) {
              const kv = k[i]!
              g0 += kv * owed[q]!
              g1 += kv * owed[q + 1]!
              g2 += kv * owed[q + 2]!
            }
          }
        }
        tried = b
        const ca = C[a]!
        const cb = C[b]!
        const d0 = cb[0]! - ca[0]!
        const d1 = cb[1]! - ca[1]!
        const d2 = cb[2]! - ca[2]!
        const dE = 2 * (d0 * g0 + d1 * g1 + d2 * g2) + lv.self * (d0 * d0 * weight2[0]![p]! + d1 * d1 * weight2[1]![p]! + d2 * d2 * weight2[2]![p]!) + BOUNDARY_COST * longer(p, a, b)
        if (dE < best) (best = dE), (bestL = b)
      }
      if (bestL < 0) continue
      lab[p] = bestL
      spread(p, C[bestL]![0]! - C[a]![0]!, C[bestL]![1]! - C[a]![1]!, C[bestL]![2]! - C[a]![2]!)
      flips++
    }
    return flips
  }
  // Sweeps, with a pause after each, until one changes next to nothing.
  function* search(sweeps: number): Generator<undefined, void> {
    for (const end = sweep + sweeps; sweep < end; sweep++) {
      const flips = pass()
      yield
      if (flips < SETTLED * inside) break
    }
  }
  yield* search(SWEEPS)

  // Which colours two others blend to: where along the way from the first to the second, by colour.
  const blends: { c: number; b: number; t: number; off: number }[][] = C.map((ca, a) => {
    const found: { c: number; b: number; t: number; off: number }[] = []
    for (let c = 0; c < C.length; c++)
      for (let b = c + 1; b < C.length; b++) {
        if (c === a || b === a) continue
        const cc = C[c]!
        const ab = [C[b]![0]! - cc[0]!, C[b]![1]! - cc[1]!, C[b]![2]! - cc[2]!]
        const t = ((ca[0]! - cc[0]!) * ab[0]! + (ca[1]! - cc[1]!) * ab[1]! + (ca[2]! - cc[2]!) * ab[2]!) / (ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2 + 1e-12)
        const off = 255 * Math.hypot(ca[0]! - cc[0]! - t * ab[0]!, ca[1]! - cc[1]! - t * ab[1]!, ca[2]! - cc[2]! - t * ab[2]!)
        if (t >= BLEND_ENDS && t <= 1 - BLEND_ENDS && off <= BLEND_OFF) found.push({ c, b, t, off })
      }
    return found.sort((x, y) => x.off - y.off)
  })
  // One pixel relabelled, the model kept up; returns what that added to the total, exactly.
  let flipBoundary = 0
  const flip = (p: number, to: number): number => {
    const a = lab[p]!
    const d0 = C[to]![0]! - C[a]![0]!
    const d1 = C[to]![1]! - C[a]![1]!
    const d2 = C[to]![2]! - C[a]![2]!
    flipBoundary = BOUNDARY_COST * longer(p, a, to)
    let dE = flipBoundary
    const r = levels[Math.min(levels.length - 1, level[p]! + 2)]!.r
    for (let dy = -r; dy <= r; dy++) {
      let q = p + dy * W - r
      for (let dx = -r; dx <= r; dx++, q++) {
        const lv = levels[level[q]!]!
        const rr = lv.r
        if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue
        const kv = lv.k[(dy + rr) * (2 * rr + 1) + dx + rr]!
        dE += kv * (2 * (owed[3 * q]! * d0 + owed[3 * q + 1]! * d1 + owed[3 * q + 2]! * d2) + kv * (weight2[0]![q]! * d0 * d0 + weight2[1]![q]! * d1 * d1 + weight2[2]![q]! * d2 * d2))
      }
    }
    lab[p] = to
    spread(p, d0, d1, d2)
    return dE
  }
  /**
   * Thin areas of a blend's colour, re-read as the two colours it blends: the
   * share of the area nearest the one takes it, the rest the other, so the
   * area keeps its weight. Single flips never get there, since each alone
   * changes that weight. Two cases, one move: the last sliver of halo between
   * two colours goes, and a line thinner than the blur (which fades to the
   * blend's colour, and is first read as a wider line of it) gets its own
   * colour and width back. Kept only where the total drops.
   */
  const unblend = (): boolean => {
    if (!blends.some((b) => b.length)) return false
    // How deep each pixel is in its area: steps to the nearest other label.
    const depth = new Uint16Array(N).fill(65535)
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const p = y * W + x
        const a = lab[p]
        if (lab[p - 1] !== a || lab[p + 1] !== a || lab[p - W] !== a || lab[p + W] !== a) depth[p] = 1
      }
    for (let p = W + 1; p < N - W - 1; p++) depth[p] = Math.min(depth[p]!, depth[p - 1]! + 1, depth[p - W]! + 1)
    for (let p = N - W - 2; p > W; p--) depth[p] = Math.min(depth[p]!, depth[p + 1]! + 1, depth[p + W]! + 1)
    const done = new Uint8Array(N)
    const beside = new Float64Array(C.length)
    const along = new Float32Array(N)
    let changed = false
    let undone = false
    for (let y0 = P; y0 < H - P; y0++)
      for (let x0 = P; x0 < W - P; x0++) {
        const first = y0 * W + x0
        const a = lab[first]!
        if (done[first] || !blends[a]!.length) continue
        // The area, its depth, and the labels beside it.
        const area = [first]
        done[first] = 1
        beside.fill(0)
        let deepest = 0
        let blurSum = 0
        let rim = 0
        for (let i = 0; i < area.length; i++) {
          const p = area[i]!
          if (depth[p]! > deepest) deepest = depth[p]!
          if (depth[p] === 1) rim++
          const x = p % W
          const yy = (p - x) / W
          blurSum += Math.min(MAX_WORK_BLUR, sigma[inner(x, yy)]!)
          for (const s of steps) {
            const q = p + s
            const qx = q % W
            const qy = (q - qx) / W
            if (qx < P || qy < P || qx >= W - P || qy >= H - P) continue
            if (lab[q] !== a) beside[lab[q]!]!++
            else if (!done[q]) (done[q] = 1), area.push(q)
          }
        }
        if (deepest > BLEND_DEPTH * (blurSum / area.length) + 1) continue
        // A band's rim is twice its length and its area length times width: so this is length over width.
        const line = rim * rim >= 4 * BLEND_LONG * area.length
        let around = 0
        for (let l = 0; l < C.length; l++) around += beside[l]!
        const field = BLEND_WITHIN * around
        for (const { c, b, t } of blends[a]!.filter((x) => (beside[x.c]! && beside[x.b]!) || (line && Math.max(beside[x.c]!, beside[x.b]!) > field)).slice(0, 2)) {
          // Each pixel's place along the way from c to b, in the photo.
          const ab = [C[b]![0]! - C[c]![0]!, C[b]![1]! - C[c]![1]!, C[b]![2]! - C[c]![2]!]
          for (const p of area) along[p] = target[0]![p]! * ab[0]! + target[1]![p]! * ab[1]! + target[2]![p]! * ab[2]!
          const order = area.slice().sort((p, q) => along[q]! - along[p]!)
          const take = Math.round(t * order.length)
          let dE = 0
          for (let i = 0; i < order.length; i++) dE += flip(order[i]!, i < take ? b : c)
          if (dE < 0) {
            changed = true
            break
          }
          for (const p of order) flip(p, a)
          undone = true
        }
      }
    // Flips put back leave rounding behind: start the books afresh.
    if (undone) {
      rebuild()
      settle()
    }
    return changed
  }
  for (let round = 0; round < BLEND_ROUNDS && unblend(); round++) yield* search(BLEND_SWEEPS)

  // A set of flips, kept only if the misfit they cost is under `worth` times the boundary they save.
  const tryFlips = (ps: number[], to: (p: number) => number, worth: number): boolean => {
    const was = ps.map((p) => lab[p]!)
    let misfit = 0
    let boundary = 0
    for (const p of ps) {
      const dE = flip(p, to(p))
      boundary += flipBoundary
      misfit += dE - flipBoundary
    }
    if (misfit + worth * boundary < 0) return true
    for (let i = ps.length - 1; i >= 0; i--) flip(ps[i]!, was[i]!)
    return false
  }
  /**
   * Slivers taken out: an area nowhere more than two pixels wide, given to
   * the areas beside it, where the photo barely notices. They are left where
   * three colours' ramps cross (a thin dark rim between orange trim and white
   * paper leaves specks of paper colour between the two), and read as gaps.
   */
  const dropSlivers = (): boolean => {
    const done = new Uint8Array(N)
    let changed = false
    const rim = (p: number) => {
      const a = lab[p]
      return lab[p - 1] !== a || lab[p + 1] !== a || lab[p - W] !== a || lab[p + W] !== a
    }
    for (let y0 = P; y0 < H - P; y0++)
      for (let x0 = P; x0 < W - P; x0++) {
        const first = y0 * W + x0
        if (done[first]) continue
        const a = lab[first]!
        const area = [first]
        done[first] = 1
        let thin = true
        for (let i = 0; i < area.length; i++) {
          const p = area[i]!
          if (thin && !rim(p)) thin = false
          for (const s of steps) {
            const q = p + s
            const qx = q % W
            const qy = (q - qx) / W
            if (qx < P || qy < P || qx >= W - P || qy >= H - P || done[q] || lab[q] !== a) continue
            done[q] = 1
            area.push(q)
          }
        }
        if (!thin) continue
        // Each pixel to the label beside it that most of its neighbours have.
        const into = new Map<number, number>()
        for (const p of area) {
          let best = -1
          let most = 0
          for (const s of steps) {
            const l = lab[p + s]!
            if (l === a) continue
            let n = 0
            for (const t of steps) if (lab[p + t] === l) n++
            if (n > most) (most = n), (best = l)
          }
          into.set(p, best)
        }
        // With one colour all round, it is a thin line through that colour, not a gap between two shapes.
        if (new Set(into.values()).size < 2) continue
        if (tryFlips(area, (p) => into.get(p)!, SLIVER_WORTH)) changed = true
      }
    return changed
  }
  // Slivers are given to labels beside them: not to one only the padding still has.
  repad()
  if (dropSlivers()) yield* search(BLEND_SWEEPS)

  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = lab[(y + P) * W + x + P]!
  return out
}

/* ------------------------------------------------------------------ putting it together */

/** Work pixels at most: larger pictures are solved at a coarser scale. */
const MAX_WORK_PIXELS = 420_000
/** The picture is shrunk until its sharper quarter is no more blurred than this, in work px: a wider blur costs its square in time and gains nothing. */
const MAX_SHARP_BLUR = 2.2

/**
 * A copy of `rgba` (`width` × `height`, RGBA) with its blur taken out: flat
 * colours with clean, anti-aliased edges where the image had soft ramps.
 * `blur` is how soft its edges are (`edgeBlur`, measured when left out);
 * below `SOFT_EDGES` the image is only copied. `scale` is how many times the
 * image was enlarged before this: enlarging softens edges by as much, so the
 * threshold grows with it. Alpha is kept as it is.
 */
export function deblur(rgba: ArrayLike<number>, width: number, height: number, blurPx?: number, scale = 1): Uint8ClampedArray {
  const steps = deblurSteps(rgba, width, height, blurPx, scale)
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
  }
}

/** `deblur` as steps: it pauses between its stages and after each sweep of the search (a tenth of a second or so apart on a megapixel image), so an async caller can stop it or let other work in. */
export function* deblurSteps(rgba: ArrayLike<number>, width: number, height: number, blurPx?: number, scale = 1): Generator<undefined, Uint8ClampedArray> {
  const out = Uint8ClampedArray.from(rgba)
  const n = width * height
  if (width < 16 || height < 16) return out
  // Under transparency a canvas keeps black: give those pixels their opaque neighbours' colour instead, or it would blur in.
  const src = fillTransparent(out, width, height)
  let ch: Float32Array[] = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let p = 0; p < n; p++) {
    ch[0]![p] = src[p * 4]!
    ch[1]![p] = src[p * 4 + 1]!
    ch[2]![p] = src[p * 4 + 2]!
  }
  const lumOf = (space: Space) => {
    const lum = new Float32Array(n)
    for (let p = 0; p < n; p++) lum[p] = 255 * (0.2126 * space.to(ch[0]![p]!) + 0.7152 * space.to(ch[1]![p]!) + 0.0722 * space.to(ch[2]![p]!))
    return lum
  }
  let stored = lumOf(STORED)
  let map = measureBlur(stored, width, height)
  if (!(map.median > 0) || (blurPx ?? map.median) < SOFT_EDGES * Math.max(1, scale)) return out
  yield
  const aligned = alignChannels(ch, width, height, map.median)
  if (aligned) {
    ch = aligned
    stored = lumOf(STORED)
  }
  const space = blurredAsLight(stored, width, height) ? LIGHT : STORED
  if (aligned || space === LIGHT) map = measureBlur(space === LIGHT ? lumOf(LIGHT) : stored, width, height)
  if (!(map.median > 0)) return out
  yield
  // The scale to work at, from the blur of the picture's sharper quarter.
  const blurs: number[] = []
  for (let y = 4; y < height; y += 8) for (let x = 4; x < width; x += 8) blurs.push(map.at(x, y))
  blurs.sort((a, b) => a - b)
  let F = Math.min(4, Math.max(1, Math.floor(blurs[blurs.length >> 2]! / MAX_SHARP_BLUR)))
  while (Math.ceil(width / F) * Math.ceil(height / F) > MAX_WORK_PIXELS) F++
  const w = Math.ceil(width / F)
  const h = Math.ceil(height / F)
  const obs = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)]
  const sigma = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let cnt = 0
      let a0 = 0
      let a1 = 0
      let a2 = 0
      for (let yy = y * F; yy < Math.min(height, (y + 1) * F); yy++)
        for (let xx = x * F; xx < Math.min(width, (x + 1) * F); xx++) {
          const p = yy * width + xx
          a0 += space.to(ch[0]![p]!)
          a1 += space.to(ch[1]![p]!)
          a2 += space.to(ch[2]![p]!)
          cnt++
        }
      const i = y * w + x
      obs[0]![i] = a0 / cnt
      obs[1]![i] = a1 / cnt
      obs[2]![i] = a2 / cnt
      sigma[i] = Math.max(0.3, map.at((x + 0.5) * F, (y + 0.5) * F) / F)
    }
  const seen = obs.map((c) => Float32Array.from(c, (v) => 255 * space.back(v)))
  const palette = flatColours(seen, w, h)
  if (palette.length < 2) return out
  const start = new Uint8Array(w * h)
  for (let p = 0; p < w * h; p++) {
    let best = 0
    let bestD = Infinity
    for (let k = 0; k < palette.length; k++) {
      const d = (seen[0]![p]! - palette[k]![0]) ** 2 + (seen[1]![p]! - palette[k]![1]) ** 2 + (seen[2]![p]! - palette[k]![2]) ** 2
      if (d < bestD) (bestD = d), (best = k)
    }
    start[p] = best
  }
  const kept = dropShades(seen, w, h, sigma, palette, start)
  if (kept.length < 2) return out
  yield
  const labels = yield* solve(obs, w, h, sigma, kept, start, space)
  const edges = boundaries(labels, w, h, sigma)
  yield
  redraw(labels, w, h, kept, F, edges, out, width, height)
  return out
}

/** A boundary's points are smoothed by as much as moves each no further than this share of the blur there (work px)… */
const SMOOTH_PER_BLUR = 0.6
/** …nor than this share of the width of the thinner area beside it, which must not be pinched… */
const SMOOTH_PER_WIDTH = 0.4
/** …but any point may move this far (work px), or the steps of a slant would stay. */
const SMOOTH_MIN = 0.75
/** …and none by an amount that pulls the path there, wobble aside, by more than this (work px): a bend is pulled inwards, and what is put back for it swings wide beside a sharp turn. */
const SMOOTH_PULL = 0.5
/** Areas this deep (work px) or deeper are not thin. */
const THIN_REACH = 5
/** The amounts of smoothing tried (px along the boundary), and how fast the amount may change from point to point (steps of that list). */
const SMOOTH_LEVELS = [1.5, 3, 6, 12, 24]
const SMOOTH_EASE = 0.25

/** A boundary has a corner where it turns by this much (radians) between the stretches of this many points before and after. */
const CORNER_TURN = 0.6
const CORNER_SPAN = 5
/** The stretches either side of a corner are straight: their points lie this near a line (work px, root mean square). */
const CORNER_STRAIGHT = 0.5
/** Where those lines meet is the corner, if no further from the turn than the blur there and this (work px). */
const CORNER_REACH = 0.75

type Boundary = {
  /** The boundary as the label map has it: corner points of its pixels, a step apart. */
  xs: number[]
  ys: number[]
  /** The same points, smoothed. */
  nx: Float32Array
  ny: Float32Array
  /** The two labels it parts. */
  a: number
  b: number
  /** Cut from a longer boundary at a corner: its ends stay put even where they meet. */
  cut?: boolean
  /** The part the same boundary goes on in, round the corner at this one's end. */
  next?: Boundary
  /** Its straight runs. */
  runs?: Run[]
}

/**
 * Every boundary of the label map (w × h), smoothed. The search leaves each
 * one wobbling by a pixel or two: a photo of print has a texture of its own,
 * which ripples every edge, and a map of square pixels steps along every
 * slant. Under a blur the photo says little about where exactly an edge runs,
 * so each boundary between two areas, from one meeting of three to the next,
 * is smoothed along its length: every point by as much as moves it no further
 * than a share of the blur there, and less beside a thin area, which must not
 * be pinched. A straight edge comes out straight and an arc smooth.
 *
 * A boundary is first cut at its corners, each side to be smoothed on its
 * own, and a corner is put where its two sides, run on, would meet: the
 * search rounds corners off. So a returned boundary's smoothed ends need not
 * be its stepped ones, and one closed boundary may come back in parts.
 *
 * Last, a stretch that a line fits as closely as its points may move is
 * drawn as that line (`straightRuns`), and two such lines meet where they
 * cross: smoothing leaves a slow wobble in, and a line has none.
 */
function boundaries(lab: Uint8Array, w: number, h: number, sigma: Float32Array): Boundary[] {
  const at = (x: number, y: number) => lab[y * w + x]!
  // Cracks between pixels with different labels: across (under pixel row y - 1) and down (left of pixel column x).
  const across = (x: number, y: number) => x >= 0 && x < w && y >= 1 && y < h && at(x, y - 1) !== at(x, y)
  const down = (x: number, y: number) => x >= 1 && x < w && y >= 0 && y < h && at(x - 1, y) !== at(x, y)
  const seenAcross = new Uint8Array(w * (h + 1))
  const seenDown = new Uint8Array((w + 1) * h)
  // From a corner point, the cracks leaving it: right, down, left, up.
  const leaves = (x: number, y: number, d: number) => (d === 0 ? across(x, y) : d === 1 ? down(x, y) : d === 2 ? across(x - 1, y) : down(x, y - 1))
  const degree = (x: number, y: number) => (leaves(x, y, 0) ? 1 : 0) + (leaves(x, y, 1) ? 1 : 0) + (leaves(x, y, 2) ? 1 : 0) + (leaves(x, y, 3) ? 1 : 0)
  const DX = [1, 0, -1, 0]
  const DY = [0, 1, 0, -1]
  const mark = (x: number, y: number, d: number): boolean => {
    const seen = d === 0 || d === 2 ? seenAcross : seenDown
    const i = d === 0 ? y * w + x : d === 2 ? y * w + x - 1 : d === 1 ? y * (w + 1) + x : (y - 1) * (w + 1) + x
    if (seen[i]) return false
    seen[i] = 1
    return true
  }
  // How deep each pixel is in its area: steps to the nearest other label (the picture's edge is none).
  const depth = new Uint16Array(w * h).fill(65535)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const l = lab[p]
      if ((x > 0 && lab[p - 1] !== l) || (x + 1 < w && lab[p + 1] !== l) || (y > 0 && lab[p - w] !== l) || (y + 1 < h && lab[p + w] !== l)) depth[p] = 1
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (x > 0) depth[p] = Math.min(depth[p]!, depth[p - 1]! + 1)
      if (y > 0) depth[p] = Math.min(depth[p]!, depth[p - w]! + 1)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x
      if (x + 1 < w) depth[p] = Math.min(depth[p]!, depth[p + 1]! + 1)
      if (y + 1 < h) depth[p] = Math.min(depth[p]!, depth[p + w]! + 1)
    }
  // Half the width of the area a pixel is in, about: the deepest of its label nearby.
  const half = (x: number, y: number) => {
    const cx = Math.min(w - 1, Math.max(0, x))
    const cy = Math.min(h - 1, Math.max(0, y))
    const l = at(cx, cy)
    let most = 1
    for (let yy = Math.max(0, cy - THIN_REACH); yy <= Math.min(h - 1, cy + THIN_REACH); yy++)
      for (let xx = Math.max(0, cx - THIN_REACH); xx <= Math.min(w - 1, cx + THIN_REACH); xx++) if (lab[yy * w + xx] === l && depth[yy * w + xx]! > most) most = depth[yy * w + xx]!
    return Math.min(most, THIN_REACH)
  }
  const found: Boundary[] = []
  // One boundary, walked from a corner point along a crack until three areas meet, the picture ends, or it closes.
  const walk = (x: number, y: number, d: number) => {
    if (!mark(x, y, d)) return
    // The two labels it parts, from its first crack.
    const [a, b] = d === 0 ? [at(x, y - 1), at(x, y)] : d === 2 ? [at(x - 1, y - 1), at(x - 1, y)] : d === 1 ? [at(x - 1, y), at(x, y)] : [at(x - 1, y - 1), at(x, y - 1)]
    const xs = [x]
    const ys = [y]
    const x0 = x
    const y0 = y
    for (;;) {
      x += DX[d]!
      y += DY[d]!
      xs.push(x)
      ys.push(y)
      if ((x === x0 && y === y0) || degree(x, y) !== 2) break
      let next = -1
      for (let e = 0; e < 4; e++) if (e !== (d + 2) % 4 && leaves(x, y, e)) next = e
      if (next < 0 || !mark(x, y, next)) break
      d = next
    }
    found.push({ xs, ys, nx: Float32Array.from(xs), ny: Float32Array.from(ys), a: a!, b: b! })
  }
  // Open boundaries first, from where they end; then the closed ones, from anywhere on them.
  for (let pass = 0; pass < 2; pass++)
    for (let y = 0; y <= h; y++)
      for (let x = 0; x <= w; x++) {
        const deg = degree(x, y)
        if (!deg || (pass === 0 && deg === 2)) continue
        for (let d = 0; d < 4; d++) if (leaves(x, y, d)) walk(x, y, d)
      }
  // Each boundary is cut at its corners, so that either side is smoothed on its own and the corner stays a corner.
  const parts: Boundary[] = []
  const step = gauss1(1.5)
  const sr = (step.length - 1) >> 1
  const D = CORNER_SPAN
  for (const e of found) {
    const n = e.xs.length - 1
    const closed = e.xs[0] === e.xs[n] && e.ys[0] === e.ys[n]
    if (n < 4 * D) {
      parts.push(e)
      continue
    }
    const pick = (v: ArrayLike<number>, k: number) => (closed ? v[((k % n) + n) % n]! : v[Math.min(n, Math.max(0, k))]!)
    // The pixels' steps taken off, then how far the path turns at each point, between the stretches before and after it.
    const px = new Float32Array(n + 1)
    const py = new Float32Array(n + 1)
    for (let k = 0; k <= n; k++)
      for (let t = -sr; t <= sr; t++) {
        px[k]! += step[t + sr]! * pick(e.xs, k + t)
        py[k]! += step[t + sr]! * pick(e.ys, k + t)
      }
    const turn = new Float32Array(n + 1)
    for (let k = closed ? 0 : D; k <= (closed ? n - 1 : n - D); k++) {
      const ux = px[k]! - pick(px, k - D)
      const uy = py[k]! - pick(py, k - D)
      const vx = pick(px, k + D) - px[k]!
      const vy = pick(py, k + D) - py[k]!
      turn[k] = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
    }
    if (closed) turn[n] = turn[0]!
    // A corner: a sharp turn, sharper than any near it, with little turn a stretch away on either side (an arc turns as much all along).
    // The line through the points from `from` to `to`: a point on it, its direction, and how far off it they lie.
    const line = (from: number, to: number) => {
      let mx = 0
      let my = 0
      const c = to - from + 1
      for (let j = from; j <= to; j++) (mx += pick(e.xs, j)), (my += pick(e.ys, j))
      mx /= c
      my /= c
      let xx = 0
      let xy = 0
      let yy = 0
      for (let j = from; j <= to; j++) {
        const dx = pick(e.xs, j) - mx
        const dy = pick(e.ys, j) - my
        xx += dx * dx
        xy += dx * dy
        yy += dy * dy
      }
      const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
      const dx = Math.cos(angle)
      const dy = Math.sin(angle)
      return { mx, my, dx, dy, off: Math.sqrt(Math.max(0, xx * dy * dy - 2 * xy * dx * dy + yy * dx * dx) / c) }
    }
    // The longest straight stretch on one side of point k, a little away from it: the search rounds a corner off.
    const side = (k: number, dir: number) => {
      for (let far = 3 * D; far >= 2 * D; far -= D) {
        const from = dir < 0 ? k - far : k + D
        const to = dir < 0 ? k - D : k + far
        if (!closed && (from < 0 || to > n)) continue
        const l = line(from, to)
        if (l.off <= CORNER_STRAIGHT) return l
      }
      return null
    }
    const corners: number[] = []
    const tips: [number, number][] = []
    for (let k = closed ? 0 : D; k <= (closed ? n - 1 : n - D); k++) {
      const t = turn[k]!
      if (t < CORNER_TURN || 2 * Math.max(pick(turn, k - 2 * D), pick(turn, k + 2 * D)) > t) continue
      let most = true
      for (let j = 1; j <= D && most; j++) if (pick(turn, k - j) >= t || pick(turn, k + j) > t) most = false
      if (!most) continue
      // The corner itself is where its two sides, run on, would meet: counted only if that is near where the path turns.
      const p = side(k, -1)
      const q = side(k, 1)
      if (!p || !q) continue
      const cross = p.dx * q.dy - p.dy * q.dx
      if (Math.abs(cross) < 0.2) continue
      const along = ((q.mx - p.mx) * q.dy - (q.my - p.my) * q.dx) / cross
      const tx = p.mx + along * p.dx
      const ty = p.my + along * p.dy
      const blurred = Math.min(MAX_WORK_BLUR, sigma[Math.min(h - 1, e.ys[k]!) * w + Math.min(w - 1, e.xs[k]!)]!)
      if (Math.hypot(tx - e.xs[k]!, ty - e.ys[k]!) > CORNER_REACH + blurred) continue
      corners.push(k)
      tips.push([tx, ty])
    }
    if (!corners.length) {
      parts.push(e)
      continue
    }
    // A closed boundary is opened at its first corner.
    const xs = closed ? [...e.xs.slice(corners[0]!, n), ...e.xs.slice(0, corners[0]! + 1)] : e.xs
    const ys = closed ? [...e.ys.slice(corners[0]!, n), ...e.ys.slice(0, corners[0]! + 1)] : e.ys
    const cuts = closed ? [...corners.map((c) => c - corners[0]!), n] : [0, ...corners, n]
    // Where each cut's end goes: a corner's to where its sides meet, the boundary's own ends nowhere.
    const ends: ([number, number] | null)[] = closed ? [...tips, tips[0]!] : [null, ...tips, null]
    const made: Boundary[] = []
    for (let i = 0; i + 1 < cuts.length; i++) {
      const x = xs.slice(cuts[i]!, cuts[i + 1]! + 1)
      const y = ys.slice(cuts[i]!, cuts[i + 1]! + 1)
      const nx = Float32Array.from(x)
      const ny = Float32Array.from(y)
      const first = ends[i]
      const last = ends[i + 1]
      if (first) (nx[0] = first[0]), (ny[0] = first[1])
      if (last) (nx[x.length - 1] = last[0]), (ny[x.length - 1] = last[1])
      made.push({ xs: x, ys: y, nx, ny, a: e.a, b: e.b, cut: true })
    }
    for (let i = 0; i < made.length; i++) if (ends[i + 1]) made[i]!.next = made[(i + 1) % made.length]
    parts.push(...made)
  }
  for (const part of parts) {
    const { xs, ys, nx, ny, cut } = part
    const n = xs.length - 1
    const closed = !cut && xs[0] === xs[n] && ys[0] === ys[n]
    // The boundary's points, read past its ends: round again if it closes, else mirrored through the end (as often as it takes), which stays put.
    const past = (v: ArrayLike<number>, k: number) => {
      if (closed) return v[((k % n) + n) % n]!
      let base = 0
      let sign = 1
      while (k < 0 || k > n) {
        base += sign * 2 * (k < 0 ? v[0]! : v[n]!)
        k = k < 0 ? -k : 2 * n - k
        sign = -sign
      }
      return base + sign * v[k]!
    }
    // What is smoothed: the path as the label map has it, but for a corner moved to where its sides meet.
    const ix = Float32Array.from(nx)
    const iy = Float32Array.from(ny)
    // How far each point may move: a share of the blur there, and less beside a thin area.
    const eps = new Float32Array(n + 1)
    for (let k = 0; k <= n; k++) {
      const x = xs[k]!
      const y = ys[k]!
      const s = Math.min(MAX_WORK_BLUR, sigma[Math.min(h - 1, y) * w + Math.min(w - 1, x)]!)
      // The four pixels round the point cover both sides of the boundary.
      const thin = Math.min(half(x - 1, y - 1), half(x, y - 1), half(x - 1, y), half(x, y))
      eps[k] = Math.max(SMOOTH_MIN, Math.min(SMOOTH_PER_BLUR * s, SMOOTH_PER_WIDTH * (2 * thin - 1)))
    }
    // Smoothed by more and more; each point keeps the most smoothing that moves it no further than that.
    const level = new Float32Array(n + 1)
    const sx: Float32Array[] = []
    const sy: Float32Array[] = []
    const open = new Uint8Array(n + 1).fill(1)
    for (let li = 0; li < SMOOTH_LEVELS.length; li++) {
      const along = SMOOTH_LEVELS[li]!
      if (along > n / 2) break
      const k1 = gauss1(along)
      const r = (k1.length - 1) >> 1
      const smooth = (v: ArrayLike<number>) => {
        const o = new Float32Array(n + 1)
        for (let k = 0; k <= n; k++) {
          let a = 0
          for (let t = -r; t <= r; t++) a += k1[t + r]! * past(v, k + t)
          o[k] = a
        }
        return o
      }
      // Smoothing pulls a curve inwards, so what one pass took off is smoothed and put back: twice the pass, less the pass twice over.
      const ox = smooth(ix)
      const oy = smooth(iy)
      const ox2 = smooth(ox)
      const oy2 = smooth(oy)
      for (let k = 0; k <= n; k++) {
        // How far the pass pulled the path here, wobble aside: little on a gentle bend, a lot near a sharp turn.
        const pull = Math.hypot(ox[k]! - ox2[k]!, oy[k]! - oy2[k]!)
        const ax = (ox[k] = 2 * ox[k]! - ox2[k]!)
        const ay = (oy[k] = 2 * oy[k]! - oy2[k]!)
        if (!open[k]) continue
        if (li > 0 && pull > SMOOTH_PULL) {
          open[k] = 0
          continue
        }
        // The first amount always: it only takes the pixels' steps off. The rest are measured from there.
        if (li === 0 || Math.hypot(ax - sx[0]![k]!, ay - sy[0]![k]!) <= eps[k]!) level[k] = li + 1
        else open[k] = 0
      }
      sx.push(ox)
      sy.push(oy)
    }
    if (!sx.length) continue
    // The amount changes gently along the boundary: a point by a corner holds its neighbours back.
    for (let round = 0; round < (closed ? 2 : 1); round++) {
      for (let k = 1; k <= n; k++) level[k] = Math.min(level[k]!, level[k - 1]! + SMOOTH_EASE)
      for (let k = n - 1; k >= 0; k--) level[k] = Math.min(level[k]!, level[k + 1]! + SMOOTH_EASE)
      // A closed boundary's first point is its last.
      if (closed) level[0] = level[n] = Math.min(level[0]!, level[n]!)
    }
    for (let k = 0; k <= n; k++) {
      const lv = level[k]!
      if (lv <= 0) continue
      const lo = Math.floor(lv)
      const f = lv - lo
      const x0 = lo ? sx[lo - 1]![k]! : ix[k]!
      const y0 = lo ? sy[lo - 1]![k]! : iy[k]!
      const x1 = lo < sx.length ? sx[lo]![k]! : x0
      const y1 = lo < sy.length ? sy[lo]![k]! : y0
      nx[k] = x0 + f * (x1 - x0)
      ny[k] = y0 + f * (y1 - y0)
    }
    part.runs = straightRuns(sx[0]!, sy[0]!, eps)
  }
  // A corner with a straight run either side goes where the two lines cross: they are better placed than it was.
  for (const part of parts) {
    const p = part.runs?.at(-1)
    const q = part.next?.runs?.[0]
    if (!p || !q || p.to !== part.xs.length - 1 || q.from !== 0) continue
    const v = crossing(p, q)
    if (!v || Math.hypot(v[0] - part.nx[p.to]!, v[1] - part.ny[p.to]!) > LINE_MEET) continue
    p.last = q.first = v
  }
  for (const part of parts) if (part.runs) drawRuns(part.runs, part.nx, part.ny)
  return parts
}

/** A straight run of a boundary is at least this many points long… */
const LINE_MIN = 16
/** …and bows off its line by no more than this (work px) from end to end: a wobble about a line is a line, a gentle arc is not. */
const LINE_BOW = 0.25
/** Two runs that meet at less than this angle (radians) are a bend drawn as chords: the shorter is no line, nor the longer unless twice its length. At more, they meet in a corner. */
const LINE_KINK = 0.3
/** …or at any angle, if either bows this far (work px) the way they turn. */
const LINE_ARC = 0.12
/** Two runs are neighbours when no more than this many points lie between them: a bend the search rounded off. */
const LINE_GAP = 12
/** Either side of a corner, the runs' lines may put it this far (work px) from where it was first put. */
const LINE_MEET = 1.5
/** Points over which a run's loose end eases back into the smoothed path. */
const LINE_EASE = 6

/** A straight run, from point `from` to point `to`: a point on its line, the line's direction (the way the boundary runs), how far its points bow off the line (to the left, at its ends), and where its ends meet another run's line. */
type Run = { from: number; to: number; mx: number; my: number; ux: number; uy: number; bow: number; first?: [number, number]; last?: [number, number] }

/**
 * The straight runs of one boundary. Smoothing takes out a wobble shorter
 * than it reaches; a slow one, a pixel or two over a hundred, it leaves, and
 * under a heavy blur the search draws a straight side lumpy. But where a line
 * lies as near the boundary's points (`dx`, `dy`: the path with only its
 * pixel steps off) as each may move (`eps`), a line is the simplest thing the
 * photo allows. The longest such run is taken first, then the longest either
 * side of it. Each run's line is the best through its own points, which
 * places it better than either of its ends is placed.
 */
function straightRuns(dx: Float32Array, dy: Float32Array, eps: Float32Array): Run[] {
  const n = dx.length - 1
  if (n < LINE_MIN) return []
  // A line as a run of the points from..to, if every one is near enough to it and (`bow`) they do not bow off it as an arc would.
  const within = (r: Run, bow: boolean): Run | null => {
    let s2 = 0
    let s4 = 0
    let d0 = 0
    let d2 = 0
    let lo = Infinity
    let hi = -Infinity
    for (let k = r.from; k <= r.to; k++) {
      const px = dx[k]! - r.mx
      const py = dy[k]! - r.my
      const d = py * r.ux - px * r.uy
      if (Math.abs(d) > eps[k]!) return null
      const t = px * r.ux + py * r.uy
      s2 += t * t
      s4 += t * t * t * t
      d0 += d
      d2 += d * t * t
      if (t < lo) lo = t
      if (t > hi) hi = t
    }
    if (!bow) return r
    // The bow: the best parabola through the offsets, at the run's ends.
    const c = r.to - r.from + 1
    const spread = s4 - (s2 * s2) / c
    if (!(spread > 0) || hi - lo < 0.6 * LINE_MIN) return null
    r.bow = ((d2 - (d0 * s2) / c) / spread) * ((hi - lo) / 2) ** 2
    return Math.abs(r.bow) <= LINE_BOW ? r : null
  }
  const fit = (from: number, to: number): Run | null => {
    const c = to - from + 1
    let mx = 0
    let my = 0
    for (let k = from; k <= to; k++) (mx += dx[k]!), (my += dy[k]!)
    mx /= c
    my /= c
    let xx = 0
    let xy = 0
    let yy = 0
    for (let k = from; k <= to; k++) {
      const px = dx[k]! - mx
      const py = dy[k]! - my
      xx += px * px
      xy += px * py
      yy += py * py
    }
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy)
    // Pointing the way the boundary runs.
    const way = Math.cos(angle) * (dx[to]! - dx[from]!) + Math.sin(angle) * (dy[to]! - dy[from]!) < 0 ? -1 : 1
    return within({ from, to, mx, my, ux: way * Math.cos(angle), uy: way * Math.sin(angle), bow: 0 }, true)
  }
  // The longest run starting at `from` and ending by `end`.
  const reach = (from: number, end: number): Run | null => {
    let to = from + LINE_MIN
    if (to > end) return null
    let best = fit(from, to)
    if (!best) return null
    for (let step = 32; step >= 1; step >>= 1)
      while (to + step <= end) {
        const r = fit(from, to + step)
        if (!r) break
        best = r
        to += step
      }
    return best
  }
  const runs: Run[] = []
  const search = (lo: number, hi: number) => {
    let best: Run | null = null
    for (let from = lo; from + LINE_MIN <= hi; ) {
      const r = reach(from, hi)
      if (r && (!best || r.to - r.from > best.to - best.from)) best = r
      if (r && r.to === hi) break
      from += r ? Math.max(2, (r.to - r.from) >> 3) : 2
    }
    if (!best) return
    search(lo, best.from)
    runs.push(best)
    search(best.to, hi)
  }
  search(0, n)
  // A bend drawn as chords is not lines.
  const out = new Set<Run>()
  for (let i = 0; i + 1 < runs.length; i++) {
    const p = runs[i]!
    const q = runs[i + 1]!
    if (q.from - p.to > LINE_GAP) continue
    // The turn from one to the next, and how far each bows the same way: the chords of an arc bow with its turn, a polygon's sides do not.
    const turn = p.ux * q.uy - p.uy * q.ux
    const bows = Math.max(p.bow, q.bow) * Math.sign(turn)
    if (Math.abs(turn) >= Math.sin(LINE_KINK) && bows < LINE_ARC) continue
    const lp = p.to - p.from
    const lq = q.to - q.from
    if (lp < 2 * lq) out.add(p)
    if (lq < 2 * lp) out.add(q)
  }
  const kept = runs.filter((r) => !out.has(r))
  // Two runs at an angle, a rounded bend apart at most: both are run on to the point of the bend nearest where their lines meet, and meet there.
  for (let i = 0; i + 1 < kept.length; i++) {
    const p = kept[i]!
    const q = kept[i + 1]!
    if (q.from - p.to > LINE_GAP) continue
    const v = crossing(p, q)
    if (!v) continue
    let m = -1
    let near = Infinity
    for (let k = p.to; k <= q.from; k++) {
      const d = Math.hypot(v[0] - dx[k]!, v[1] - dy[k]!)
      if (d < near) (near = d), (m = k)
    }
    if (near > eps[m]!) continue
    p.to = q.from = m
    p.last = q.first = v
  }
  return kept
}

/** Where two runs' lines cross, if they are at an angle. */
function crossing(p: Run, q: Run): [number, number] | null {
  const cross = p.ux * q.uy - p.uy * q.ux
  if (Math.abs(cross) < Math.sin(LINE_KINK)) return null
  const along = ((q.mx - p.mx) * q.uy - (q.my - p.my) * q.ux) / cross
  return [p.mx + along * p.ux, p.my + along * p.uy]
}

/** A boundary's smoothed points (`nx`, `ny`) moved onto its straight runs. An end that meets nothing eases back into the smoothed path. */
function drawRuns(runs: Run[], nx: Float32Array, ny: Float32Array) {
  for (const r of runs) {
    for (let k = r.from; k <= r.to; k++) {
      const t = (nx[k]! - r.mx) * r.ux + (ny[k]! - r.my) * r.uy
      let wgt = 1
      if (!r.first && k - r.from < LINE_EASE) wgt = Math.min(wgt, (k - r.from) / LINE_EASE)
      if (!r.last && r.to - k < LINE_EASE) wgt = Math.min(wgt, (r.to - k) / LINE_EASE)
      wgt = wgt * wgt * (3 - 2 * wgt)
      nx[k] = nx[k]! + wgt * (r.mx + t * r.ux - nx[k]!)
      ny[k] = ny[k]! + wgt * (r.my + t * r.uy - ny[k]!)
    }
    if (r.first) (nx[r.from] = r.first[0]), (ny[r.from] = r.first[1])
    if (r.last) (nx[r.to] = r.last[0]), (ny[r.to] = r.last[1])
  }
}

/**
 * The label map drawn at full size into `out` (alpha untouched), along its
 * smoothed boundaries. Drawn first as it is, each of its pixels a block, at
 * twice the output's size; then, for each boundary, the points between its
 * stepped path and its smoothed one change sides. Each output pixel averages
 * its four points, so edges come out anti-aliased like crisp art's.
 */
function redraw(lab: Uint8Array, w: number, h: number, palette: Rgb3[], F: number, edges: Boundary[], out: Uint8ClampedArray, width: number, height: number) {
  const S = 2 * F
  const W = 2 * width
  const H = 2 * height
  const big = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const row = Math.min(h - 1, Math.floor(y / S)) * w
    for (let x = 0; x < W; x++) big[y * W + x] = lab[row + Math.min(w - 1, Math.floor(x / S))]!
  }
  // A point that has changed sides once is marked, and stays.
  const MOVED = 128
  const rows = new Map<number, number[]>()
  const cut = (x1: number, y1: number, x2: number, y2: number) => {
    if (y1 === y2) return
    const lo = Math.max(0, Math.ceil(Math.min(y1, y2) - 0.5))
    const hi = Math.min(H, Math.ceil(Math.max(y1, y2) - 0.5))
    for (let y = lo; y < hi; y++) {
      const x = x1 + ((y + 0.5 - y1) * (x2 - x1)) / (y2 - y1)
      const r = rows.get(y)
      if (r) r.push(x)
      else rows.set(y, [x])
    }
  }
  for (const { xs, ys, nx, ny, a, b } of edges) {
    // Where the stepped path and the smoothed one cross each row of points: between them, in pairs, lies what changes sides.
    rows.clear()
    for (let k = 0; k + 1 < xs.length; k++) {
      cut(xs[k]! * S, ys[k]! * S, xs[k + 1]! * S, ys[k + 1]! * S)
      cut(nx[k]! * S, ny[k]! * S, nx[k + 1]! * S, ny[k + 1]! * S)
    }
    // An end moved to its corner: the two paths are joined there.
    const n = xs.length - 1
    cut(xs[0]! * S, ys[0]! * S, nx[0]! * S, ny[0]! * S)
    cut(xs[n]! * S, ys[n]! * S, nx[n]! * S, ny[n]! * S)
    for (const [y, cuts] of rows) {
      cuts.sort((p, q) => p - q)
      for (let c = 0; c + 1 < cuts.length; c += 2)
        for (let x = Math.max(0, Math.ceil(cuts[c]! - 0.5)); x + 0.5 < cuts[c + 1]! && x < W; x++) {
          const l = big[y * W + x]!
          if (l === a) big[y * W + x] = b | MOVED
          else if (l === b) big[y * W + x] = a | MOVED
        }
    }
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = 2 * y * W + 2 * x
      const c0 = palette[big[p]! & 127]!
      const c1 = palette[big[p + 1]! & 127]!
      const c2 = palette[big[p + W]! & 127]!
      const c3 = palette[big[p + W + 1]! & 127]!
      const o = (y * width + x) * 4
      out[o] = (c0[0] + c1[0] + c2[0] + c3[0]) / 4
      out[o + 1] = (c0[1] + c1[1] + c2[1] + c3[1]) / 4
      out[o + 2] = (c0[2] + c1[2] + c2[2] + c3[2]) / 4
    }
}

/**
 * A copy of the image with each transparent pixel given the colour of the
 * opaque pixels nearest it, ring by ring (alpha unchanged), so no blur or
 * look across a cut-out edge sees the black a canvas keeps under alpha 0.
 */
function fillTransparent(rgba: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h
  let clear = 0
  for (let p = 0; p < n; p++) if (rgba[p * 4 + 3]! < 128) clear++
  if (!clear || clear === n) return rgba
  const src = Uint8ClampedArray.from(rgba)
  const known = new Uint8Array(n)
  for (let p = 0; p < n; p++) known[p] = src[p * 4 + 3]! >= 128 ? 1 : 0
  let ring: number[] = []
  for (let p = 0; p < n; p++) if (known[p]) ring.push(p)
  while (ring.length) {
    const next: number[] = []
    for (const p of ring) {
      const x = p % w
      const y = (p - x) / w
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const q = yy * w + xx
        if (known[q]) continue
        known[q] = 1
        src[q * 4] = src[p * 4]!
        src[q * 4 + 1] = src[p * 4 + 1]!
        src[q * 4 + 2] = src[p * 4 + 2]!
        next.push(q)
      }
    }
    ring = next
  }
  return src
}
