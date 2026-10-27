import { describe, expect, it } from 'vitest'
import { trace, type InlayResult } from './inlay'
import { quantizePalette } from './palette'
import { parsePath, type Pt } from './path'

/** Flatten a path's subpaths to polygons (each cubic as 16 segments). */
function polygons(d: string): Pt[][] {
  return parsePath(d).map((sp) => {
    const pts: Pt[] = []
    const n = sp.nodes
    for (let i = 0; i < n.length; i++) {
      const a = n[i]
      const b = n[(i + 1) % n.length]
      const c1 = a.out ?? a
      const c2 = b.in ?? b
      for (let j = 0; j < 16; j++) {
        const t = j / 16
        const u = 1 - t
        pts.push({
          x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
          y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
        })
      }
    }
    return pts
  })
}

/** Nonzero winding number of a point against polygons, as SVG's default fill rule. */
function inside(polys: Pt[][], x: number, y: number) {
  let wind = 0
  for (const poly of polys)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      if (a.y <= y && b.y > y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) > 0) wind++
      else if (a.y > y && b.y <= y && (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y) < 0) wind--
    }
  return wind !== 0
}

/** Paint the trace at every pixel centre, in path order: the colour on top, or '' where nothing is. */
function render(r: InlayResult): string[] {
  const shapes = r.paths.map((p) => ({ polys: polygons(p.d), fill: p.fill }))
  const out: string[] = []
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      let top = ''
      for (const s of shapes) if (inside(s.polys, x + 0.5, y + 0.5)) top = s.fill
      out.push(top)
    }
  return out
}

const W = 96
const H = 80
/**
 * Nested shapes: a blue panel holding a red ring, the ring holding a gold disc
 * (three deep), a green bar crossing the panel's edge, and a transparent
 * window cut into the panel.
 */
function picture() {
  const px = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 40, y - 40)
      let c = [245, 240, 230, 255] // paper
      if (x >= 10 && x < 75 && y >= 8 && y < 72) c = [30, 60, 140, 255] // panel
      if (r < 26) c = [210, 50, 40, 255] // ring
      if (r < 13) c = [235, 170, 40, 255] // disc
      if (y >= 34 && y < 44 && x >= 60) c = [40, 140, 70, 255] // bar
      if (x >= 66 && x < 72 && y >= 12 && y < 24) c = [0, 0, 0, 0] // window
      px.set(c, (y * W + x) * 4)
    }
  return px
}
const palette = ['#f5f0e6', '#1e3c8c', '#d23228', '#ebaa28', '#288c46']
const options = { mode: 'palette' as const, palette, speckle: 2, tolerance: 0.5, cornerAngle: 45 }

describe('stacked shapes (photos)', () => {
  const cut = trace(picture(), W, H, { ...options, photo: true })
  const stacked = trace(picture(), W, H, { ...options, photo: true, stacked: true })

  it('paint the same picture as cut-out shapes', () => {
    const a = render(cut)
    const b = render(stacked)
    const differ = a.filter((c, i) => c !== b[i]).length
    expect(differ / a.length).toBeLessThan(0.002)
  })

  it('drop the holes other shapes fill: only holes onto transparency stay', () => {
    // Each shape is its outline, plus the window where it lies under it: the
    // paper and the panel both reach under the window, so both keep it open.
    const subs = Object.fromEntries(stacked.paths.map((p) => [p.fill, parsePath(p.d).length]))
    expect(subs).toEqual({ '#f5f0e6': 2, '#1e3c8c': 2, '#d23228': 1, '#ebaa28': 1, '#288c46': 1 })
  })

  it('lay the earlier shape under every edge, so no seam shows through', () => {
    // Where two colours meet, the one painted first covers both sides of the
    // edge; the later one's anti-aliased edge then blends with it alone, not
    // with whatever lies underneath both (a hairline seam).
    const shapes = stacked.paths.map((p) => polygons(p.d))
    const top = render(stacked)
    const rank = new Map(stacked.paths.map((p, i) => [p.fill, i]))
    let edges = 0
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++)
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const a = top[y * W + x]
          const b = top[(y + dy) * W + x + dx]
          if (!a || !b || a === b) continue
          // Only where each side is two pixels deep, so the points tested are clearly a's and b's.
          if (top[(y - dy) * W + x - dx] !== a || top[(y + 2 * dy) * W + x + 2 * dx] !== b) continue
          const under = shapes[Math.min(rank.get(a)!, rank.get(b)!)]
          // One pixel in from the edge on each side, clear of the fitted curve's wobble.
          const inA = inside(under, x + 0.5 - dx, y + 0.5 - dy)
          const inB = inside(under, x + 0.5 + 2 * dx, y + 0.5 + 2 * dy)
          edges++
          expect(inA && inB, `${a} | ${b} at ${x},${y}`).toBe(true)
        }
    expect(edges).toBeGreaterThan(100)
  })

  it('keep a hole that opens onto transparency', () => {
    const panel = stacked.paths.find((p) => p.fill === '#1e3c8c')!
    expect(parsePath(panel.d).length).toBeGreaterThan(1)
    // The window's centre stays empty.
    const shapes = stacked.paths.map((p) => polygons(p.d))
    expect(shapes.some((polys) => inside(polys, 69, 18))).toBe(false)
  })

  it('paint containers before what they contain', () => {
    const order = stacked.paths.map((p) => p.fill)
    expect(order.indexOf('#1e3c8c')).toBeLessThan(order.indexOf('#d23228'))
    expect(order.indexOf('#d23228')).toBeLessThan(order.indexOf('#ebaa28'))
  })
})

