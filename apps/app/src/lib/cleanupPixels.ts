/**
 * Replaying a clean-up list (lib/cleanup.ts) onto pixels. Kept apart from the
 * list itself so it loads only once Clean up is used: the session check and
 * the mode's glue need the list, not the pixel loops.
 */
import { smoothShading } from 'inlaytrace'
import { clamp, isQuarter, normDegrees, type CleanupOp, type Crop, type Fill, type Flip, type Img, type Levels, type MaskStroke, type Paint } from './cleanup'

// ---- Replay -----------------------------------------------------------------

export function replay(img: Img, ops: CleanupOp[]): Img {
  let out = img
  // A stroke paints in place on an image this replay made, rather than copying it once a stroke.
  for (const op of ops) out = op.kind === 'paint' ? paint(out, op, out !== img) : op.kind === 'fill' ? fill(out, op, out !== img) : apply(out, op)
  return out
}

export function apply(img: Img, op: CleanupOp): Img {
  switch (op.kind) {
    case 'paint':
      return paint(img, op, false)
    case 'crop':
      return crop(img, op)
    case 'rotate':
      return rotate(img, op.degrees)
    case 'flip':
      return flip(img, op.axis)
    case 'levels':
      return levels(img, op)
    case 'threshold':
      return threshold(img, op.level)
    case 'fill':
      return fill(img, op, false)
    case 'mask':
      // Background removal's business, not the pixels'.
      return img
  }
}

/** The size an image of `width` × `height` comes out at after `ops`, without touching pixels. */
export function sizeAfter(width: number, height: number, ops: CleanupOp[]) {
  let w = width
  let h = height
  for (const op of ops) {
    if (op.kind === 'crop') ({ w, h } = cropBox(w, h, op))
    else if (op.kind === 'rotate') ({ w, h } = rotatedSize(w, h, op.degrees))
  }
  return { width: w, height: h }
}

function cropBox(w: number, h: number, c: Crop) {
  const x = clamp(Math.round(c.x * w), 0, w - 1)
  const y = clamp(Math.round(c.y * h), 0, h - 1)
  const cw = clamp(Math.round(c.width * w), 1, w - x)
  const ch = clamp(Math.round(c.height * h), 1, h - y)
  return { x, y, w: cw, h: ch }
}

function crop(img: Img, c: Crop): Img {
  const { x, y, w, h } = cropBox(img.width, img.height, c)
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let row = 0; row < h; row++) rgba.set(img.rgba.subarray(((y + row) * img.width + x) * 4, ((y + row) * img.width + x + w) * 4), row * w * 4)
  return { rgba, width: w, height: h }
}

function flip(img: Img, axis: Flip['axis']): Img {
  const { width: w, height: h } = img
  const src = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, w * h)
  const rgba = new Uint8ClampedArray(w * h * 4)
  const dst = new Uint32Array(rgba.buffer)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) dst[y * w + x] = axis === 'horizontal' ? src[y * w + (w - 1 - x)] : src[(h - 1 - y) * w + x]
  return { rgba, width: w, height: h }
}

function rotatedSize(w: number, h: number, degrees: number) {
  const d = normDegrees(degrees)
  if (isQuarter(d)) return Math.abs(d) === 90 ? { w: h, h: w } : { w, h }
  const t = (d * Math.PI) / 180
  const c = Math.abs(Math.cos(t))
  const s = Math.abs(Math.sin(t))
  return { w: Math.ceil(w * c + h * s - 1e-6), h: Math.ceil(w * s + h * c - 1e-6) }
}

