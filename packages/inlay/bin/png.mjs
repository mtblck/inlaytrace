/**
 * A small PNG decoder for the command line, on Node's own zlib, so the
 * package needs no dependencies.
 */
import { inflateSync } from 'node:zlib'

export function isPng(b) {
  return b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a
}

/**
 * A PNG as RGBA: every colour type, bit depths 1–16, transparency (tRNS).
 * Interlaced files are rare and left to sharp.
 */
export function decodePng(b) {
  let pos = 8
  let width = 0
  let height = 0
  let depth = 0
  let type = 0
  let interlace = 0
  let palette = null
  let trns = null
  const idat = []
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos)
    const kind = b.toString('latin1', pos + 4, pos + 8)
    const body = b.subarray(pos + 8, pos + 8 + len)
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      depth = body[8]
      type = body[9]
      interlace = body[12]
    } else if (kind === 'PLTE') palette = body
    else if (kind === 'tRNS') trns = body
    else if (kind === 'IDAT') idat.push(body)
    else if (kind === 'IEND') break
    pos += 12 + len
  }
  if (!width || !height) throw new Error('the PNG has no image header')
  if (interlace) throw Object.assign(new Error('interlaced PNGs need sharp'), { interlaced: true })
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]
  if (!channels) throw new Error(`unknown PNG colour type ${type}`)
  const bpp = Math.max(1, (channels * depth) >> 3) // bytes per pixel, for filtering
  const stride = Math.ceil((width * channels * depth) / 8)
  const raw = inflateSync(Buffer.concat(idat))
  const rows = Buffer.alloc(stride * height)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = rows.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0
      const up = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      const x = line[i]
      out[i] =
        filter === 0 ? x
        : filter === 1 ? x + a
        : filter === 2 ? x + up
        : filter === 3 ? x + ((a + up) >> 1)
        : x + paeth(a, up, c)
    }
    prev = out
  }
  // Each sample scaled to 0–255; 16-bit keeps its high byte.
  const sample = (row, i) => {
    if (depth === 8) return row[i]
    if (depth === 16) return row[i * 2]
    const bit = i * depth
    const v = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
    return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1))
  }
  const raw16 = (row, i) => (depth === 16 ? row.readUInt16BE(i * 2) : depth === 8 ? row[i] : null)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      let r, g, bl, al = 255
      if (type === 3) {
        const k = sample(row, x)
        r = palette[k * 3]
        g = palette[k * 3 + 1]
        bl = palette[k * 3 + 2]
        if (trns && k < trns.length) al = trns[k]
      } else if (type === 0 || type === 4) {
        r = g = bl = sample(row, x * channels)
        if (type === 4) al = sample(row, x * channels + 1)
        else if (trns && depth >= 8 && raw16(row, x) === trns.readUInt16BE(0)) al = 0
      } else {
        r = sample(row, x * channels)
        g = sample(row, x * channels + 1)
        bl = sample(row, x * channels + 2)
        if (type === 6) al = sample(row, x * channels + 3)
        else if (trns && depth >= 8 && raw16(row, x * 3) === trns.readUInt16BE(0) && raw16(row, x * 3 + 1) === trns.readUInt16BE(2) && raw16(row, x * 3 + 2) === trns.readUInt16BE(4)) al = 0
      }
      data[o] = r
      data[o + 1] = g
      data[o + 2] = bl
      data[o + 3] = al
    }
  }
  return { data, width, height }
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}
