import { describe, expect, it } from 'vitest'
import { peakPalette, presets, toSvg, trace, traceInlay } from './index'

/** 60 × 40: a red disc and a blue bar on white, drawn hard-edged. */
function card() {
  const width = 60
  const height = 40
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = (x - 18) ** 2 + (y - 20) ** 2 < 10 ** 2 ? [220, 40, 30] : x >= 36 && x < 52 && y >= 8 && y < 32 ? [30, 60, 200] : [255, 255, 255]
      data.set([...c, 255], (y * width + x) * 4)
    }
  return { data, width, height }
}

/** 60 × 40: a black ring 3 px wide on white, or white on black. */
function ring(light = false) {
  const width = 60
  const height = 40
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const r = Math.hypot(x - 30, y - 20)
      const ink = r > 11 && r < 14
      const v = ink !== light ? 0 : 255
      data.set([v, v, v, 255], (y * width + x) * 4)
    }
  return { data, width, height }
}

describe('trace(image, { preset }) (#162, #163)', () => {
  it('takes anything shaped like ImageData, and is Logo with no options', () => {
    const img = card()
    const r = trace(img)
    expect(r.width).toBe(60)
    expect(r.paths.map((p) => p.fill).sort()).toEqual(['#1e3cc8', '#dc281e', '#ffffff'])
    // The same as the old call with Logo's recipe written out.
    const logo = presets.logo
    const old = trace(img.data, img.width, img.height, { mode: 'palette', palette: peakPalette(img.data, 8, { width: img.width }), speckle: logo.speckle!, tolerance: logo.tolerance!, cornerAngle: logo.cornerAngle!, shapes: true })
    expect(toSvg(r)).toBe(toSvg(old))
    expect(traceInlay(img, { preset: 'logo' })).toBe(toSvg(r))
  })

  it('lets any option override the preset', () => {
    const img = card()
    const fills = (r: { paths: { fill: string }[] }) => new Set(r.paths.map((p) => p.fill)).size
    expect(fills(trace(img, { colors: 2 }))).toBe(2)
    expect(fills(trace(img))).toBe(3)
  })

  it('traces in your own colours only, and never shades them with gradients', () => {
    const mine = ['#ffffff', '#cc0000', '#0044aa']
    for (const preset of ['logo', 'illustration', 'poster'] as const) {
      const r = trace(card(), { preset, palette: mine })
      for (const p of r.paths) {
        expect(mine).toContain(p.fill)
        expect(p.gradient).toBeUndefined()
      }
    }
  })

  it('traces line art as ink only, light ink when told, and leaves the caller’s pixels alone', () => {
    expect(trace(ring(), { preset: 'lineart' }).paths).toHaveLength(1)
    const light = ring(true)
    const before = Uint8ClampedArray.from(light.data)
    const inverted = trace(light, { preset: 'lineart', invert: true })
    expect(inverted.paths).toHaveLength(1)
    expect(toSvg(inverted)).toBe(toSvg(trace(ring(), { preset: 'lineart' })))
    expect(light.data).toEqual(before)
  })

  it('gives centerline strokes the same shape as every other path', () => {
    const r = trace(ring(), { preset: 'centerline' })
    expect(r.paths).toHaveLength(1)
    expect(r.paths[0]!.fill).toBe('#000000')
    expect(r.paths[0]!.stroke).toBeGreaterThan(2)
    expect(r.measuredWidth).toBe(r.paths[0]!.stroke)
    expect(trace(ring(), { preset: 'centerline', strokeWidth: 1.5 }).paths[0]!.stroke).toBe(1.5)
  })

  it('keeps pixel art’s exact colours and staircase', () => {
    const r = trace(card(), { preset: 'pixel' })
    for (const p of r.paths) expect(p.d).not.toContain('C')
  })

  it('says what went wrong with an unknown preset or too few bytes', () => {
    expect(() => trace(card(), { preset: 'nope' as 'logo' })).toThrow(/Unknown preset "nope"/)
    expect(() => trace({ data: new Uint8Array(10), width: 4, height: 4 })).toThrow(/4 × 4 × 4 bytes/)
  })

  it('lists every preset with its defaults', () => {
    expect(Object.keys(presets).sort()).toEqual(['centerline', 'illustration', 'lineart', 'logo', 'outline', 'pixel', 'poster'])
    expect(presets.outline.strokes).toBe(true)
    expect(presets.logo.layers).toBe(false)
  })
})
