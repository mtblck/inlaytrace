import { describe, expect, it } from 'vitest'
import { resizeAlpha } from './upscale'

describe('resizeAlpha', () => {
  it('keeps an opaque image opaque without interpolating', () => {
    const data = new Uint8Array(2 * 2 * 4).fill(255)
    expect(Array.from(resizeAlpha({ data, width: 2, height: 2 }, 8, 8))).toEqual(new Array(64).fill(255))
  })

  it('scales transparency smoothly, holding the edges', () => {
    // Left column transparent, right column opaque.
    const data = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 255])
    const a = resizeAlpha({ data, width: 2, height: 2 }, 8, 2)
    expect(a[0]).toBe(0)
    expect(a[7]).toBe(255)
    for (let x = 1; x < 8; x++) expect(a[x]).toBeGreaterThanOrEqual(a[x - 1])
  })
})
