import { describe, expect, it } from 'vitest'
import { arcsToCubics, importSvg } from './svgImport'
import { parsePath } from './pathdata'

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`
const nodes = (d: string) => parsePath(d).flatMap((s) => s.nodes)

describe('importing an SVG', () => {
  it('reads basic shapes as paths in the viewBox, colours as hex', () => {
    const { trace, notes } = importSvg(svg('<rect x="10" y="20" width="30" height="40" fill="red"/><circle cx="50" cy="50" r="10" style="fill: rgb(0, 128, 255)"/>', 'viewBox="5 5 100 100" width="200"'))
    expect(trace.width).toBe(100)
    expect(trace.paths.map((p) => p.fill)).toEqual(['#ff0000', '#0080ff'])
    // The viewBox's origin moves to 0, 0.
    expect(nodes(trace.paths[0].d)[0]).toMatchObject({ x: 5, y: 15 })
    expect(notes).toEqual([])
  })

  it('applies group and element transforms, and inherits fills', () => {
    const { trace } = importSvg(svg('<g fill="#00ff00" transform="translate(10 0) scale(2)"><rect width="5" height="5" transform="translate(1 1)"/></g>'))
    expect(trace.paths[0].fill).toBe('#00ff00')
    const xs = nodes(trace.paths[0].d).map((n) => n.x)
    expect(Math.min(...xs)).toBe(12)
    expect(Math.max(...xs)).toBe(22)
  })

  it('turns arcs into curves that pass through their ends and middle', () => {
    // A half circle of radius 10 from (0, 10) to (20, 10), bulging up through (10, 0).
    const d = arcsToCubics('M0 10A10 10 0 0 1 20 10')
    expect(d).toMatch(/^M0 10C/)
    const ns = nodes(d)
    expect(ns[ns.length - 1]).toMatchObject({ x: 20, y: 10 })
    expect(ns.some((n) => Math.abs(n.x - 10) < 1e-6 && Math.abs(n.y) < 1e-6)).toBe(true)
    // Run-together flags ("01") and relative arcs.
    expect(nodes(arcsToCubics('M0 0a5 5 0 0110 0')).pop()).toMatchObject({ x: 10, y: 0 })
  })

  it('rewrites an even-odd ring as nonzero: the hole turns the other way', () => {
    const { trace } = importSvg(svg('<path fill-rule="evenodd" d="M0 0H100V100H0ZM25 25H75V75H25Z"/>'))
    const subs = parsePath(trace.paths[0].d)
    const area = (s: (typeof subs)[number]) => s.nodes.reduce((a, n, i) => a + n.x * s.nodes[(i + 1) % s.nodes.length].y - s.nodes[(i + 1) % s.nodes.length].x * n.y, 0)
    expect(Math.sign(area(subs[0]))).toBe(-Math.sign(area(subs[1])))
  })

  it('keeps strokes as strokes, their width scaled by the transform', () => {
    const { trace } = importSvg(svg('<g transform="scale(2)"><line x1="0" y1="0" x2="10" y2="0" stroke="#123456" stroke-width="3"/></g>'))
    expect(trace.paths).toEqual([{ d: 'M0 0L20 0', fill: '#123456', stroke: 6 }])
  })

  it('says what it can’t keep, rather than dropping it silently', () => {
    const { trace, notes } = importSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff8800"/></linearGradient></defs>' +
          '<rect width="10" height="10" fill="url(#g)"/><text x="0" y="50">Hi</text><text>there</text><image href="x.png"/><use href="#g"/><rect width="5" height="5" opacity="0.5"/>',
      ),
    )
    expect(trace.paths[0].fill).toBe('#ff8800')
    expect(notes).toEqual(expect.arrayContaining(['gradient (drawn in its first colour)', '2 × text', 'image', '<use> reference', 'transparency (drawn opaque)']))
  })

  it('refuses something that isn’t an SVG', () => {
    expect(() => importSvg('<html><body>nope</body></html>')).toThrow(/isn’t an SVG/)
  })
})

describe('arc details', () => {
  it('reads minified flags that run into a decimal ("01.5.5")', () => {
    expect(nodes(arcsToCubics('M0 0a5 5 0 01.5.5')).pop()).toMatchObject({ x: 0.5, y: 0.5 })
  })
  it('gives S after an arc no reflected control point', () => {
    const d = arcsToCubics('M0 0A5 5 0 0 1 10 0S20 10 30 0')
    expect(d).toMatch(/C10 0 20 10 30 0$/)
  })
})
