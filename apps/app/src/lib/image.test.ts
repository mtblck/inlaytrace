import { describe, expect, it } from 'vitest'
import { coverColours } from './image'

/** A 96 × 96 image from a colour per pixel. */
function image(colour: (x: number, y: number) => [number, number, number]) {
  const rgba = new Uint8ClampedArray(96 * 96 * 4)
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4
      rgba.set([...colour(x, y), 255], i)
    }
  return rgba
}

describe('coverColours', () => {
  it('counts a few for flat art', () => {
    const flag = image((x) => (x < 32 ? [200, 30, 40] : x < 64 ? [250, 250, 250] : [20, 40, 160]))
    expect(coverColours(flag)).toBe(3)
  })

  it('counts many for a smooth two-way gradient, as in a photo', () => {
    const sky = image((x, y) => [x * 2.6, y * 2.6, 128])
    expect(coverColours(sky)).toBeGreaterThan(30)
  })

  it('ignores transparent pixels', () => {
    const rgba = image(() => [10, 10, 10])
    for (let i = 0; i < rgba.length / 2; i += 4) rgba.set([255, 0, 0, 0], i)
    expect(coverColours(rgba)).toBe(1)
  })
})
