/**
 * The pure parts of the AI steps (prep.ts), apart from the runtime so they
 * can be tested: tiling and stitching for the upscaler, and the input and
 * output of the background model.
 */

/** Tile size and margin, in input pixels, for the 4× upscaler. */
export const TILE = 96
export const PAD = 8
const SCALE = 4

export type Tile = { x: number; y: number; w: number; h: number; x0: number; y0: number; tw: number; th: number }

/** Tiles covering the image, each with the area it owns (x, y, w, h) and the area it reads, margin included (x0, y0, tw, th). */
export function tiles(width: number, height: number, tile = TILE, pad = PAD): Tile[] {
  const out: Tile[] = []
  for (let y = 0; y < height; y += tile)
    for (let x = 0; x < width; x += tile) {
      const x0 = Math.max(0, x - pad)
      const y0 = Math.max(0, y - pad)
      out.push({ x, y, w: Math.min(tile, width - x), h: Math.min(tile, height - y), x0, y0, tw: Math.min(width, x + tile + pad) - x0, th: Math.min(height, y + tile + pad) - y0 })
    }
  return out
}

/** A tile's RGB as the network takes it: planar (all R, then G, then B), 0–1. */
export function tileInput(rgba: ArrayLike<number>, width: number, t: Tile) {
  const n = t.tw * t.th
  const input = new Float32Array(3 * n)
  for (let y = 0; y < t.th; y++)
    for (let x = 0; x < t.tw; x++) {
      const o = ((t.y0 + y) * width + t.x0 + x) * 4
      for (let c = 0; c < 3; c++) input[c * n + y * t.tw + x] = rgba[o + c] / 255
    }
  return input
}

/** Copy the part of a 4× tile output the tile owns (not its margin) into the full RGBA output. */
export function placeTile(out: Uint8ClampedArray, outWidth: number, pred: ArrayLike<number>, t: Tile) {
  const pw = t.tw * SCALE
  const n = pw * t.th * SCALE
  for (let y = (t.y - t.y0) * SCALE; y < (t.y - t.y0 + t.h) * SCALE; y++)
    for (let x = (t.x - t.x0) * SCALE; x < (t.x - t.x0 + t.w) * SCALE; x++) {
      const o = ((t.y0 * SCALE + y) * outWidth + t.x0 * SCALE + x) * 4
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(1, Math.max(0, pred[c * n + y * pw + x])) * 255)
    }
}

/** Upscale RGB 4× tile by tile with `run` (planar 0–1 in, planar 0–1 out at 4×); alpha is left at 0 for the caller. The server (HD) uses bigger tiles: less margin to recompute. */
export async function upscaleTiles(rgba: ArrayLike<number>, width: number, height: number, run: (input: Float32Array, tw: number, th: number) => Promise<ArrayLike<number>>, progress?: (done: number, total: number) => void, tile = TILE) {
  const out = new Uint8ClampedArray(width * SCALE * height * SCALE * 4)
  const all = tiles(width, height, tile)
  let done = 0
  for (const t of all) {
    placeTile(out, width * SCALE, await run(tileInput(rgba, width, t), t.tw, t.th), t)
    progress?.(++done, all.length)
  }
  return out
}

/** U²-Net's input from a 320 × 320 RGBA image: scaled by its brightest value, then ImageNet's mean and deviation, planar. */
export function u2Input(small: ArrayLike<number>, size: number) {
  let max = 1
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) max = Math.max(max, small[i * 4 + c])
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const input = new Float32Array(3 * size * size)
  for (let c = 0; c < 3; c++) for (let i = 0; i < size * size; i++) input[c * size * size + i] = (small[i * 4 + c] / max - mean[c]) / std[c]
  return input
}

/** The model's prediction stretched to 0–255: the alpha mask. */
export function maskFrom(pred: ArrayLike<number>) {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < pred.length; i++) {
    lo = Math.min(lo, pred[i])
    hi = Math.max(hi, pred[i])
  }
  const out = new Uint8ClampedArray(pred.length)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(((pred[i] - lo) / (hi - lo || 1)) * 255)
  return out
}
