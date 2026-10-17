/**
 * Getting pixels out of whatever the user dropped.
 *
 * Tracing time grows with pixel count (a 4 MP poster took ~7 s in testing,
 * the same image at 2048 px about a quarter of that), so large images are
 * scaled down before tracing. The SVG is then emitted at the traced size; it is
 * a vector, so its display size is free to change afterwards.
 */
export type Source = {
  name: string
  /** Object URL of the original file, for the "before" side of the comparison. */
  url: string
  originalWidth: number
  originalHeight: number
  bitmap: ImageBitmap
}

/** `upscale` is the factor applied before tracing (1 = none). */
export type Pixels = { rgba: Uint8ClampedArray; width: number; height: number; upscale: number }

/**
 * Sources whose long edge is below UPSCALE_BELOW are upscaled to UPSCALE_TO
 * before tracing. A 146×156 logo has 2–3 px features, and VTracer faithfully
 * follows their pixel steps; upscaled with smoothing and a light blur the same
 * logo traced to clean curves with every slit and tooth intact (README, "Small
 * images"). The 640 px sample badge already traced to 0.93% wrong pixels at
 * native size, so mid-size images are left alone rather than paying 2.5× the
 * pixels for nothing.
 */
export const UPSCALE_BELOW = 512
const UPSCALE_TO = 1024
const MAX_UPSCALE = 8

export const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']

export async function loadSource(file: Blob, name = 'image'): Promise<Source> {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error(`That file is ${file.type || 'an unknown type'}. Use a PNG, JPG, WebP, GIF or BMP.`)
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('That image could not be read. It may be damaged or in an unsupported format.')
  }
  return {
    name: baseName(name),
    url: URL.createObjectURL(file),
    originalWidth: bitmap.width,
    originalHeight: bitmap.height,
    bitmap,
  }
}

export function pixelsOf(source: Source, maxEdge: number, allowUpscale = true): Pixels {
  const long = Math.max(source.bitmap.width, source.bitmap.height)
  let scale = Math.min(1, maxEdge / long)
  if (allowUpscale && long < UPSCALE_BELOW) scale = Math.min(MAX_UPSCALE, UPSCALE_TO / long)
  const width = Math.max(1, Math.round(source.bitmap.width * scale))
  const height = Math.max(1, Math.round(source.bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Pixel art must stay hard-edged; everything else is smoothed when resized.
  ctx.imageSmoothingEnabled = allowUpscale
  ctx.imageSmoothingQuality = 'high'
  // When upscaling, a blur of half the scale factor melts the stair-steps that
  // smoothing alone leaves on diagonal edges. Browsers without canvas filters
  // ignore this and still get the smoothed upscale.
  if (scale > 1) ctx.filter = `blur(${(scale / 2).toFixed(1)}px)`
  ctx.drawImage(source.bitmap, 0, 0, width, height)
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height, upscale: scale > 1 ? scale : 1 }
}

/**
 * Whether the image sits on a dark background, judged by its border pixels.
 * Line art uses this to start in "light on dark" for logos like a white mark
 * on black, so the shapes, not the background, are what get traced.
 */
export function hasDarkBackground(source: Source): boolean {
  const size = 64
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(source.bitmap, 0, 0, size, size)
  const { data } = ctx.getImageData(0, 0, size, size)
  let sum = 0
  let n = 0
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (x > 1 && x < size - 2 && y > 1 && y < size - 2) continue
      const i = (y * size + x) * 4
      if (data[i + 3] < 128) continue // transparent border says nothing
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      n++
    }
  return n > 0 && sum / n < 96
}

export function baseName(name: string) {
  const stem = name.replace(/\.[^.]+$/, '').trim()
  return (stem || 'image').replace(/[^\w.-]+/g, '-').slice(0, 60)
}

// One full-size copy of the original's pixels per image, made on the first pick.
const pickCache = new WeakMap<ImageBitmap, ImageData>()

/**
 * The original image's colour at (fx, fy), as fractions of its width and
 * height: what the eyedropper picks. Read from the original, never the trace,
 * so it gives back what the artist used. Transparent pixels give null.
 */
export function colourAt(source: Source, fx: number, fy: number): string | null {
  const bm = source.bitmap
  let data = pickCache.get(bm)
  if (!data) {
    const c = new OffscreenCanvas(bm.width, bm.height)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bm, 0, 0)
    data = ctx.getImageData(0, 0, bm.width, bm.height)
    pickCache.set(bm, data)
  }
  const x = Math.min(bm.width - 1, Math.max(0, Math.floor(fx * bm.width)))
  const y = Math.min(bm.height - 1, Math.max(0, Math.floor(fy * bm.height)))
  const i = (y * bm.width + x) * 4
  if (data.data[i + 3] < 128) return null
  return `#${[0, 1, 2].map((k) => data!.data[i + k].toString(16).padStart(2, '0')).join('')}`
}
