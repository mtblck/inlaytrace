import { describe, expect, it } from 'vitest'
import { trace, type InlayOptions } from './inlay'
import { pointAt, type Cubic } from './fit'
import { parsePath } from './path'

/** A two-colour picture of a shape, anti-aliased like a real render (4×4 samples a pixel). */
function paint(inside: (x: number, y: number) => boolean, w = 100, h = 100) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) s += +inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)
      const t = s / 16
      px.set([245 * (1 - t) + 30 * t, 240 * (1 - t) + 60 * t, 230 * (1 - t) + 140 * t, 255].map(Math.round), (y * w + x) * 4)
    }
  return px
}
const options = { mode: 'palette' as const, palette: ['#f5f0e6', '#1e3c8c'], speckle: 2, tolerance: 0.5, cornerAngle: 45 }
const shapeOf = (px: Uint8ClampedArray, o: Partial<InlayOptions> = {}) => trace(px, 100, 100, { ...options, shapes: true, ...o } as InlayOptions).paths.find((p) => p.fill === '#1e3c8c')!.d

/** The path's cubics, sampled: every point on it. */
function samples(d: string) {
  const out: { x: number; y: number }[] = []
  for (const sp of parsePath(d))
    for (let i = 0; i < sp.nodes.length; i++) {
      const a = sp.nodes[i]
      const b = sp.nodes[(i + 1) % sp.nodes.length]
      const c: Cubic = [a, a.out ?? a, b.in ?? b, b]
      for (let t = 0; t < 1; t += 1 / 32) out.push(pointAt(c, t))
    }
  return out
}

const rotated = (x: number, y: number, deg: number) => {
  const a = (deg * Math.PI) / 180
  return { u: (x - 50) * Math.cos(a) + (y - 50) * Math.sin(a), v: -(x - 50) * Math.sin(a) + (y - 50) * Math.cos(a) }
}

describe('exact shapes', () => {
  it('draw a circle as a circle, closer than the fitted curve', () => {
    const px = paint((x, y) => Math.hypot(x - 50.3, y - 49.6) < 30)
    const worst = (d: string) => Math.max(...samples(d).map((p) => Math.abs(Math.hypot(p.x - 50.3, p.y - 49.6) - 30)))
    const exact = shapeOf(px)
    const fitted = shapeOf(px, { shapes: false })
    expect(parsePath(exact)[0].nodes).toHaveLength(4)
    expect(worst(exact)).toBeLessThan(0.15)
    expect(worst(exact)).toBeLessThan(worst(fitted))
  })

  it('draw a turned ellipse within 0.3 px', () => {
    const px = paint((x, y) => {
      const { u, v } = rotated(x, y, 20)
      return (u / 35) ** 2 + (v / 18) ** 2 < 1
    })
    // Distance to the ellipse, approximately (Sampson).
    const off = Math.max(
      ...samples(shapeOf(px)).map((p) => {
        const { u, v } = rotated(p.x, p.y, 20)
        return Math.abs((u / 35) ** 2 + (v / 18) ** 2 - 1) / (2 * Math.hypot(u / 35 ** 2, v / 18 ** 2))
      }),
    )
    expect(off).toBeLessThan(0.3)
  })

  it('draw rectangles with four exact right angles, upright or turned', () => {
    expect(shapeOf(paint((x, y) => Math.abs(x - 50) < 25 && Math.abs(y - 50) < 15))).toBe('M75 35L25 35L25 65L75 65Z')
    const turned = parsePath(shapeOf(paint((x, y) => Math.abs(rotated(x, y, 15).u) < 30 && Math.abs(rotated(x, y, 15).v) < 18)))[0].nodes
    expect(turned).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      const [a, b, c] = [turned[i], turned[(i + 1) % 4], turned[(i + 2) % 4]]
      const cos = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y))
      expect(Math.abs(cos)).toBeLessThan(1e-3) // 90° to within the path data's 2 decimals
    }
  })

  it('draw a rounded rectangle as four sides and four quarter circles', () => {
    const px = paint((x, y) => {
      const qx = Math.abs(x - 50) - 22
      const qy = Math.abs(y - 50) - 12
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 8 < 0
    })
    const d = shapeOf(px)
    expect(d.match(/C/g)).toHaveLength(4)
    expect(d.match(/[LZ]/g)).toHaveLength(4) // the last side may be the closing Z
  })

  it('draw regular polygons with equal sides', () => {
    for (const k of [3, 6]) {
      const px = paint((x, y) => {
        for (let i = 0; i < k; i++) {
          const a = (i * 2 * Math.PI) / k + 0.2
          if ((x - 50) * Math.cos(a) + (y - 50) * Math.sin(a) > 20) return false
        }
        return true
      })
      const nodes = parsePath(shapeOf(px))[0].nodes
      expect(nodes).toHaveLength(k)
      const sides = nodes.map((a, i) => Math.hypot(nodes[(i + 1) % k].x - a.x, nodes[(i + 1) % k].y - a.y))
      expect(Math.max(...sides) - Math.min(...sides)).toBeLessThan(0.05)
    }
  })

  it('leave shapes that are only nearly one of these as fitted', () => {
    const near = [
      (x: number, y: number) => Math.hypot(x - 50, y - 50) < 28 + 1.8 * Math.sin(3 * Math.atan2(y - 50, x - 50)), // a wobbly circle
      (x: number, y: number) => ((x - 50) / 28) ** 2 + ((y - 50) / (y < 50 ? 34 : 26)) ** 2 < 1, // an egg
      (x: number, y: number) => Math.hypot(Math.max(Math.abs(x - 50) - 20, 0), y - 50) < 14, // a stadium
      (x: number, y: number) => Math.abs(x - 50) < 25 && Math.abs(y - 50) < 15 && !(x > 65 && y > 55), // a notched rectangle
    ]
    for (const inside of near) {
      const px = paint(inside)
      expect(shapeOf(px)).toBe(shapeOf(px, { shapes: false }))
    }
  })

  it('still tile: a shape and the hole it sits in are the same outline', () => {
    const r = trace(paint((x, y) => Math.hypot(x - 50.3, y - 49.6) < 30), 100, 100, { ...options, shapes: true })
    const paper = parsePath(r.paths.find((p) => p.fill === '#f5f0e6')!.d)
    const disc = parsePath(r.paths.find((p) => p.fill === '#1e3c8c')!.d)[0]
    const hole = paper.find((sp) => !sp.nodes.some((n) => n.x === 0 && n.y === 0))!
    const key = (n: { x: number; y: number }) => `${n.x},${n.y}`
    expect(new Set(hole.nodes.map(key))).toEqual(new Set(disc.nodes.map(key)))
  })
})
