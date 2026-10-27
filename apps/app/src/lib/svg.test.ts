import { describe, expect, it } from 'vitest'
import { normalizeHex, parseTrace, statsOf, withText } from './svg'

const RAW = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: visioncortex VTracer 1.0.0-alpha.4 -->
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="64" height="32">
<path d="M0,0L64,0L64,32L0,32Z" fill="#FAFAF5"/>
<path d="M4,4C8,4,8,8,4,8Z" fill="#DC3C1E"/>
<path d="M20,4L24,4L24,8Z" fill="#dc3c1e" transform="translate(1,2)"/>
<path d="M1,1Z" fill="url(#evil)"/>
<path d="M1,1Z&quot;/&gt;&lt;script&gt;" fill="#000000"/>
</svg>`

describe('parseTrace', () => {
  it('reads size and valid paths, normalising fills', () => {
    const t = parseTrace(RAW)
    expect(t.width).toBe(64)
    expect(t.height).toBe(32)
    expect(t.paths.map((p) => p.fill)).toEqual(['#fafaf5', '#dc3c1e', '#dc3c1e'])
    expect(t.paths[2].transform).toBe('translate(1,2)')
  })

  it('drops paths whose data or fill could carry markup', () => {
    const t = parseTrace(RAW)
    expect(t.paths.some((p) => p.d.includes('script'))).toBe(false)
  })
})

describe('centerline strokes', () => {
  it('are read as strokes: the colour from stroke, the width from stroke-width', () => {
    const t = parseTrace('<svg width="10" height="10"><path d="M1 1L9 9" fill="none" stroke="#123456" stroke-width="2.5" stroke-linecap="round"/><path d="M0 0L1 0L1 1Z" fill="#ff0000"/></svg>')
    expect(t.paths).toEqual([
      { d: 'M1 1L9 9', fill: '#123456', stroke: 2.5 },
      { d: 'M0 0L1 0L1 1Z', fill: '#ff0000' },
    ])
  })
  it('skip a stroke with no usable colour or width', () => {
    expect(parseTrace('<svg width="10" height="10"><path d="M1 1L9 9" fill="none" stroke="url(#x)" stroke-width="2"/></svg>').paths).toEqual([])
    expect(parseTrace('<svg width="10" height="10"><path d="M1 1L9 9" fill="none" stroke="#123456"/></svg>').paths).toEqual([])
  })
})

describe('helpers', () => {
  it('normalises hex', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex('blue')).toBeNull()
  })

  it('counts paths, nodes and bytes', () => {
    const s = statsOf('<svg><path d="M0,0L1,1C1,1,1,1,1,1Z"/></svg>')
    expect(s).toMatchObject({ paths: 1, nodes: 4 })
    expect(s.bytes).toBeGreaterThan(0)
  })
})

describe('recognised text on a trace', () => {
  it('goes on top, scaled from the image to the trace', () => {
    const trace = { width: 200, height: 100, paths: [{ d: 'M0 0L200 0L200 100Z', fill: '#ffffff' }] }
    const out = withText(trace, [{ d: 'M10 20Q15 10 20 20Z', fill: '#1D3557' }], 100)
    expect(out.paths).toHaveLength(2)
    expect(out.paths[1].fill).toBe('#1d3557')
    expect(out.paths[1].d).toMatch(/^M20 40C/)
    expect(withText(trace, [], 100)).toBe(trace)
  })
})
