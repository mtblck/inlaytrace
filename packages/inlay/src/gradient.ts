/**
 * Gradient fills for softly shaded regions.
 *
 * A palette splits a smooth shade into bands of flat tints, each traced as
 * its own shape. Here the bands are found again and put back together: two
 * neighbouring regions whose boundary is soft (the image barely changes
 * across it, though their colours differ) are one shaded region, and if a
 * linear or radial gradient explains its colours much better than one flat
 * colour, and no worse than the bands did, it becomes one shape with that
 * gradient.
 *
 * The fits are closed-form least squares in sRGB, which is what SVG
 * interpolates in:
 *  - linear: each channel as a plane in x and y; the planes' dominant
 *    direction is the gradient's axis.
 *  - radial: the colour's main component as a + bx + cy + d(x² + y²), whose
 *    vertex is the centre, refined as a + k·r by Gauss–Newton.
 * Along the axis (or the radius), each channel is then piecewise linear
 * between a few evenly spaced stops, as few as fit.
 */
import { hexToRgb, toHex, type Rgb } from './palette'

export type GradientStop = { offset: number; color: string }
/** Coordinates in the trace's pixels (gradientUnits="userSpaceOnUse"). */
export type Gradient =
  | { type: 'linear'; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: GradientStop[] }

/** A boundary is soft when the image changes by less than this share of its two colours' difference across it. */
const SOFT = 0.4
/** …or by less than this (RGB levels), however alike the colours: JPEG noise alone moves a pixel about this much. */
const SOFT_NOISE = 10
/** Pixels either side of a crack whose step is measured: three pixels apart, so anti-aliasing counts as a hard edge. */
const SPAN = 1
/** A soft boundary needs at least this many cracks, so a few pixels touching don't join two regions. */
const SOFT_MIN = 6
/** Smallest shaded region (pixels) worth a gradient. */
const MIN_AREA = 64
/** One flat colour must be at least this far off (RMS, RGB levels) for a gradient to be worth it. */
const FLAT_MIN = 6
/** The gradient must at least halve the flat colour's error… */
const GAIN = 0.5
/** …and come within this of the bands' own error. */
const BANDS_SLACK = 1.1
/**
 * …and stay this close to the image (RMS, RGB levels). Soft shading fits to
 * within noise; a fit this far off is smearing distinct shapes together (a
 * face and the hair beside it on a painted poster, whose palette is far off
 * both, so the bands' error is no guide).
 */
const MAX_RMS = 20
/** A band with at least this many sampled pixels must be drawn no worse by the gradient than by its own colour. */
const BAND_MIN = 16
/** A radial fit replaces the linear one only when this much closer. */
const RADIAL_GAIN = 0.8
/** Pixels a shade is fitted on, at most. */
const SAMPLE = 4000
/** Weight of the tie between neighbouring stops: next to nothing beside a pixel's weight of 1. */
const TIE = 1e-3
/** Most stops along a gradient. */
const MAX_STOPS = 5

export type Shading = { comps: number[]; gradient: Gradient; mean: string }

/**
 * Groups of regions that are one soft shade, each with the gradient that
 * draws it. `comp` is each pixel's region (negative: none), `colorOf` each
 * region's flat colour.
 */
