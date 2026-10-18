import { describe, expect, it } from 'vitest'
import { isSvgFile, zipName } from './batch'

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