describe('stacked shapes around nested transparency', () => {
  // A red panel holding a blue square, holding a transparent window: the
  // window doesn't touch the panel, so only the depth check keeps it open.
  const w = 40
  const h = 40
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c = [245, 240, 230, 255]
      if (x >= 4 && x < 36 && y >= 4 && y < 36) c = [210, 50, 40, 255]
      if (x >= 12 && x < 28 && y >= 12 && y < 28) c = [30, 60, 140, 255]
      if (x >= 17 && x < 23 && y >= 17 && y < 23) c = [0, 0, 0, 0]
      px.set(c, (y * w + x) * 4)
    }
  const opts = { mode: 'palette' as const, palette: ['#f5f0e6', '#d23228', '#1e3c8c'], speckle: 0, tolerance: 0.5, cornerAngle: 45 }

  it('leave the window empty, as cut-out shapes do', () => {
    const cut = render(trace(px, w, h, opts))
    const stacked = render(trace(px, w, h, { ...opts, stacked: true }))
    expect(stacked[20 * w + 20]).toBe('')
    expect(stacked).toEqual(cut)
  })

  it('also when the hole is bordered by more than one colour', () => {
    // The square is blue, green and gold, so the panel's hole is walked along
    // chains in both directions; the window sits off the square's centre.
    const n = 48
    const many = new Uint8ClampedArray(n * n * 4)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let c = [245, 240, 230, 255]
        if (x >= 4 && x < 44 && y >= 4 && y < 44) c = [210, 50, 40, 255]
        if (x >= 12 && x < 36 && y >= 12 && y < 36) c = y >= 24 ? [235, 170, 40, 255] : x >= 24 ? [40, 140, 70, 255] : [30, 60, 140, 255]
        if (x >= 22 && x < 26 && y >= 18 && y < 22) c = [0, 0, 0, 0]
        many.set(c, (y * n + x) * 4)
      }
    const o = { ...opts, palette: [...opts.palette, '#288c46', '#ebaa28'] }
    const cut = trace(many, n, n, o)
    const stacked = trace(many, n, n, { ...o, stacked: true })
    expect(render(stacked)[20 * n + 23]).toBe('')
    expect(render(stacked)).toEqual(render(cut))
  })
})

