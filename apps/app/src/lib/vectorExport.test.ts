import { describe, expect, it } from 'vitest'
import { unzlibSync, strFromU8 } from 'fflate'
import { buildDxf, DXF_TOLERANCE, flattenCubic, buildEps, buildPdf, convert, pngPixels, withSize, type Drawable } from './vectorExport'

const drawing: Drawable = {
  width: 100,
  height: 50,
  background: '#ffffff',
  paths: [
    { d: 'M10 10L90 10L90 40L10 40Z', fill: '#ff0000' },
    { d: 'M50 5C60 5 60 15 50 15C40 15 40 5 50 5Z', fill: '#0000ff' },
  ],
}

describe('sizes', () => {
  it('converts between units', () => {
    expect(convert(96, 'px', 'in')).toBeCloseTo(1)
    expect(convert(1, 'in', 'mm')).toBeCloseTo(25.4)
    expect(convert(72, 'pt', 'px')).toBeCloseTo(96)
  })
  it('sets the root width and height once, keeping the viewBox', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50" viewBox="0 0 100 50"><path d="M0 0" width="3"/></svg>'
    const out = withSize(svg, { width: 50, height: 25, unit: 'mm' })
    expect(out).toMatch(/^<svg width="50mm" height="25mm" xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 100 50">/)
    expect(out).toContain('<path d="M0 0" width="3"/>') // only the root is touched
    expect(withSize('<svg viewBox="0 0 1 1"/>', { width: 10, height: 10, unit: 'px' })).toBe('<svg width="10" height="10" viewBox="0 0 1 1"/>')
  })
  it('works out PNG pixels from px × scale or a physical size at a dpi', () => {
    expect(pngPixels({ width: 100, height: 50, unit: 'px' }, 2, 300)).toEqual({ width: 200, height: 100 })
    expect(pngPixels({ width: 1, height: 0.5, unit: 'in' }, 2, 300)).toEqual({ width: 300, height: 150 })
  })
})

describe('PDF', () => {
  const pdf = buildPdf(drawing, { width: 100, height: 50, unit: 'mm' })
  const text = strFromU8(pdf, true)
  it('is a well-formed one-page PDF whose cross-reference table points at its objects', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true)
    const xref = Number(text.match(/startxref\n(\d+)/)![1])
    expect(text.slice(xref, xref + 4)).toBe('xref')
    const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]))
    expect(offsets).toHaveLength(5)
    offsets.forEach((o, i) => expect(text.startsWith(`${i + 1} 0 obj\n`, o)).toBe(true))
  })
  it('makes the page the export size, in points', () => {
    expect(text).toContain(`/MediaBox [0 0 ${((100 * 72) / 25.4).toFixed(3).replace(/0+$/, '')} ${((50 * 72) / 25.4).toFixed(3).replace(/0+$/, '')}]`)
  })
  it('draws every shape as a filled vector path, y flipped', () => {
    const start = text.indexOf('stream\n') + 7
    const end = text.indexOf('\nendstream')
    const content = strFromU8(unzlibSync(pdf.slice(start, end)))
    expect(content.match(/ rg$/gm)).toHaveLength(3) // background + two shapes
    expect(content.match(/^f$/gm)).toHaveLength(3)
    expect(content).toContain(' c') // the circle stays a curve
    const s = (100 * 72) / 25.4 / 100
    // (10, 10) in the drawing: x scaled, y measured from the bottom.
    expect(content).toContain(`${Math.round(10 * s * 1000) / 1000} ${Math.round((50 - 10) * s * 1000) / 1000} m`)
  })
})

describe('EPS', () => {
  it('has a bounding box and the same shapes', () => {
    const eps = buildEps(drawing, { width: 100, height: 50, unit: 'pt' })
    expect(eps.startsWith('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 100 50')).toBe(true)
    expect(eps.match(/setrgbcolor/g)).toHaveLength(3)
    expect(eps.match(/^fill$/gm)).toHaveLength(3)
    expect(eps).toContain('curveto')
    expect(eps).toContain('10 40 moveto')
  })
})

