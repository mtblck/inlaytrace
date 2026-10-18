/**
 * Decode an uploaded image to RGBA pixels on the server, in plain JavaScript
 * (no native image library): PNG with fast-png (MIT), JPEG with jpeg-js
 * (BSD-3). The app sends the image it traces as PNG; JPEG is accepted too.
 */
import { decode as decodePng } from 'fast-png'
import jpeg from 'jpeg-js'

export type Rgba = { data: Uint8Array; width: number; height: number }

/** Largest image HD accepts, in pixels: a bound on memory, not on what the tiers price. */
export const MAX_PIXELS = 50_000_000

export function decodeImage(bytes: Uint8Array, contentType: string): Rgba {
  if (contentType === 'image/png') return pngToRgba(bytes)
  if (contentType === 'image/jpeg') {
    const j = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: MAX_PIXELS / 1e6, maxMemoryUsageInMB: 1024 })
    return { data: j.data, width: j.width, height: j.height }
  }
  throw new Error(`Unsupported image type ${contentType}.`)
}

function pngToRgba(bytes: Uint8Array): Rgba {
  const png = decodePng(bytes)
  const { width, height, channels } = png
  if (width * height > MAX_PIXELS) throw new Error('Image too large.')
  const src = png.data
  // 16-bit samples: keep the high byte.
  const shift = png.depth === 16 ? 8 : 0
  const out = new Uint8Array(width * height * 4)
  if (png.palette) {
    const pal = png.palette
    for (let i = 0; i < width * height; i++) {
      const c = pal[src[i]] ?? [0, 0, 0, 255]
      out.set([c[0], c[1], c[2], c[3] ?? 255], i * 4)
    }
    return { data: out, width, height }
  }
  for (let i = 0; i < width * height; i++) {
    const s = i * channels
    const v = (k: number) => (shift ? (src[s + k] as number) >> shift : (src[s + k] as number))
    if (channels >= 3) {
      out[i * 4] = v(0)
      out[i * 4 + 1] = v(1)
      out[i * 4 + 2] = v(2)
      out[i * 4 + 3] = channels === 4 ? v(3) : 255
    } else {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v(0)
      out[i * 4 + 3] = channels === 2 ? v(1) : 255
    }
  }
  return { data: out, width, height }
}