function rotate(img: Img, degrees: number): Img {
  const d = normDegrees(degrees)
  const { width: w, height: h } = img
  if (d === 0) return img
  const src = new Uint32Array(img.rgba.buffer, img.rgba.byteOffset, w * h)
  if (isQuarter(d)) {
    const turns = ((Math.round(d / 90) % 4) + 4) % 4 // clockwise quarter turns
    const ow = turns % 2 ? h : w
    const oh = turns % 2 ? w : h
    const rgba = new Uint8ClampedArray(ow * oh * 4)
    const dst = new Uint32Array(rgba.buffer)
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        // The source pixel that lands at (x, y).
        const sx = turns === 1 ? y : turns === 2 ? w - 1 - x : w - 1 - y
        const sy = turns === 1 ? h - 1 - x : turns === 2 ? h - 1 - y : x
        dst[y * ow + x] = src[sy * w + sx]
      }
    return { rgba, width: ow, height: oh }
  }
  // Any other angle: each output pixel samples the source at its inverse rotation.
  const { w: ow, h: oh } = rotatedSize(w, h, d)
  const t = (d * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  const fill = backgroundOf(img)
  const rgba = new Uint8ClampedArray(ow * oh * 4)
  const s = img.rgba
  const cx = w / 2
  const cy = h / 2
  const ocx = ow / 2
  const ocy = oh / 2
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const dx = x + 0.5 - ocx
      const dy = y + 0.5 - ocy
      // Inverse of a clockwise turn (y down) is a counter-clockwise one.
      const sx = cos * dx + sin * dy + cx - 0.5
      const sy = -sin * dx + cos * dy + cy - 0.5
      const o = (y * ow + x) * 4
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) {
        rgba[o] = fill[0]
        rgba[o + 1] = fill[1]
        rgba[o + 2] = fill[2]
        rgba[o + 3] = fill[3]
        continue
      }
      const x0 = clamp(Math.floor(sx), 0, w - 1)
      const y0 = clamp(Math.floor(sy), 0, h - 1)
      const x1 = Math.min(x0 + 1, w - 1)
      const y1 = Math.min(y0 + 1, h - 1)
      const fx = clamp(sx - x0, 0, 1)
      const fy = clamp(sy - y0, 0, 1)
      const corners = [(y0 * w + x0) * 4, (y0 * w + x1) * 4, (y1 * w + x0) * 4, (y1 * w + x1) * 4]
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy]
      // Colour weighted by alpha too (premultiplied), so a transparent pixel's hidden colour never bleeds into an edge.
      let r = 0
      let g = 0
      let bl = 0
      let al = 0
      for (let k = 0; k < 4; k++) {
        const wa = weights[k] * s[corners[k] + 3]
        r += s[corners[k]] * wa
        g += s[corners[k] + 1] * wa
        bl += s[corners[k] + 2] * wa
        al += wa
      }
      rgba[o + 3] = al
      if (al > 0) {
        rgba[o] = r / al
        rgba[o + 1] = g / al
        rgba[o + 2] = bl / al
      }
    }
  return { rgba, width: ow, height: oh }
}

/**
 * The image's background: the commonest colour round its edge (to 4 bits a
 * channel, so JPEG noise still agrees), as the average of the pixels in that
 * bucket. An edge that is mostly transparent gives transparent.
 */
export function backgroundOf(img: Img): [number, number, number, number] {
  const { width: w, height: h, rgba } = img
  const counts = new Map<number, { n: number; r: number; g: number; b: number; a: number }>()
  const add = (x: number, y: number) => {
    const o = (y * w + x) * 4
    const a = rgba[o + 3]
    const key = a < 128 ? -1 : ((rgba[o] >> 4) << 8) | ((rgba[o + 1] >> 4) << 4) | (rgba[o + 2] >> 4)
    const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0, a: 0 }
    c.n++
    c.r += rgba[o]
    c.g += rgba[o + 1]
    c.b += rgba[o + 2]
    c.a += a
    counts.set(key, c)
  }
  for (let x = 0; x < w; x++) {
    add(x, 0)
    if (h > 1) add(x, h - 1)
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y)
    if (w > 1) add(w - 1, y)
  }
  let best: [number, { n: number; r: number; g: number; b: number; a: number }] | null = null
  for (const e of counts) if (!best || e[1].n > best[1].n) best = e
  if (!best || best[0] === -1) return [0, 0, 0, 0]
  const c = best[1]
  return [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n), 255]
}

