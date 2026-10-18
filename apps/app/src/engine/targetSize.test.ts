import { describe, expect, it } from 'vitest'
import { render, searchSize } from './targetSize'
import { settingsFor } from './presets'

describe('drawing back', () => {
  it('fills with the nonzero rule at pixel centres, holes included', () => {
    const img = render('<svg><path d="M1 1L9 1L9 9L1 9ZM3 3L3 7L7 7L7 3Z" fill="#ff0000"/></svg>', 10, 10)
    const at = (x: number, y: number) => Array.from(img.slice((y * 10 + x) * 3, (y * 10 + x) * 3 + 3))
    expect(at(1, 1)).toEqual([255, 0, 0])
    expect(at(5, 5)).toEqual([255, 255, 255]) // the hole winds the other way
    expect(at(0, 0)).toEqual([255, 255, 255])
    expect(at(8, 8)).toEqual([255, 0, 0])
    expect(at(9, 9)).toEqual([255, 255, 255])
  })
  it('draws a centerline stroke as a band its width', () => {
    const img = render('<svg><path d="M0 5L10 5" fill="none" stroke="#000000" stroke-width="2"/></svg>', 10, 10)
    expect(img[(4 * 10 + 5) * 3]).toBe(0)
    expect(img[(2 * 10 + 5) * 3]).toBe(255)
  })
})

describe('target size', () => {
  // A noisy two-tone picture: plenty of specks for the search to trade away.
  const w = 96
  const h = 96
  const px = new Uint8Array(w * h * 4)
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = Math.hypot(x - 48, y - 48) < 30 + 4 * Math.sin(x / 3)
      const flip = rand() < 0.04
      const v = inside !== flip ? 40 : 230
      px.set([v, v, v + 10, 255], (y * w + x) * 4)
    }
  const measure = (svg: string) => svg.length
  // No speck filter and tight curves: a large file with room to shrink.
  const noisy = { ...settingsFor('logo'), speckle: 0, smoothing: 0 }

  it('finds smaller settings that fit, starting from the current ones', () => {
    const start = searchSize(px, w, h, noisy, Infinity, measure).start
    const r = searchSize(px, w, h, noisy, Math.round(start.bytes * 0.6), measure)
    expect(r.fits).toBe(true)
    expect(r.best.bytes).toBeLessThanOrEqual(start.bytes * 0.6)
    expect(r.start).toEqual(start)
    expect(r.tried).toBeGreaterThan(1)
  })

  it('says when nothing fits, and offers the smallest it found', () => {
    const r = searchSize(px, w, h, noisy, 10, measure)
    expect(r.fits).toBe(false)
    expect(r.best.bytes).toBeLessThan(r.start.bytes)
  })

  it('stops at once when the file already fits', () => {
    const r = searchSize(px, w, h, noisy, 1e9, measure)
    expect(r.tried).toBe(1)
    expect(r.best).toEqual(r.start)
  })
})
