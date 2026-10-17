import { describe, expect, it } from 'vitest'
import { exactPalette, parsePath, peakPalette, toSvg, trace } from './index'

/** 40 × 20: a red square and a blue square side by side on white. */
function card() {
  const w = 40
  const h = 20
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y >= 4 && y < 16 && x >= 4 && x < 36 ? (x < 20 ? [220, 40, 30] : [30, 60, 200]) : [255, 255, 255]
      px.set([...c, 255], (y * w + x) * 4)
    }
  return { px, w, h }
}

describe('the public API', () => {
  it('traces to shapes as data, largest first, sharing their edge exactly', () => {
    const { px, w, h } = card()
    const r = trace(px, w, h, { mode: 'palette', palette: exactPalette(px, 8), speckle: 0, tolerance: 1, cornerAngle: 45 })
    expect(r.width).toBe(40)
    // White (largest) first; the two equal squares follow.
    expect(r.paths[0].fill).toBe('#ffffff')
    expect(r.paths.slice(1).map((p) => p.fill).sort()).toEqual(['#1e3cc8', '#dc281e'])
    // The red square's right edge and the blue square's left edge are the same line, x = 20.
    const xs = (d: string) => parsePath(d).flatMap((s) => s.nodes.map((n) => n.x))
    for (const p of r.paths.slice(1)) expect(xs(p.d)).toContain(20)
  })
  it('writes an SVG with a viewBox', () => {
    const { px, w, h } = card()
    const svg = toSvg(trace(px, w, h, { mode: 'palette', palette: peakPalette(px, 8), speckle: 0, tolerance: 1, cornerAngle: 45 }))
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="40" height="20" viewBox="0 0 40 20">/)
    expect(svg.match(/<path /g)).toHaveLength(3)
  })
})