export function shadings(rgba: ArrayLike<number>, w: number, h: number, comp: Int32Array, regions: number, colorOf: (id: number) => Rgb): Shading[] {
  // Soft boundaries: per pair of regions, the image's step across their cracks against their colours' difference.
  const step = new Map<number, number>()
  const count = new Map<number, number>()
  const rgb = (i: number): Rgb => [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]
  const d3 = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const colors = Array.from({ length: regions }, (_, id) => colorOf(id))
  const crack = (a: number, b: number, before: number, after: number) => {
    const ca = comp[a]
    const cb = comp[b]
    if (ca < 0 || cb < 0 || ca === cb) return
    const key = Math.min(ca, cb) * regions + Math.max(ca, cb)
    const p = before * 4
    const q = after * 4
    step.set(key, (step.get(key) ?? 0) + Math.hypot(rgba[p] - rgba[q], rgba[p + 1] - rgba[q + 1], rgba[p + 2] - rgba[q + 2]))
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (x + 1 < w) crack(i, i + 1, y * w + Math.max(0, x - SPAN), y * w + Math.min(w - 1, x + 1 + SPAN))
      if (y + 1 < h) crack(i, i + w, Math.max(0, y - SPAN) * w + x, Math.min(h - 1, y + 1 + SPAN) * w + x)
    }
  const parent = Array.from({ length: regions }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (const [key, n] of count) {
    const a = Math.floor(key / regions)
    const b = key % regions
    if (n < SOFT_MIN || step.get(key)! >= n * Math.max(SOFT * d3(colors[a], colors[b]), SOFT_NOISE)) continue
    parent[find(a)] = find(b)
  }
  const groups = new Map<number, number[]>()
  for (let id = 0; id < regions; id++) {
    const r = find(id)
    const g = groups.get(r)
    if (g) g.push(id)
    else groups.set(r, [id])
  }

  // Each group's inner pixels, in one pass: its rim is anti-aliased against its neighbours.
  const root = new Int32Array(regions)
  for (let id = 0; id < regions; id++) root[id] = groups.get(find(id))!.length > 1 ? find(id) : -1
  const inner = new Map<number, number[]>()
  const rootAt = (i: number) => (comp[i] >= 0 ? root[comp[i]] : -1)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const r = rootAt(i)
      if (r < 0 || rootAt(i - 1) !== r || rootAt(i + 1) !== r || rootAt(i - w) !== r || rootAt(i + w) !== r) continue
      const list = inner.get(r)
      if (list) list.push(i)
      else inner.set(r, [i])
    }
  const out: Shading[] = []
  for (const [r, all] of inner) {
    if (all.length < MIN_AREA) continue
    // A large shade is fitted on an even sample of its pixels.
    const stride = Math.max(1, Math.floor(all.length / SAMPLE))
    const xs: number[] = []
    const ys: number[] = []
    const cs: Rgb[] = []
    const bands: Rgb[] = []
    const ids: number[] = []
    for (let k = 0; k < all.length; k += stride) {
      const i = all[k]
      xs.push((i % w) + 0.5)
      ys.push(Math.floor(i / w) + 0.5)
      cs.push(rgb(i))
      bands.push(colors[comp[i]])
      ids.push(comp[i])
    }
    const g = fitShading(xs, ys, cs)
    if (!g) continue
    const n = cs.length
    const mean = [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / n) as Rgb
    const rms = (f: (j: number) => Rgb) => Math.sqrt(cs.reduce((s, c, j) => s + d3(c, f(j)) ** 2, 0) / n)
    const flat = rms(() => mean)
    const banded = rms((j) => bands[j])
    if (flat < FLAT_MIN || g.rms > MAX_RMS || g.rms > GAIN * flat || g.rms > BANDS_SLACK * banded) continue
    if (worseOnABand(g.gradient, xs, ys, cs, bands, ids)) continue
    out.push({ comps: [...groups.get(r)!], gradient: g.gradient, mean: '' })
  }

  // A neighbour the gradient draws at least as well as its own flat colour
  // joins it: a band whose edge with the shade was too short or too noisy to
  // read as soft, or a speck of a lighter tint on the shade's anti-aliased rim.
  // A flat neighbour (its own colour within FLAT_MIN) only if a speck: a flat
  // shape in a shade's colours is still a shape.
  const shadeOf = new Int32Array(regions).fill(-1)
  out.forEach((s, k) => s.comps.forEach((id) => (shadeOf[id] = k)))
  const near = new Map<number, Set<number>>()
  for (const key of count.keys()) {
    const a = Math.floor(key / regions)
    const b = key % regions
    for (const [x, y] of [
      [a, b],
      [b, a],
    ])
      if (shadeOf[x] >= 0 && shadeOf[y] < 0) {
        const set = near.get(y)
        if (set) set.add(shadeOf[x])
        else near.set(y, new Set([shadeOf[x]]))
      }
  }
  if (near.size) {
    const ramps = out.map((s) => ramp(s.gradient))
    const flatErr = new Float64Array(regions)
    const area = new Float64Array(regions)
    const gradErr = new Map<number, Float64Array>()
    for (const id of near.keys()) gradErr.set(id, new Float64Array(out.length))
    for (let i = 0; i < w * h; i++) {
      const id = comp[i]
      const errs = id >= 0 ? gradErr.get(id) : undefined
      if (!errs) continue
      const c = rgb(i)
      area[id]++
      flatErr[id] += dist2(c, colors[id])
      for (const k of near.get(id)!) errs[k] += dist2(c, ramps[k]((i % w) + 0.5, Math.floor(i / w) + 0.5))
    }
    for (const [id, ks] of near) {
      const errs = gradErr.get(id)!
      const k = [...ks].reduce((a, b) => (errs[b] < errs[a] ? b : a))
      const flat = flatErr[id] < FLAT_MIN ** 2 * area[id]
      if (errs[k] <= flatErr[id] && (!flat || area[id] < MIN_AREA)) {
        out[k].comps.push(id)
        shadeOf[id] = k
      }
    }
  }
  // Each shade's flat colour, for whatever can't draw a gradient: the average of all its pixels.
  const sums = out.map(() => [0, 0, 0, 0])
  for (let i = 0; i < w * h; i++) {
    const k = comp[i] >= 0 ? shadeOf[comp[i]] : -1
    if (k < 0) continue
    const s = sums[k]
    s[0] += rgba[i * 4]
    s[1] += rgba[i * 4 + 1]
    s[2] += rgba[i * 4 + 2]
    s[3]++
  }
  out.forEach((s, k) => (s.mean = toHex([sums[k][0] / sums[k][3], sums[k][1] / sums[k][3], sums[k][2] / sums[k][3]])))
  return out
}