describe('quantizePalette', () => {
  /** A smooth gradient with two flat patches: no histogram peaks to speak of. */
  function photoLike() {
    const px = new Uint8ClampedArray(64 * 64 * 4)
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) px.set([x * 4, y * 4, 128 + ((x + y) % 7), 255], (y * 64 + x) * 4)
    return px
  }

  it('returns the colours asked for, distinct, as hex', () => {
    const p = quantizePalette(photoLike(), 8)
    expect(p).toHaveLength(8)
    expect(new Set(p).size).toBe(8)
    for (const c of p) expect(c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('is deterministic', () => {
    expect(quantizePalette(photoLike(), 12)).toEqual(quantizePalette(photoLike(), 12))
  })

  it('returns fewer colours when the image has fewer', () => {
    const two = new Uint8ClampedArray(16 * 4 * 4)
    for (let i = 0; i < 16 * 4; i++) two.set(i % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4)
    expect(quantizePalette(two, 8).sort()).toEqual(['#0000ff', '#ff0000'])
  })

  it('takes at least one colour, even for 0 or NaN', () => {
    expect(quantizePalette(photoLike(), 0)).toHaveLength(1)
    expect(quantizePalette(photoLike(), NaN)).toHaveLength(1)
  })

  it('ignores transparent pixels', () => {
    const px = new Uint8ClampedArray(8 * 4)
    for (let i = 0; i < 8; i++) px.set(i < 4 ? [10, 200, 30, 255] : [250, 0, 250, 0], i * 4)
    expect(quantizePalette(px, 4)).toEqual(['#0ac81e'])
  })
})

describe('stacked flat art', () => {
  const area = (d: string) =>
    polygons(d).reduce((s, poly) => s + poly.reduce((a, p, i) => a + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0) / 2, 0)
  // Anti-aliased, as a renderer leaves flat art: each pixel's share of each shape, painted in order.
  const draw = (w: number, h: number, shapes: { inside: (x: number, y: number) => boolean; rgb: number[] }[]) => {
    const px = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let c = [245, 240, 230]
        for (const s of shapes) {
          let cov = 0
          for (let k = 0; k < 16; k++) if (s.inside(x + ((k % 4) + 0.5) / 4, y + (Math.floor(k / 4) + 0.5) / 4)) cov++
          c = c.map((v, i) => v + ((s.rgb[i] - v) * cov) / 16)
        }
        px.set([...c, 255], (y * w + x) * 4)
      }
    return px
  }
  const opts = { mode: 'palette' as const, palette: ['#f5f0e6', '#1e3c8c', '#ebaa28'], speckle: 2, tolerance: 0.75, cornerAngle: 60 }

  it('draw a disc partly behind a bar whole, behind it', () => {
    // A disc of radius 20 at (60, 28), half of it under a bar.
    const px = draw(100, 70, [
      { inside: (x, y) => Math.hypot(x - 60, y - 28) < 20, rgb: [235, 170, 40] },
      { inside: (x, y) => x >= 10 && x < 70 && y >= 20 && y < 50, rgb: [30, 60, 140] },
    ])
    const cut = trace(px, 100, 70, opts)
    const stacked = trace(px, 100, 70, { ...opts, stacked: true })
    const disc = stacked.paths.find((p) => p.fill === '#ebaa28')!
    expect(Math.abs(area(disc.d))).toBeGreaterThan(0.97 * Math.PI * 400)
    expect(Math.abs(area(disc.d))).toBeLessThan(1.03 * Math.PI * 400)
    // Behind: painted before the bar, so the picture is unchanged.
    const order = stacked.paths.map((p) => p.fill)
    expect(order.indexOf('#ebaa28')).toBeLessThan(order.indexOf('#1e3c8c'))
    const a = render(cut)
    const b = render(stacked)
    expect(a.filter((c, i) => c !== b[i]).length / a.length).toBeLessThan(0.002)
  })

  it('complete a square behind another at its hidden corner', () => {
    const px = draw(80, 80, [
      { inside: (x, y) => x >= 10 && x < 50 && y >= 10 && y < 50, rgb: [235, 170, 40] },
      { inside: (x, y) => x >= 30 && x < 70 && y >= 30 && y < 70, rgb: [30, 60, 140] },
    ])
    const stacked = trace(px, 80, 80, { ...opts, stacked: true })
    const back = stacked.paths.find((p) => p.fill === '#ebaa28')!
    expect(Math.abs(area(back.d))).toBeGreaterThan(0.98 * 1600)
    expect(Math.abs(area(back.d))).toBeLessThan(1.02 * 1600)
    expect(parsePath(back.d)[0].nodes.length).toBe(4)
  })

  it('paint the same picture as cut-out shapes, containers first', () => {
    const cut = render(trace(picture(), W, H, options))
    const result = trace(picture(), W, H, { ...options, stacked: true })
    const stacked = render(result)
    expect(cut.filter((c, i) => c !== stacked[i]).length / cut.length).toBeLessThan(0.002)
    const order = result.paths.map((p) => p.fill)
    expect(order.indexOf('#1e3c8c')).toBeLessThan(order.indexOf('#d23228'))
    expect(order.indexOf('#d23228')).toBeLessThan(order.indexOf('#ebaa28'))
  })
})
