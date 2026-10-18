import { describe, expect, it } from 'vitest'
import { maskFrom, tiles, u2Input, upscaleTiles } from './prepCore'

/** A fake network: nearest-neighbour 4×, planar in and out, like the real one's shapes. */
const nearest = async (input: Float32Array, tw: number, th: number) => {
  const out = new Float32Array(3 * tw * 4 * th * 4)
  for (let c = 0; c < 3; c++)
    for (let y = 0; y < th * 4; y++) for (let x = 0; x < tw * 4; x++) out[c * tw * 16 * th + y * tw * 4 + x] = input[c * tw * th + (y >> 2) * tw + (x >> 2)]
  return out
}

describe('upscale tiling', () => {
  it('covers the image exactly once, margins clamped to its edges', () => {
    const w = 250
    const h = 130
    const owned = new Uint8Array(w * h)
    for (const t of tiles(w, h)) {
      expect(t.x0).toBeGreaterThanOrEqual(0)
      expect(t.x0 + t.tw).toBeLessThanOrEqual(w)
      expect(t.x0).toBeLessThanOrEqual(t.x)
      expect(t.x0 + t.tw).toBeGreaterThanOrEqual(t.x + t.w)
      for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) owned[y * w + x]++
    }
    expect(owned.every((n) => n === 1)).toBe(true)
  })

  it('stitches tiles back into the whole image, no seams or shifts', async () => {
    const w = 211 // not a multiple of the tile, so edge tiles are partial
    const h = 103
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) rgba.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4)
    const out = await upscaleTiles(rgba, w, h, nearest)
    let wrong = 0
    for (let y = 0; y < h * 4; y++)
      for (let x = 0; x < w * 4; x++)
        for (let c = 0; c < 3; c++) if (out[(y * w * 4 + x) * 4 + c] !== rgba[((y >> 2) * w + (x >> 2)) * 4 + c]) wrong++
    expect(wrong).toBe(0)
  })
})

describe('background model', () => {
  it('normalises the input as rembg does: by the brightest value, then ImageNet mean and deviation', () => {
    const px = new Uint8ClampedArray(2 * 2 * 4).fill(255)
    px.set([0, 0, 0, 255], 0)
    const input = u2Input(px, 2)
    expect(input[0]).toBeCloseTo((0 - 0.485) / 0.229, 5) // R of the black pixel
    expect(input[1]).toBeCloseTo((1 - 0.485) / 0.229, 5) // R of a white one
    expect(input[4 + 1]).toBeCloseTo((1 - 0.456) / 0.224, 5) // G plane
  })

  it('stretches the prediction to a 0–255 mask', () => {
    expect(Array.from(maskFrom([0, 0.25, 1]))).toEqual([0, 64, 255])
    expect(Array.from(maskFrom([0.5, 0.5]))).toEqual([0, 0]) // flat: nothing found
  })
})