function levels(img: Img, l: Levels): Img {
  const lut = new Uint8ClampedArray(256)
  const span = Math.max(1, l.white - l.black)
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.pow(clamp((v - l.black) / span, 0, 1), 1 / l.gamma) * 255)
  const rgba = new Uint8ClampedArray(img.rgba.length)
  const s = img.rgba
  for (let i = 0; i < s.length; i += 4) {
    rgba[i] = lut[s[i]]
    rgba[i + 1] = lut[s[i + 1]]
    rgba[i + 2] = lut[s[i + 2]]
    rgba[i + 3] = s[i + 3]
  }
  return { rgba, width: img.width, height: img.height }
}

function threshold(img: Img, level: number): Img {
  const rgba = new Uint8ClampedArray(img.rgba.length)
  const s = img.rgba
  for (let i = 0; i < s.length; i += 4) {
    // Rec. 601 brightness, as most "threshold" tools use.
    const v = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2] >= level ? 255 : 0
    rgba[i] = rgba[i + 1] = rgba[i + 2] = v
    rgba[i + 3] = s[i + 3]
  }
  return { rgba, width: img.width, height: img.height }
}


// ---- Brush and eraser ------------------------------------------------------------
//
// A stroke is stamped as round dabs along its points into a coverage mask (the
// most any dab covers each pixel, so overlapping dabs don't build up), then the
// colour is laid over the image through the mask once. Drawing live uses the
// same three steps a segment at a time, so what's drawn is what replays.

export type Rect = { x0: number; y0: number; x1: number; y1: number }
export type Dab = { x: number; y: number; r: number }
/** Coverage, 0–255, for the pixels in a window of the image (the whole image while drawing; the stroke's box in a replay). */
export type Mask = { data: Uint8Array; x: number; y: number; w: number; h: number }
export const maskOver = (r: Rect): Mask => ({ data: new Uint8Array((r.x1 - r.x0) * (r.y1 - r.y0)), x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 })

/** Radius at a pressure: a light touch still leaves a mark a fifth of the full width. */
export const radiusAt = (full: number, pressure: number) => Math.max(0.5, full * (0.2 + 0.8 * pressure))

/** The colour a stroke lays down, RGBA. The eraser's is the background of the image it paints on. */
export function strokeColour(img: Img, op: Paint): [number, number, number, number] {
  if (op.tool === 'eraser' || !op.color) return backgroundOf(img)
  const n = parseInt(op.color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}

/** One stroke point in image pixels. */
export function dabAt(img: { width: number; height: number }, op: Pick<Paint, 'size'>, x: number, y: number, pressure: number): Dab {
  return { x: x * img.width, y: y * img.height, r: radiusAt((op.size * Math.max(img.width, img.height)) / 2, pressure) }
}

/** Stamp one dab into the mask; returns the pixels it touched (none outside the mask's window). */
function stamp(mask: Mask, d: Dab, hardness: number): Rect | null {
  const x0 = Math.max(mask.x, Math.floor(d.x - d.r))
  const y0 = Math.max(mask.y, Math.floor(d.y - d.r))
  const x1 = Math.min(mask.x + mask.w, Math.ceil(d.x + d.r))
  const y1 = Math.min(mask.y + mask.h, Math.ceil(d.y + d.r))
  if (x0 >= x1 || y0 >= y1) return null
  // The edge fades over this many pixels: at least one, so a hard brush is still anti-aliased.
  const fade = Math.max(1, d.r * (1 - hardness))
  const soft = hardness < 1
  const m = mask.data
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - d.y
    const row = (y - mask.y) * mask.w - mask.x
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - d.x
      let c = (d.r - Math.sqrt(dx * dx + dy * dy)) / fade
      if (c <= 0) continue
      if (c > 1) c = 1
      else if (soft) c = c * c * (3 - 2 * c)
      const v = Math.round(c * 255)
      const i = row + x
      if (v > m[i]) m[i] = v
    }
  }
  return { x0, y0, x1, y1 }
}

const union = (a: Rect | null, b: Rect | null): Rect | null => (!a ? b : !b ? a : { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) })

/**
 * Stamp from `from` (already stamped) to `to`, dabs a fifth of a radius apart
 * so the edge stays smooth; with no `from`, just `to`.
 */
