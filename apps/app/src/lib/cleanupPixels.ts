/**
 * Replaying a clean-up list (lib/cleanup.ts) onto pixels. Kept apart from the
 * list itself so it loads only once Clean up is used: the session check and
 * the mode's glue need the list, not the pixel loops.
 */
import { clamp, isQuarter, normDegrees, type CleanupOp, type Crop, type Flip, type Img, type Levels } from './cleanup'

// ---- Replay -----------------------------------------------------------------

export function replay(img: Img, ops: CleanupOp[]): Img {
  let out = img
  for (const op of ops) out = apply(out, op)
  return out
}

export function apply(img: Img, op: CleanupOp): Img {
  switch (op.kind) {
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
      const a = (y0 * w + x0) * 4
      const b = (y0 * w + x1) * 4
      const c = (y1 * w + x0) * 4
      const e = (y1 * w + x1) * 4
      for (let k = 0; k < 4; k++) rgba[o + k] = (s[a + k] * (1 - fx) + s[b + k] * fx) * (1 - fy) + (s[c + k] * (1 - fx) + s[e + k] * fx) * fy
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

