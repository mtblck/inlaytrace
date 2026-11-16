/**
 * The command line's PNG decoder (bin/png.mjs, #165), against PNGs written
 * here in every colour type, with every row filter.
 */
import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
// @ts-expect-error: plain JS for Node, with no type declarations
import { decodePng, isPng } from '../bin/png.mjs'

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b: Buffer) => {
  let c = 0xffffffff
  for (const v of b) c = CRC[(c ^ v) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (kind: string, body: Buffer) => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(body.length, 0)
  head.write(kind, 4, 'latin1')
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0)
  return Buffer.concat([head, body, tail])
}

/** A PNG of `rows` (unfiltered bytes per row), each row filtered with filter (y % 5), so all five filters are read. */
function png(width: number, height: number, depth: number, type: number, rows: Buffer[], extra: Buffer[] = []) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = depth
  ihdr[9] = type
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type]!
  const bpp = Math.max(1, (channels * depth) >> 3)
  const stride = rows[0]!.length
  let prev = Buffer.alloc(stride)
  const out: Buffer[] = []
  rows.forEach((row, y) => {
    const f = y % 5
    const line = Buffer.alloc(stride + 1)
    line[0] = f
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0
      const b = prev[i]!
      const c = i >= bpp ? prev[i - bpp]! : 0
      const p = a + b - c
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c
      line[i + 1] = (row[i]! - pred) & 0xff
    }
    out.push(line)
    prev = row
  })
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(Buffer.concat(out))), chunk('IEND', Buffer.alloc(0))])
}

/** A 7 × 6 test pattern: each pixel's channels from its place, so a misplaced byte shows. */
const W = 7
const H = 6
const rgba = (x: number, y: number) => [x * 36, y * 40, (x * y * 13) & 255, 255 - x * 20]

describe('the CLI’s PNG decoder', () => {
  it('reads RGBA and RGB at 8 bits through every row filter', () => {
    const rows6 = Array.from({ length: H }, (_, y) => Buffer.from(Array.from({ length: W }, (_, x) => rgba(x, y)).flat()))
    const a = decodePng(png(W, H, 8, 6, rows6))
    expect([a.width, a.height]).toEqual([W, H])
    expect(Array.from(a.data)).toEqual(Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => rgba(x, y))).flat(2))
    const rows2 = Array.from({ length: H }, (_, y) => Buffer.from(Array.from({ length: W }, (_, x) => rgba(x, y).slice(0, 3)).flat()))
    const b = decodePng(png(W, H, 8, 2, rows2))
    expect(Array.from(b.data)).toEqual(Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => [...rgba(x, y).slice(0, 3), 255])).flat(2))
  })

  it('reads a 4-bit palette with transparency', () => {
    const plte = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])
    const trns = Buffer.from([255, 128])
    // Indices 0, 1, 2, 0, … two to a byte.
    const idx = (x: number, y: number) => (x + y) % 3
    const rows = Array.from({ length: H }, (_, y) => {
      const r = Buffer.alloc(Math.ceil(W / 2))
      for (let x = 0; x < W; x++) r[x >> 1]! |= idx(x, y) << (x & 1 ? 0 : 4)
      return r
    })
    const d = decodePng(png(W, H, 4, 3, rows, [chunk('PLTE', plte), chunk('tRNS', trns)]))
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = idx(x, y)
        expect(Array.from(d.data.slice((y * W + x) * 4, (y * W + x) * 4 + 4))).toEqual([...plte.subarray(k * 3, k * 3 + 3), k < 2 ? trns[k] : 255])
      }
  })

  it('reads 16-bit grey and 8-bit grey with alpha', () => {
    const rows16 = Array.from({ length: H }, (_, y) => {
      const r = Buffer.alloc(W * 2)
      for (let x = 0; x < W; x++) r.writeUInt16BE(x * 9000 + y, x * 2)
      return r
    })
    const g = decodePng(png(W, H, 16, 0, rows16))
    expect(g.data[(2 * W + 3) * 4]).toBe((3 * 9000 + 2) >> 8)
    expect(g.data[(2 * W + 3) * 4 + 3]).toBe(255)
    const rowsGA = Array.from({ length: H }, (_, y) => Buffer.from(Array.from({ length: W }, (_, x) => [x * 30, y * 40]).flat()))
    const ga = decodePng(png(W, H, 8, 4, rowsGA))
    expect(Array.from(ga.data.slice((3 * W + 5) * 4, (3 * W + 5) * 4 + 4))).toEqual([150, 150, 150, 120])
  })

  it('knows a PNG from anything else, and leaves interlaced files to sharp', () => {
    expect(isPng(Buffer.from('GIF89a........'))).toBe(false)
    const one = png(1, 1, 8, 2, [Buffer.from([1, 2, 3])])
    expect(isPng(one)).toBe(true)
    one[8 + 8 + 12] = 1 // IHDR's interlace byte
    expect(() => decodePng(one)).toThrow(expect.objectContaining({ interlaced: true }))
  })
})