export function stampSegment(mask: Mask, from: Dab | null, to: Dab, hardness: number): Rect | null {
  if (!from) return stamp(mask, to, hardness)
  const len = Math.hypot(to.x - from.x, to.y - from.y)
  const n = Math.max(1, Math.ceil(len / Math.max(0.5, Math.min(from.r, to.r) * 0.2)))
  let rect: Rect | null = null
  for (let i = 1; i <= n; i++) {
    const t = i / n
    rect = union(rect, stamp(mask, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, r: from.r + (to.r - from.r) * t }, hardness))
  }
  return rect
}

/** Lay `colour` over `base` through the mask, into `out`, within `rect` (alpha-correct, so an eraser can paint transparency). */
export function composite(out: Uint8ClampedArray, base: Uint8ClampedArray, w: number, mask: Mask, colour: [number, number, number, number], rect: Rect) {
  const [cr, cg, cb, ca] = colour
  for (let y = rect.y0; y < rect.y1; y++)
    for (let x = rect.x0; x < rect.x1; x++) {
      const m = mask.data[(y - mask.y) * mask.w + x - mask.x]
      if (!m) continue
      const o = (y * w + x) * 4
      const c = m / 255
      const sa = base[o + 3] * (1 - c)
      const pa = ca * c
      const a = sa + pa
      out[o + 3] = a
      if (a > 0) {
        out[o] = (base[o] * sa + cr * pa) / a
        out[o + 1] = (base[o + 1] * sa + cg * pa) / a
        out[o + 2] = (base[o + 2] * sa + cb * pa) / a
      }
    }
}

/** Replay one stroke. With `inPlace`, it paints on `img` itself (the replay owns it). */
function paint(img: Img, op: Paint, inPlace: boolean): Img {
  const { width: w, height: h } = img
  const dabs: Dab[] = []
  // The mask covers only the stroke's box, not the whole image.
  let box: Rect | null = null
  for (let i = 0; i < op.points.length; i += 3) {
    const d = dabAt(img, op, op.points[i], op.points[i + 1], op.points[i + 2])
    dabs.push(d)
    box = union(box, { x0: Math.floor(d.x - d.r), y0: Math.floor(d.y - d.r), x1: Math.ceil(d.x + d.r), y1: Math.ceil(d.y + d.r) })
  }
  const clip = box && { x0: Math.max(0, box.x0), y0: Math.max(0, box.y0), x1: Math.min(w, box.x1), y1: Math.min(h, box.y1) }
  if (!clip || clip.x0 >= clip.x1 || clip.y0 >= clip.y1) return img
  const mask = maskOver(clip)
  let rect: Rect | null = null
  let last: Dab | null = null
  for (const d of dabs) {
    rect = union(rect, stampSegment(mask, last, d, op.hardness))
    last = d
  }
  const out = inPlace ? img : { rgba: img.rgba.slice(), width: w, height: h }
  if (!rect) return out
  if (op.tool === 'despeckle' || op.tool === 'heal') {
    // Worked out from a copy, so the result doesn't depend on whether it paints in place.
    const fixed = op.tool === 'heal' ? heal(img, mask, rect) : despeckle(img, rect, (Math.PI * dabs.reduce((r, d) => Math.max(r, d.r), 0) ** 2) / 4)
    blend(out.rgba, img.rgba, w, mask, fixed, rect)
  } else composite(out.rgba, img.rgba, w, mask, strokeColour(img, op), rect)
  return out
}

/**
 * Lay `fixed` (the pixels of `rect`, row by row) over `base` through the mask,
 * into `out`. Half cover or more counts as full: a mark the brush's edge only
 * mostly covers would otherwise be left as a faint ghost, and the fixed pixels
 * match those round them anyway.
 */
function blend(out: Uint8ClampedArray, base: Uint8ClampedArray, w: number, mask: Mask, fixed: Uint8ClampedArray, rect: Rect) {
  const rw = rect.x1 - rect.x0
  for (let y = rect.y0; y < rect.y1; y++)
    for (let x = rect.x0; x < rect.x1; x++) {
      const m = mask.data[(y - mask.y) * mask.w + x - mask.x]
      if (!m) continue
      const o = (y * w + x) * 4
      const f = ((y - rect.y0) * rw + x - rect.x0) * 4
      const c = Math.min(1, m / 128)
      for (let k = 0; k < 4; k++) out[o + k] = base[o + k] + (fixed[f + k] - base[o + k]) * c
    }
}