/** A gradient's colour at a point. */
export const colorAt = (g: Gradient, x: number, y: number): Rgb => ramp(g)(x, y)

/** A gradient as a function of the point, its stops parsed once. */
/**
 * Whether the gradient draws any one band of the shade worse than the band's
 * own flat colour did: a gradient that suits the whole on average can still
 * paint one member (a shirt's fold shadow, a strand of hair) the wrong colour.
 */
function worseOnABand(g: Gradient, xs: number[], ys: number[], cs: Rgb[], bands: Rgb[], ids: number[]): boolean {
  const at = ramp(g)
  const err = new Map<number, [number, number, number]>()
  cs.forEach((c, j) => {
    const e = err.get(ids[j]) ?? [0, 0, 0]
    e[0] += dist2(c, at(xs[j], ys[j]))
    e[1] += dist2(c, bands[j])
    e[2]++
    err.set(ids[j], e)
  })
  for (const [grad, band, n] of err.values()) if (n >= BAND_MIN && grad > BANDS_SLACK ** 2 * band) return true
  return false
}

function ramp(g: Gradient): (x: number, y: number) => Rgb {
  const offsets = g.stops.map((s) => s.offset)
  const colors = g.stops.map((s) => hexToRgb(s.color))
  const last = colors.length - 1
  const dx = g.type === 'linear' ? g.x2 - g.x1 : 0
  const dy = g.type === 'linear' ? g.y2 - g.y1 : 0
  const len2 = dx * dx + dy * dy || 1
  return (x, y) => {
    const t = g.type === 'linear' ? ((x - g.x1) * dx + (y - g.y1) * dy) / len2 : Math.hypot(x - g.cx, y - g.cy) / g.r
    if (t <= offsets[0]) return colors[0]
    for (let k = 1; k <= last; k++)
      if (t <= offsets[k]) {
        const a = colors[k - 1]
        const b = colors[k]
        const f = (t - offsets[k - 1]) / (offsets[k] - offsets[k - 1] || 1)
        return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]
      }
    return colors[last]
  }
}

/** The better of a linear and a radial gradient through these pixels, with its RMS error. */
export function fitShading(xs: number[], ys: number[], cs: Rgb[]): { gradient: Gradient; rms: number } | null {
  const lin = fitLinear(xs, ys, cs)
  const rad = fitRadial(xs, ys, cs)
  if (rad && (!lin || rad.rms < RADIAL_GAIN * lin.rms)) return rad
  return lin
}

