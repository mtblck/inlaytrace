/**
 * Clean up in the browser: the original's pixels at clean-up size, the list
 * replayed onto them, and the result as a Source for the tracer or a PNG to
 * download. Loaded with Clean up (dynamic import), like the replay itself.
 */
import { CLEANUP_MAX_EDGE, type CleanupOp, type Img } from './cleanup'
import { replay } from './cleanupPixels'
import type { Source } from './image'

/** The original at clean-up size (long edge at most 2048 px), once per image. */
const originals = new WeakMap<ImageBitmap, Img>()
export function originalPixels(source: Source): Img {
  let img = originals.get(source.bitmap)
  if (!img) {
    const { width: w, height: h } = source.bitmap
    const scale = Math.min(1, CLEANUP_MAX_EDGE / Math.max(w, h))
    const width = Math.max(1, Math.round(w * scale))
    const height = Math.max(1, Math.round(h * scale))
    const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source.bitmap, 0, 0, width, height)
    img = { rgba: ctx.getImageData(0, 0, width, height).data, width, height }
    originals.set(source.bitmap, img)
  }
  return img
}

/**
 * The cleaned pixels. The last few results are kept, so the preview and the
 * trace share one replay, and a list that only adds to one of them (a new
 * stroke) replays just what it adds.
 */
const KEEP = 4
const recent: { bitmap: ImageBitmap; ops: CleanupOp[]; key: string; img: Img }[] = []
const sameOp = (a: CleanupOp, b: CleanupOp) => a === b || JSON.stringify(a) === JSON.stringify(b)
export function cleanedPixels(source: Source, ops: CleanupOp[]): Img {
  const key = JSON.stringify(ops)
  const hit = recent.find((r) => r.bitmap === source.bitmap && r.key === key)
  if (hit) return hit.img
  let from = 0
  let start = originalPixels(source)
  for (const r of recent)
    if (r.bitmap === source.bitmap && r.ops.length > from && r.ops.length < ops.length && r.ops.every((o, i) => sameOp(o, ops[i]))) {
      from = r.ops.length
      start = r.img
    }
  const img = replay(start, ops.slice(from))
  // Only this image's results are kept: another image's go with it.
  const mine = recent.filter((r) => r.bitmap === source.bitmap).slice(0, KEEP - 1)
  recent.splice(0, recent.length, { bitmap: source.bitmap, ops, key, img }, ...mine)
  return img
}

const toImageData = (img: Img) => new ImageData(img.rgba as Uint8ClampedArray<ArrayBuffer>, img.width, img.height)

export async function pngOf(img: Img): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height)
  canvas.getContext('2d')!.putImageData(toImageData(img), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

/**
 * The cleaned image as the Source the tracer takes. Its "original" size is
 * the cleaned size in the original's pixels, so 100% zoom and the export's
 * default size still mean the file's own scale after a crop.
 */
export async function cleanedSource(source: Source, ops: CleanupOp[]): Promise<Source> {
  const img = cleanedPixels(source, ops)
  const [bitmap, blob] = await Promise.all([createImageBitmap(toImageData(img)), pngOf(img)])
  const k = source.originalWidth / originalPixels(source).width
  return { name: source.name, url: URL.createObjectURL(blob), originalWidth: Math.round(img.width * k), originalHeight: Math.round(img.height * k), bitmap }
}