// ---- Despeckle and heal (#206) -------------------------------------------------------

/** Two pixels are one colour for despeckling when no channel differs by more than this (JPEG noise left after smoothing). */
const SPECK_TOLERANCE = 24
/** Room round the stroke the smoothing and the specks' neighbours are read from. */
const MARGIN = 6

/**
 * Despeckle: the stroke's box, smoothed (the tracer's own edge-preserving
 * smoothShading, so JPEG noise evens out and edges stay put), then every patch
 * of one colour smaller than `minArea` that lies inside the box taken over by
 * the colour it shares the most edge with. Specks are judged on the pixels
 * round the stroke too, so a dot the brush only half covers is still a dot.
 * Returns the pixels of `rect`.
 */
export function despeckle(img: Img, rect: Rect, minArea: number): Uint8ClampedArray {
  const { width: w, height: h } = img
  const bx0 = Math.max(0, rect.x0 - MARGIN)
  const by0 = Math.max(0, rect.y0 - MARGIN)
  const bw = Math.min(w, rect.x1 + MARGIN) - bx0
  const bh = Math.min(h, rect.y1 + MARGIN) - by0
  const box = new Uint8ClampedArray(bw * bh * 4)
  for (let y = 0; y < bh; y++) box.set(img.rgba.subarray(((by0 + y) * w + bx0) * 4, ((by0 + y) * w + bx0 + bw) * 4), y * bw * 4)
  const px = smoothShading(box, bw, bh)
  // A few rounds: a speck that joins a slightly larger one can leave that one still small.
  for (let round = 0; round < 4; round++) if (!mergeSmall(px, bw, bh, Math.max(2, minArea))) break
  const out = new Uint8ClampedArray((rect.x1 - rect.x0) * (rect.y1 - rect.y0) * 4)
  const rw = rect.x1 - rect.x0
  for (let y = rect.y0; y < rect.y1; y++) out.set(px.subarray(((y - by0) * bw + rect.x0 - bx0) * 4, ((y - by0) * bw + rect.x1 - bx0) * 4), (y - rect.y0) * rw * 4)
  return out
}

/** One round of despeckling `px` in place; false when no speck was left. */
function mergeSmall(px: Uint8ClampedArray, w: number, h: number, minArea: number): boolean {
  // Patches of one colour: each grown from its first pixel, within the tolerance of that pixel's colour.
  const label = new Int32Array(w * h).fill(-1)
  const areas: number[] = []
  const edge: boolean[] = []
  const sums: number[][] = []
  const stack = new Int32Array(w * h)
  for (let start = 0; start < w * h; start++) {
    if (label[start] >= 0) continue
    const id = areas.length
    const o = start * 4
    const [r, g, b, a] = [px[o], px[o + 1], px[o + 2], px[o + 3]]
    let n = 0
    let area = 0
    let touches = false
    const sum = [0, 0, 0, 0]
    stack[n++] = start
    label[start] = id
    while (n) {
      const i = stack[--n]
      area++
      for (let k = 0; k < 4; k++) sum[k] += px[i * 4 + k]
      const x = i % w
      const y = (i - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && label[j] < 0 && near(px, j * 4, r, g, b, a, SPECK_TOLERANCE)) {
          label[j] = id
          stack[n++] = j
        }
    }
    areas.push(area)
    edge.push(touches)
    sums.push(sum)
  }
  // Each small patch inside the box takes the colour of the neighbour it shares most edge with, smallest first.
  const small = areas.map((a, id) => ({ a, id })).filter((c) => c.a < minArea && !edge[c.id] && areas.length > 1)
  if (!small.length) return false
  const members: number[][] = areas.map(() => [])
  for (let i = 0; i < w * h; i++) if (areas[label[i]] < minArea) members[label[i]].push(i)
  const colour = (id: number) => sums[id].map((v) => Math.round(v / areas[id]))
  const owner = Int32Array.from(label)
  let changed = false
  small.sort((p, q) => p.a - q.a)
  for (const { id } of small) {
    const votes = new Map<number, number>()
    for (const i of members[id]) {
      const x = i % w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w])
        if (j >= 0 && j < w * h && owner[j] !== id) votes.set(owner[j], (votes.get(owner[j]) ?? 0) + 1)
    }
    let best = -1
    let most = 0
    for (const [l, v] of votes) if (v > most || (v === most && areas[l] > areas[best])) (most = v), (best = l)
    if (best < 0) continue
    const [r, g, b, a] = colour(best)
    for (const i of members[id]) {
      owner[i] = best
      px[i * 4] = r
      px[i * 4 + 1] = g
      px[i * 4 + 2] = b
      px[i * 4 + 3] = a
    }
    areas[best] += areas[id]
    changed = true
  }
  return changed
}