function fitLinear(xs: number[], ys: number[], cs: Rgb[]) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  // Planes through the mean: each channel's slope in x and y.
  let sxx = 0
  let sxy = 0
  let syy = 0
  const sx = [0, 0, 0]
  const sy = [0, 0, 0]
  const cm = [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / n)
  for (let j = 0; j < n; j++) {
    const dx = xs[j] - mx
    const dy = ys[j] - my
    sxx += dx * dx
    sxy += dx * dy
    syy += dy * dy
    for (let k = 0; k < 3; k++) {
      sx[k] += dx * (cs[j][k] - cm[k])
      sy[k] += dy * (cs[j][k] - cm[k])
    }
  }
  const det = sxx * syy - sxy * sxy
  if (!(det > 0)) return null
  const gx = sx.map((_, k) => (syy * sx[k] - sxy * sy[k]) / det)
  const gy = sx.map((_, k) => (sxx * sy[k] - sxy * sx[k]) / det)
  // The direction the colour changes most along: the top eigenvector of G Gᵀ.
  const a = gx.reduce((s, v) => s + v * v, 0)
  const b = gx.reduce((s, v, k) => s + v * gy[k], 0)
  const c = gy.reduce((s, v) => s + v * v, 0)
  const theta = 0.5 * Math.atan2(2 * b, a - c)
  const ux = Math.cos(theta)
  const uy = Math.sin(theta)
  const t = xs.map((x, j) => (x - mx) * ux + (ys[j] - my) * uy)
  const ramp = fitRamp(t, cs)
  if (!ramp) return null
  const { t0, t1, stops, rms } = ramp
  const gradient: Gradient = { type: 'linear', x1: mx + t0 * ux, y1: my + t0 * uy, x2: mx + t1 * ux, y2: my + t1 * uy, stops }
  return { gradient, rms }
}

function fitRadial(xs: number[], ys: number[], cs: Rgb[]) {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const scale = Math.sqrt(xs.reduce((s, x, j) => s + (x - mx) ** 2 + (ys[j] - my) ** 2, 0) / n) || 1
  // One number per pixel: its colour along the colours' main axis.
  const cm = [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / n)
  const axis = mainAxis(cs, cm)
  const s = cs.map((c) => (c[0] - cm[0]) * axis[0] + (c[1] - cm[1]) * axis[1] + (c[2] - cm[2]) * axis[2])
  // s = a + bx + cy + d(x² + y²), in scaled coordinates about the mean.
  const rows = xs.map((x, j) => {
    const u = (x - mx) / scale
    const v = (ys[j] - my) / scale
    return [1, u, v, u * u + v * v]
  })
  const q = leastSquares(rows, s)
  if (!q || Math.abs(q[3]) < 1e-9) return null
  let cx = -q[1] / (2 * q[3])
  let cy = -q[2] / (2 * q[3])
  // A centre far outside the region is a linear shade, bent.
  if (Math.hypot(cx, cy) > 3) return null
  // Refine: s = a + k·r, where r is the distance from (cx, cy).
  let a = 0
  let k = 0
  for (let it = 0; it < 8; it++) {
    const r = rows.map(([, u, v]) => Math.hypot(u - cx, v - cy))
    const ak = leastSquares(
      r.map((ri) => [1, ri]),
      s,
    )
    if (!ak) return null
    ;[a, k] = ak
    const jac = rows.map(([, u, v], j) => {
      const ri = Math.max(r[j], 1e-6)
      return [1, r[j], (-k * (u - cx)) / ri, (-k * (v - cy)) / ri]
    })
    const res = s.map((sj, j) => sj - (a + k * r[j]))
    const delta = leastSquares(jac, res)
    if (!delta) break
    cx += delta[2]
    cy += delta[3]
    if (Math.hypot(delta[2], delta[3]) < 1e-4) break
  }
  if (Math.hypot(cx, cy) > 3) return null
  const px = mx + cx * scale
  const py = my + cy * scale
  const r = xs.map((x, j) => Math.hypot(x - px, ys[j] - py))
  const ramp = fitRamp(r, cs, 0)
  if (!ramp || ramp.t1 <= 0) return null
  const gradient: Gradient = { type: 'radial', cx: px, cy: py, r: ramp.t1, stops: ramp.stops.map((st) => ({ ...st, offset: round((ramp.t0 + st.offset * (ramp.t1 - ramp.t0)) / ramp.t1, 3) })) }
  return { gradient, rms: ramp.rms }
}

