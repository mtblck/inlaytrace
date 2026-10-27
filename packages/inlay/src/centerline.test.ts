import { describe, expect, it } from 'vitest'
import { centerline, centerlineToSvg } from './centerline'
import { parsePath, type Pt } from './path'
import { pointAt, type Cubic } from './fit'

/** Grey ink on white paper, anti-aliased (4×4 samples a pixel). */
function paint(ink: (x: number, y: number) => boolean, w = 100, h = 100) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) s += +ink(x + (i + 0.5) / 4, y + (j + 0.5) / 4)
      const v = Math.round(250 - (230 * s) / 16)
      px.set([v, v, v, 255], (y * w + x) * 4)
    }
  return px
}
/** Distance from a point to the segment a–b. */
const seg = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}
const options = { threshold: 128, speckle: 2, tolerance: 1, cornerAngle: 45 }

/** Every point along the strokes. */
function samples(d: string): Pt[] {
  const out: Pt[] = []
  for (const sp of parsePath(d)) {
    const n = sp.nodes.length
    for (let i = 0; i < (sp.closed ? n : n - 1); i++) {
      const a = sp.nodes[i]
      const b = sp.nodes[(i + 1) % n]
      const c: Cubic = [a, a.out ?? a, b.in ?? b, b]
      for (let t = 0; t <= 1; t += 1 / 16) out.push(pointAt(c, t))
    }
  }
  return out
}

describe('centerline', () => {
  it('traces a straight stroke as one line down its middle, and measures its width', () => {
    const r = centerline(paint((x, y) => seg(x, y, 15, 40, 85, 60) < 3), 100, 100, options)
    const subs = parsePath(r.paths[0].d)
    expect(subs).toHaveLength(1)
    expect(subs[0].closed).toBe(false)
    for (const p of samples(r.paths[0].d)) expect(seg(p.x, p.y, 15, 40, 85, 60)).toBeLessThan(1)
    expect(r.measuredWidth).toBeGreaterThan(5)
    expect(r.measuredWidth).toBeLessThan(7)
  })

  it('keeps a crossing as two strokes that carry straight through it', () => {
    const plus = (x: number, y: number) => seg(x, y, 20, 50, 80, 50) < 2.5 || seg(x, y, 50, 20, 50, 80) < 2.5
    const subs = parsePath(centerline(paint(plus), 100, 100, options).paths[0].d)
    expect(subs).toHaveLength(2)
    for (const s of subs) expect(s.nodes).toHaveLength(2)
  })

  it('carries thick strokes straight through a slanted crossing and a T', () => {
    // Thinning pinches an X of 8 px strokes toward its middle and bends a T's
    // stem to meet the bar; the strokes must stay within a pixel of straight.
    const lines: [number, number, number, number][] = [
      [20, 10, 56, 90],
      [56, 10, 20, 90],
      [110, 30, 190, 30],
      [150, 30, 150, 90],
    ]
    const ink = (x: number, y: number) => lines.some(([ax, ay, bx, by]) => seg(x, y, ax, ay, bx, by) < 4)
    const d = centerline(paint(ink, 200, 100), 200, 100, options).paths[0].d
    // Before the junctions were refitted the X bent 2.5 px off its lines.
    const worst = Math.max(...samples(d).map((p) => Math.min(...lines.map(([ax, ay, bx, by]) => seg(p.x, p.y, ax, ay, bx, by)))))
    expect(worst).toBeLessThan(1)
  })

  it('traces a ring as one closed loop', () => {
    const subs = parsePath(centerline(paint((x, y) => Math.abs(Math.hypot(x - 50, y - 50) - 30) < 2), 100, 100, options).paths[0].d)
    expect(subs).toHaveLength(1)
    expect(subs[0].closed).toBe(true)
    for (const p of samples(centerline(paint((x, y) => Math.abs(Math.hypot(x - 50, y - 50) - 30) < 2), 100, 100, options).paths[0].d))
      expect(Math.abs(Math.hypot(p.x - 50, p.y - 50) - 30)).toBeLessThan(1)
  })

  it('follows a curve without stray branches', () => {
    const wave = (x: number, y: number) => x > 10 && x < 90 && Math.abs(y - (50 + 20 * Math.sin((x - 10) / 12))) < 2
    const subs = parsePath(centerline(paint(wave), 100, 100, options).paths[0].d)
    expect(subs).toHaveLength(1)
  })

  it('uses the stroke width asked for, and writes round-capped strokes', () => {
    const r = centerline(paint((x, y) => seg(x, y, 20, 50, 80, 50) < 2), 100, 100, { ...options, strokeWidth: 2.5 })
    expect(r.paths[0].strokeWidth).toBe(2.5)
    expect(centerlineToSvg(r)).toContain('fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"')
  })

  it('draws nothing on blank paper', () => {
    expect(centerline(paint(() => false), 100, 100, options).paths).toEqual([])
  })
})