/**
 * Heal: the pixels under the stroke filled in from the pixels round it, a ring
 * at a time from the outside in. Each takes the colour of the neighbour most
 * like the rest of its filled-in neighbours (not their average), so a flat
 * colour stays flat and where two colours meet the edge stays sharp rather
 * than blurring to a third that would trace as a band. Returns the pixels of
 * `rect`.
 */
export function heal(img: Img, mask: Mask, rect: Rect): Uint8ClampedArray {
  const { width: w, height: h } = img
  const rw = rect.x1 - rect.x0
  const rh = rect.y1 - rect.y0
  const out = new Uint8ClampedArray(rw * rh * 4)
  // The pixels to fill: every one the stroke touches. Pixels round the rect are read from the image.
  const known = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h ? false : x < rect.x0 || y < rect.y0 || x >= rect.x1 || y >= rect.y1 ? true : done[(y - rect.y0) * rw + x - rect.x0] === 1
  const done = new Uint8Array(rw * rh)
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x
      const o = ((rect.y0 + y) * w + rect.x0 + x) * 4
      for (let k = 0; k < 4; k++) out[i * 4 + k] = img.rgba[o + k]
      if (!mask.data[(rect.y0 + y - mask.y) * mask.w + rect.x0 + x - mask.x]) done[i] = 1
    }
  const colourAt = (x: number, y: number, k: number) => (x >= rect.x0 && y >= rect.y0 && x < rect.x1 && y < rect.y1 ? out[((y - rect.y0) * rw + x - rect.x0) * 4 + k] : img.rgba[(y * w + x) * 4 + k])
  let left = done.reduce((n, v) => n + (v ? 0 : 1), 0)
  const ring: number[] = []
  const cand: number[] = []
  while (left) {
    ring.length = 0
    for (let y = 0; y < rh; y++)
      for (let x = 0; x < rw; x++) {
        if (done[y * rw + x]) continue
        const gx = rect.x0 + x
        const gy = rect.y0 + y
        cand.length = 0
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && known(gx + dx, gy + dy)) cand.push(gx + dx, gy + dy)
        if (!cand.length) continue
        // The medoid: the known neighbour nearest, in total, to the others.
        let best = 0
        let bestCost = Infinity
        for (let a = 0; a < cand.length; a += 2) {
          let cost = 0
          for (let b = 0; b < cand.length; b += 2) for (let k = 0; k < 4; k++) cost += Math.abs(colourAt(cand[a], cand[a + 1], k) - colourAt(cand[b], cand[b + 1], k))
          if (cost < bestCost) (bestCost = cost), (best = a)
        }
        ring.push(y * rw + x, cand[best], cand[best + 1])
      }
    // Nothing known anywhere near (a stroke over the whole image): leave the rest as it is.
    if (!ring.length) break
    // The whole ring is worked out before any of it counts as known, so the fill doesn't lean one way.
    for (let r = 0; r < ring.length; r += 3) for (let k = 0; k < 4; k++) out[ring[r] * 4 + k] = colourAt(ring[r + 1], ring[r + 2], k)
    for (let r = 0; r < ring.length; r += 3) done[ring[r]] = 1
    left -= ring.length / 3
  }
  return out
}

