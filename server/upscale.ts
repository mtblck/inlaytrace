/**
 * HD upscaling: Real-ESRGAN x4plus, 4×, on the server, tile by tile with the
 * same tiling and stitching as the browser's x4v3 (apps/app/src/engine/prepCore.ts),
 * in bigger tiles. Alpha is scaled on its own (bilinear); the network only sees colour.
 */
import { encode } from 'fast-png'
import { upscaleTiles } from '../apps/app/src/engine/prepCore.js'
import type { Rgba } from './image.js'
import type { Runtime, Session } from './models.js'

/** Server tiles: less margin to recompute than the browser's 96 px. */
const TILE = 192

/** Upscale 4×. Throws if it would pass `deadline` (ms since epoch), so a run that can't finish is refunded rather than cut off. */
export async function upscale4(image: Rgba, model: { session: Session; runtime: Runtime }, deadline = Infinity): Promise<Rgba> {
  const { session, runtime } = model
  const run = async (input: Float32Array, tw: number, th: number) => {
    if (Date.now() > deadline) throw new Error('Upscaling took too long for this image.')
    const out = await session.run({ [session.inputNames[0]]: new runtime.Tensor('float32', input, [1, 3, th, tw]) })
    return out[session.outputNames[0]].data as Float32Array
  }
  const W = image.width * 4
  const H = image.height * 4
  const out = await upscaleTiles(image.data, image.width, image.height, run, undefined, TILE)
  const alpha = resizeAlpha(image, W, H)
  for (let i = 0; i < W * H; i++) out[i * 4 + 3] = alpha[i]
  return { data: new Uint8Array(out.buffer), width: W, height: H }
}

/** The alpha channel scaled to W × H, bilinear. Opaque images skip the work. */
export function resizeAlpha(image: Rgba, W: number, H: number): Uint8Array {
  const { data, width, height } = image
  const out = new Uint8Array(W * H)
  let opaque = true
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) opaque = false
  if (opaque) return out.fill(255)
  for (let y = 0; y < H; y++) {
    const fy = Math.min(height - 1, Math.max(0, (y + 0.5) * (height / H) - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(height - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < W; x++) {
      const fx = Math.min(width - 1, Math.max(0, (x + 0.5) * (width / W) - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(width - 1, x0 + 1)
      const tx = fx - x0
      const a = (yy: number, xx: number) => data[(yy * width + xx) * 4 + 3]
      out[y * W + x] = Math.round((a(y0, x0) * (1 - tx) + a(y0, x1) * tx) * (1 - ty) + (a(y1, x0) * (1 - tx) + a(y1, x1) * tx) * ty)
    }
  }
  return out
}

export const toPng = (image: Rgba) => encode({ width: image.width, height: image.height, data: image.data, channels: 4, depth: 8 })
