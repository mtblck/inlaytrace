/**
 * Gradient fills from the trace to the exports: read from the tracer's SVG,
 * drawn and exported, moved with their shapes, saved, and flat once recoloured.
 */
import { describe, expect, it } from 'vitest'
import { strFromU8, unzlibSync } from 'fflate'
import { runTrace } from '../engine/run'
import { settingsFor, toTraceOptions } from '../engine/presets'
import { buildSvg, docFromTrace, inksOf, NO_INKS, recolorInk, ungroupPaths, groupPaths, visiblePaths } from './doc'
import { checkEdits } from './session'
import { parseTrace } from './svg'
import { transformShape, translate } from './transform'
import { buildEps, buildPdf, buildDxf, shadingOf } from './vectorExport'

/** A sky shading from blue to pale, with a flat cream square in it. */
function shaded() {
  const w = 160
  const h = 120
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = y / h
      const c = x >= 60 && x < 100 && y >= 40 && y < 80 ? [243, 237, 225] : [47 + 141 * t, 111 + 106 * t, 181 + 61 * t]
      px.set([...c.map(Math.round), 255], (y * w + x) * 4)
    }
  return { px, w, h }
}
const traced = (preset: 'illustration' | 'logo', shapes?: 'cutout') => {
  const { px, w, h } = shaded()
  return runTrace(px, w, h, toTraceOptions({ ...settingsFor(preset), ...(shapes ? { shapes } : {}) }))
}

describe('the trace', () => {
  it('Illustration draws the shade with a gradient; Logo and cut out draw it flat', () => {
    expect(traced('illustration')).toMatch(/<linearGradient /)
    expect(traced('logo')).not.toMatch(/Gradient/)
    expect(traced('illustration', 'cutout')).not.toMatch(/Gradient/)
  })

  it('is read with its gradient, its ink the average colour', () => {
    const t = parseTrace(traced('illustration'))
    expect(t.paths).toHaveLength(2)
    const sky = t.paths.find((p) => p.gradient)!
    expect(sky.gradient!.type).toBe('linear')
    expect(sky.fill).toMatch(/^#[0-9a-f]{6}$/)
    expect(inksOf(docFromTrace(t)).map((i) => i.hex)).toContain(sky.fill)
  })

  it('ignores a gradient it cannot trust', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">
<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000"/></linearGradient>
<linearGradient id="b" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"><stop offset="0" stop-color="red"/></linearGradient></defs>
<path d="M0 0L10 0L10 10Z" fill="url(#a) #102030"/>
<path d="M0 0L10 10L0 10Z" fill="url(#b)"/>
</svg>`
    const t = parseTrace(raw)
    // Bounding-box units, and a named colour: neither is read. The fallback colour still draws the first.
    expect(t.paths).toEqual([{ d: 'M0 0L10 0L10 10Z', fill: '#102030' }])
  })
})

describe('the document', () => {
  const doc = docFromTrace(parseTrace(traced('illustration')))
  const sky = doc.paths.find((p) => p.gradient)!

  it('exports the gradient, its colour as the fallback', () => {
    const svg = buildSvg(doc, NO_INKS)
    expect(svg).toMatch(new RegExp(`<defs>\\n<linearGradient id="gr-${sky.id}" gradientUnits="userSpaceOnUse"`))
    expect(svg).toContain(`fill="url(#gr-${sky.id}) ${sky.fill}"`)
  })

  it('recolouring the ink draws it flat', () => {
    const inks = recolorInk(NO_INKS, sky.fill, '#ff0000')
    expect(visiblePaths(doc, inks).find((p) => p.id === sky.id)).toEqual(expect.not.objectContaining({ gradient: expect.anything() }))
    expect(buildSvg(doc, inks)).not.toContain('Gradient')
  })

  it('moves the gradient with its shape', () => {
    const moved = transformShape(sky, translate(5, -3))
    expect(moved.gradient!.transform).toEqual([1, 0, 0, 1, 5, -3])
    const twice = transformShape({ ...sky, ...moved }, translate(1, 1))
    expect(twice.gradient!.transform).toEqual([1, 0, 0, 1, 6, -2])
    const svg = buildSvg({ ...doc, paths: doc.paths.map((p) => (p.id === sky.id ? { ...p, ...twice } : p)) })
    expect(svg).toContain('gradientTransform="matrix(1 0 0 1 6 -2)"')
  })

  it('keeps the gradient through grouping and ungrouping', () => {
    const ids = doc.paths.map((p) => p.id)
    const back = ungroupPaths(groupPaths(doc, ids), ids)
    expect(back.paths.find((p) => p.id === sky.id)!.gradient).toEqual(sky.gradient)
  })

  it('is saved and restored, and a tampered gradient is dropped', () => {
    const saved = JSON.parse(JSON.stringify({ inks: NO_INKS, doc, background: null }))
    expect(checkEdits(saved).doc!.paths.find((p) => p.id === sky.id)!.gradient).toEqual(sky.gradient)
    saved.doc.paths.find((p: { id: string }) => p.id === sky.id).gradient.stops[0].color = '"/><script>'
    const restored = checkEdits(saved).doc!.paths.find((p) => p.id === sky.id)!
    expect(restored.gradient).toBeUndefined()
    expect(restored.fill).toBe(sky.fill)
  })
})

describe('exports', () => {
  const doc = docFromTrace(parseTrace(traced('illustration')))
  const drawing = { width: doc.width, height: doc.height, background: null, paths: visiblePaths(doc, NO_INKS) }
  const size = { width: doc.width, height: doc.height, unit: 'px' as const }

  it('PDF paints a shading clipped to the shape', () => {
    const pdf = buildPdf(drawing, size)
    const text = strFromU8(pdf, true)
    expect(text).toMatch(/\/Resources << \/Shading << \/Sh0 << \/ShadingType 2 /)
    const stream = text.slice(text.indexOf('stream\n') + 7, text.indexOf('\nendstream'))
    const content = strFromU8(unzlibSync(pdf.slice(text.indexOf('stream\n') + 7, text.indexOf('stream\n') + 7 + stream.length)))
    expect(content).toMatch(/q\n[\s\S]*\nW n\n[-\d. ]+ cm\n\/Sh0 sh\nQ/)
  })

  it('EPS uses shfill, and says it needs PostScript 3', () => {
    const eps = buildEps(drawing, size)
    expect(eps).toContain('%%LanguageLevel: 3')
    expect(eps).toMatch(/clip newpath\n\[[-\d. ]+\] concat\n<< \/ShadingType 2 [^\n]* shfill/)
  })

  it('DXF puts the shape on its average colour’s layer', () => {
    const sky = doc.paths.find((p) => p.gradient)!
    expect(buildDxf(drawing, size)).toContain(`INK_${sky.fill.slice(1).toUpperCase()}`)
  })

  it('a shading holds its end colours before the first stop and after the last', () => {
    const s = shadingOf({ type: 'radial', cx: 5, cy: 5, r: 10, stops: [{ offset: 0.4, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] })
    expect(s).toContain('/ShadingType 3')
    expect(s).toContain('/Coords [5 5 0 5 5 10]')
    // Two pieces: red held from 0 to 0.4, then red to blue.
    expect(s).toContain('/Bounds [0.4]')
    expect(s).toContain('/C0 [1 0 0] /C1 [1 0 0]')
    expect(s).toContain('/C0 [1 0 0] /C1 [0 0 1]')
  })
})