/**
 * Colour as a function of t: piecewise linear between evenly spaced stops
 * from the least t to the greatest, as few as come within a level of the most.
 * Offsets run 0–1 over [t0, t1]. With `from`, t0 is at least that.
 */
function fitRamp(t: number[], cs: Rgb[], from = -Infinity) {
  let t0 = Infinity
  let t1 = -Infinity
  for (const tj of t) {
    if (tj < t0) t0 = tj
    if (tj > t1) t1 = tj
  }
  t0 = Math.max(from, t0)
  if (!(t1 > t0)) return null
  const fits: { stops: GradientStop[]; rms: number }[] = []
  for (let m = 2; m <= MAX_STOPS; m++) {
    const at = (tj: number) => Math.min(m - 1, Math.max(0, ((tj - t0) / (t1 - t0)) * (m - 1)))
    // Hat functions: each pixel is a mix of the two stops around it.
    const rows = t.map((tj) => {
      const p = at(tj)
      const i = Math.min(m - 2, Math.floor(p))
      const f = p - i
      const row = new Array<number>(m).fill(0)
      row[i] = 1 - f
      row[i + 1] = f
      return row
    })
    // A light tie between neighbouring stops, so a stop no pixel reaches takes its neighbours' colour.
    const ties = Array.from({ length: m - 1 }, (_, i) => {
      const row = new Array<number>(m).fill(0)
      row[i] = TIE
      row[i + 1] = -TIE
      return row
    })
    const chans = [0, 1, 2].map((k) =>
      leastSquares(
        [...rows, ...ties],
        [...cs.map((c) => c[k]), ...ties.map(() => 0)],
      ),
    )
    if (chans.some((c) => !c)) continue
    const colorAt = (row: number[]): Rgb => [0, 1, 2].map((k) => clamp(row.reduce((s, v, i) => s + v * chans[k]![i], 0))) as Rgb
    const stopColors = Array.from({ length: m }, (_, i) => [0, 1, 2].map((k) => clamp(chans[k]![i])) as Rgb)
    const rms = Math.sqrt(rows.reduce((s, row, j) => s + dist2(colorAt(row), cs[j]), 0) / t.length)
    fits.push({ stops: stopColors.map((c, i) => ({ offset: round(i / (m - 1), 3), color: toHex(c) })), rms })
  }
  if (!fits.length) return null
  const least = Math.min(...fits.map((f) => f.rms))
  return { t0, t1, ...fits.find((f) => f.rms <= least + 1)! }
}

/** The main axis of a set of colours (power iteration on their covariance). */
function mainAxis(cs: Rgb[], cm: number[]): number[] {
  const cov = [0, 1, 2].map(() => [0, 0, 0])
  for (const c of cs) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += (c[i] - cm[i]) * (c[j] - cm[j])
  // Starting from the axis of the channel that varies most: [1, 1, 1] is orthogonal to a pure change of hue.
  let v = [0, 1, 2].map((i) => cov[i][i])
  v = cov[v.indexOf(Math.max(...v))].slice()
  for (let it = 0; it < 30; it++) {
    const next = cov.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
    const len = Math.hypot(...next) || 1
    v = next.map((x) => x / len)
  }
  return v
}

/** Least squares through the normal equations (small systems only). */
function leastSquares(rows: number[][], y: number[]): number[] | null {
  const m = rows[0]?.length ?? 0
  const A = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0))
  rows.forEach((row, j) => {
    for (let a = 0; a < m; a++) {
      if (!row[a]) continue
      for (let b = 0; b < m; b++) A[a][b] += row[a] * row[b]
      A[a][m] += row[a] * y[j]
    }
  })
  for (let c = 0; c < m; c++) {
    let p = c
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    if (Math.abs(A[p][c]) < 1e-12) return null
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < m; r++) {
      if (r === c) continue
      const f = A[r][c] / A[c][c]
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k]
    }
  }
  return A.map((row, i) => row[m] / row[i])
}

const clamp = (v: number) => Math.max(0, Math.min(255, v))
const dist2 = (a: Rgb, b: Rgb) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places