// ---- Fill and the magic wand -------------------------------------------------------
//
// One region finder for both: the Fill tool fills what one click finds, and the
// wand shows what its clicks find until it's filled or cleared. Both are then
// the same op, so a replay finds the same region from the same pixels.

/** How far apart two pixels are: the most any channel differs, with every nearly transparent pixel alike whatever its hidden colour. */
function near(s: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number, tolerance: number) {
  const pa = s[i + 3]
  if (pa < 8 && a < 8) return true
  return Math.abs(s[i] - r) <= tolerance && Math.abs(s[i + 1] - g) <= tolerance && Math.abs(s[i + 2] - b) <= tolerance && Math.abs(pa - a) <= tolerance
}

/**
 * The pixels each seed takes, joined: 1 where taken, 0 elsewhere. A seed is a
 * point in fractions of the image; it takes the pixels within `tolerance` of
 * its own colour, only those joined to it edge to edge when `contiguous`.
 */
export function regionOf(img: Img, seeds: number[], tolerance: number, contiguous: boolean): Uint8Array {
  const { width: w, height: h, rgba: s } = img
  const out = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  let seen: Uint8Array | null = null
  for (let k = 0; k + 1 < seeds.length; k += 2) {
    const sx = clamp(Math.floor(seeds[k] * w), 0, w - 1)
    const sy = clamp(Math.floor(seeds[k + 1] * h), 0, h - 1)
    const at = sy * w + sx
    const o = at * 4
    const [r, g, b, a] = [s[o], s[o + 1], s[o + 2], s[o + 3]]
    if (!contiguous) {
      for (let i = 0; i < w * h; i++) if (!out[i] && near(s, i * 4, r, g, b, a, tolerance)) out[i] = 1
      continue
    }
    if (out[at]) continue
    // A flood from the seed, a pixel at a time; `seen` marks pixels already queued, so each is looked at once a seed.
    if (seen) seen.fill(0)
    else seen = new Uint8Array(w * h)
    let n = 0
    stack[n++] = at
    seen[at] = 1
    while (n) {
      const i = stack[--n]
      if (!near(s, i * 4, r, g, b, a, tolerance)) continue
      out[i] = 1
      const x = i % w
      if (x > 0 && !seen[i - 1]) (seen[i - 1] = 1), (stack[n++] = i - 1)
      if (x < w - 1 && !seen[i + 1]) (seen[i + 1] = 1), (stack[n++] = i + 1)
      if (i >= w && !seen[i - w]) (seen[i - w] = 1), (stack[n++] = i - w)
      if (i < w * (h - 1) && !seen[i + w]) (seen[i + w] = 1), (stack[n++] = i + w)
    }
  }
  return out
}

/** The colour a fill lays down: its own, or the background of the image it fills. */
export function fillColour(img: Img, op: Pick<Fill, 'color'>): [number, number, number, number] {
  if (!op.color) return backgroundOf(img)
  const n = parseInt(op.color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]
}

/** Replay a fill. With `inPlace`, it fills `img` itself (the replay owns it). */
function fill(img: Img, op: Fill, inPlace: boolean): Img {
  const region = regionOf(img, op.seeds, op.tolerance, op.contiguous)
  const [r, g, b, a] = fillColour(img, op)
  const out = inPlace ? img : { rgba: img.rgba.slice(), width: img.width, height: img.height }
  const d = out.rgba
  for (let i = 0; i < region.length; i++)
    if (region[i]) {
      const o = i * 4
      d[o] = r
      d[o + 1] = g
      d[o + 2] = b
      d[o + 3] = a
    }
  return out
}

// ---- Mask strokes (#204) ---------------------------------------------------------------
//
// Keep and Remove strokes are drawn on the image as it is at their step, but
// laid over background removal's mask, which is made from the image at the end
// of the list. So each stroke is carried through the crops, turns and flips
// after it, point by point, into fractions of the final image.

