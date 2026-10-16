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

export type Pixels = { rgba: Uint8ClampedArray; width: number; height: number }

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

export function pixelsOf(source: Source, maxEdge: number): Pixels {
  const scale = Math.min(1, maxEdge / Math.max(source.bitmap.width, source.bitmap.height))
  const width = Math.max(1, Math.round(source.bitmap.width * scale))
  const height = Math.max(1, Math.round(source.bitmap.height * scale))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Pixel art must stay hard-edged when it is (rarely) scaled.
  ctx.imageSmoothingEnabled = scale < 1 && maxEdge < 4096
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source.bitmap, 0, 0, width, height)
  return { rgba: ctx.getImageData(0, 0, width, height).data, width, height }
}

export function baseName(name: string) {
  const stem = name.replace(/\.[^.]+$/, '').trim()
  return (stem || 'image').replace(/[^\w.-]+/g, '-').slice(0, 60)
}