describe('centerline strokes', () => {
  const strokes: Drawable = { width: 100, height: 50, background: null, paths: [{ d: 'M10 10L90 40', fill: '#112233', stroke: 4 }] }
  it('are stroked, round-capped and open in a PDF, their width scaled with the page', () => {
    const pdf = buildPdf(strokes, { width: 200, height: 100, unit: 'pt' })
    const text = strFromU8(pdf, true)
    const content = strFromU8(unzlibSync(pdf.slice(text.indexOf('stream\n') + 7, text.indexOf('\nendstream'))))
    expect(content).toContain('RG 8 w 1 J 1 j') // 4 px at 2 pt a px
    expect(content.match(/^S$/gm)).toHaveLength(1)
    expect(content).not.toMatch(/^f$/m)
    expect(content).not.toMatch(/^h$/m) // an open stroke isn't closed
  })
  it('and in EPS', () => {
    const eps = buildEps(strokes, { width: 100, height: 50, unit: 'pt' })
    expect(eps).toContain('4 setlinewidth 1 setlinecap 1 setlinejoin')
    expect(eps).toMatch(/^stroke$/m)
  })
})

describe('DXF', () => {
  const dxf = buildDxf(drawing, { width: 200, height: 100, unit: 'mm' })
  const lines = dxf.trim().split('\n')
  const pairs = Array.from({ length: lines.length / 2 }, (_, i) => [Number(lines[i * 2]), lines[i * 2 + 1]] as const)
  it('is R12, one layer per colour, units in the header', () => {
    expect(lines.length % 2).toBe(0)
    expect(dxf).toContain('$ACADVER\n1\nAC1009')
    expect(dxf).toContain('$INSUNITS\n70\n4') // millimetres
    expect(pairs.filter(([c, v]) => c === 0 && v === 'LAYER')).toHaveLength(2)
    expect(dxf).toContain('INK_FF0000')
    expect(dxf).toContain('INK_0000FF')
    expect(lines[lines.length - 1]).toBe('EOF')
  })
  it('draws each outline as a closed polyline at the export size, y up', () => {
    expect(pairs.filter(([c, v]) => c === 0 && v === 'POLYLINE')).toHaveLength(2)
    // The rectangle's corner (10, 10) at 2 mm a unit, from the bottom: (20, 80).
    expect(dxf).toMatch(/VERTEX\n8\nINK_FF0000\n10\n20\n20\n80\n/)
  })
  it('flattens curves to within the stated tolerance', () => {
    // A quarter circle, radius 100: every point on the curve is within the tolerance of the polyline.
    const k = 0.5522847498 * 100
    const [a, b, c, d] = [{ x: 100, y: 0 }, { x: 100, y: k }, { x: k, y: 100 }, { x: 0, y: 100 }]
    const pts = [a]
    flattenCubic(a, b, c, d, DXF_TOLERANCE, pts)
    const toLine = (p: { x: number; y: number }) =>
      Math.min(
        ...pts.slice(1).map((q, i) => {
          const s = pts[i]
          const dx = q.x - s.x
          const dy = q.y - s.y
          const t = Math.max(0, Math.min(1, ((p.x - s.x) * dx + (p.y - s.y) * dy) / (dx * dx + dy * dy)))
          return Math.hypot(p.x - s.x - t * dx, p.y - s.y - t * dy)
        }),
      )
    let worst = 0
    for (let i = 0; i <= 400; i++) {
      const t = i / 400
      const u = 1 - t
      const p = { x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x, y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y }
      worst = Math.max(worst, toLine(p))
    }
    expect(worst).toBeLessThanOrEqual(DXF_TOLERANCE)
    expect(pts.length).toBeLessThan(64) // and not wastefully many
    // The DXF's own curve got split too.
    expect((dxf.slice(dxf.indexOf('8\nINK_0000FF\n66')).match(/VERTEX/g) ?? []).length).toBeGreaterThan(12)
  })
})