/** Where the point (x, y), in pixels of a `w` × `h` image, lands after `op`, and the image's new size. */
function movePoint(op: CleanupOp, w: number, h: number, x: number, y: number): { x: number; y: number; w: number; h: number } {
  if (op.kind === 'crop') {
    const b = cropBox(w, h, op)
    return { x: x - b.x, y: y - b.y, w: b.w, h: b.h }
  }
  if (op.kind === 'flip') return op.axis === 'horizontal' ? { x: w - x, y, w, h } : { x, y: h - y, w, h }
  if (op.kind !== 'rotate') return { x, y, w, h }
  const d = normDegrees(op.degrees)
  const size = rotatedSize(w, h, d)
  if (isQuarter(d)) {
    const turns = ((Math.round(d / 90) % 4) + 4) % 4
    const [nx, ny] = turns === 0 ? [x, y] : turns === 1 ? [h - y, x] : turns === 2 ? [w - x, h - y] : [y, w - x]
    return { x: nx, y: ny, ...size }
  }
  // The replay samples each new pixel at its inverse turn; this is the forward one.
  const t = (d * Math.PI) / 180
  const dx = x - w / 2
  const dy = y - h / 2
  return { x: Math.cos(t) * dx - Math.sin(t) * dy + size.w / 2, y: Math.sin(t) * dx + Math.cos(t) * dy + size.h / 2, ...size }
}

/**
 * The list's mask strokes, carried into fractions of the image the list ends
 * with (`width` × `height` is the original's size: only proportions matter).
 * Brush sizes follow, as fractions of the final image's long edge.
 */
export function maskStrokes(ops: CleanupOp[], width: number, height: number): MaskStroke[] {
  const out: MaskStroke[] = []
  let w = width
  let h = height
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (op.kind === 'mask') {
      const pts = op.points.slice()
      let cw = w
      let ch = h
      for (let k = 0; k < pts.length; k += 3) {
        let p = { x: pts[k] * w, y: pts[k + 1] * h, w, h }
        for (let j = i + 1; j < ops.length; j++) p = movePoint(ops[j], p.w, p.h, p.x, p.y)
        pts[k] = p.x / p.w
        pts[k + 1] = p.y / p.h
        cw = p.w
        ch = p.h
      }
      out.push({ ...op, size: (op.size * Math.max(w, h)) / Math.max(cw, ch), points: pts })
      continue
    }
    if (op.kind === 'crop' || op.kind === 'rotate' || op.kind === 'flip') ({ w, h } = movePoint(op, w, h, 0, 0))
  }
  return out
}

/** Lay mask strokes over `rgba`'s alpha, in place: Remove takes it away, Keep brings it back to opaque. */
export function applyMaskStrokes(rgba: Uint8ClampedArray, width: number, height: number, strokes: MaskStroke[]) {
  const img = { width, height }
  for (const op of strokes) {
    let box: Rect | null = null
    const dabs = []
    for (let i = 0; i < op.points.length; i += 3) {
      const d = dabAt(img, op, op.points[i], op.points[i + 1], op.points[i + 2])
      dabs.push(d)
      box = union(box, { x0: Math.floor(d.x - d.r), y0: Math.floor(d.y - d.r), x1: Math.ceil(d.x + d.r), y1: Math.ceil(d.y + d.r) })
    }
    const clip = box && { x0: Math.max(0, box.x0), y0: Math.max(0, box.y0), x1: Math.min(width, box.x1), y1: Math.min(height, box.y1) }
    if (!clip || clip.x0 >= clip.x1 || clip.y0 >= clip.y1) continue
    const mask = maskOver(clip)
    let last: Dab | null = null
    for (const d of dabs) {
      stampSegment(mask, last, d, op.hardness)
      last = d
    }
    for (let y = clip.y0; y < clip.y1; y++)
      for (let x = clip.x0; x < clip.x1; x++) {
        const m = mask.data[(y - mask.y) * mask.w + x - mask.x]
        if (!m) continue
        const o = (y * width + x) * 4 + 3
        const c = m / 255
        rgba[o] = op.tool === 'remove' ? rgba[o] * (1 - c) : rgba[o] + (255 - rgba[o]) * c
      }
  }
}
