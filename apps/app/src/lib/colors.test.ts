import { describe, expect, it } from 'vitest'
import { addColors, nearestColor, parseColorList } from './colors'
import { MAX_OWN_COLORS } from '../engine/presets'

describe('parseColorList', () => {
  it('reads hex codes separated by commas, spaces, semicolons or new lines, # optional', () => {
    expect(parseColorList('#1D3557, e63946;#abc\n  f1faee\t#457b9d,,')).toEqual({ colors: ['#1d3557', '#e63946', '#aabbcc', '#f1faee', '#457b9d'], bad: [] })
  })
  it('says what it couldn’t read', () => {
    expect(parseColorList('red #12345 #00ff00')).toEqual({ colors: ['#00ff00'], bad: ['red', '#12345'] })
  })
})

describe('addColors', () => {
  it('keeps each colour once, in the order first given', () => {
    expect(addColors(['#ff0000'], ['#00FF00', '#ff0000', '#0f0', '#0000ff'])).toEqual(['#ff0000', '#00ff00', '#0000ff'])
  })
  it(`stops at ${MAX_OWN_COLORS}`, () => {
    const many = Array.from({ length: 80 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`)
    expect(addColors([], many)).toHaveLength(MAX_OWN_COLORS)
  })
})

describe('nearestColor', () => {
  it('picks the nearest as the eye sees it', () => {
    expect(nearestColor('#d03020', ['#000000', '#ffffff', '#cc0000', '#0044aa'])).toBe('#cc0000')
    expect(nearestColor('#202830', ['#000000', '#ffffff', '#cc0000'])).toBe('#000000')
  })
  it('leaves the colour alone with no palette', () => {
    expect(nearestColor('#123456', [])).toBe('#123456')
  })
})
