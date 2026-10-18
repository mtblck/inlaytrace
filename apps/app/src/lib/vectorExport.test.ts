import { describe, expect, it } from 'vitest'
import { unzlibSync, strFromU8 } from 'fflate'
import { buildEps, buildPdf, convert, pngPixels, withSize, type Drawable } from './vectorExport'

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
