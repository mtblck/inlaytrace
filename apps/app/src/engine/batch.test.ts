import { describe, expect, it, vi } from 'vitest'
import { isSvgFile, runBatch, zipName } from './batch'
import { settingsFor, type TraceOptions } from './presets'
import type { TraceClient } from './client'

// A small image, upscaled 4× for tracing, as pixelsOf does under 512 px.
vi.mock('../lib/image', () => ({
  loadSource: async () => ({ bitmap: { close() {} }, url: 'blob:x' }),
  pixelsOf: () => ({ rgba: new Uint8ClampedArray(16 * 16 * 4), width: 16, height: 16, upscale: 4 }),
}))

describe('batch naming', () => {
  it('names each SVG after its image, keeping repeats apart', () => {
    const used = new Set<string>()
    expect(['logo.png', 'logo.jpg', 'logo.png', 'photo.webp', '.png'].map((f, i) => zipName(f, i, used))).toEqual(['logo.svg', 'logo-2.svg', 'logo-3.svg', 'photo.svg', 'image-5.svg'])
  })
  it('skips SVGs, by type or name', () => {
    expect(isSvgFile({ name: 'a.svg', type: '' })).toBe(true)
    expect(isSvgFile({ name: 'a', type: 'image/svg+xml' })).toBe(true)
    expect(isSvgFile({ name: 'a.png', type: 'image/png' })).toBe(false)
  })
})

describe('batch tracing', () => {
  it('traces Outline art with lines scaled by how far each image was upscaled', async () => {
    const seen: TraceOptions[] = []
    const client = {
      trace: async (_rgba: Uint8ClampedArray, _w: number, _h: number, o: TraceOptions) => (seen.push(o), { type: 'traced', svg: '<svg/>' }),
      optimize: async (svg: string) => ({ type: 'optimized', svg }),
    } as unknown as TraceClient
    const zip = await runBatch([new File(['x'], 'small.png', { type: 'image/png' })], settingsFor('outline'), client, () => {}, () => false)
    expect(zip?.length).toBeGreaterThan(0)
    expect(seen).toHaveLength(1)
    expect(seen[0].strokes).toBe(true)
    expect(seen[0].scale).toBe(4)
  })
})
