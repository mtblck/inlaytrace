import { describe, expect, it } from 'vitest'
import { buildSvg, inksOf, layerFiles, normalizeHex, parseTrace, statsOf } from './svg'

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

describe('inks and edits', () => {
  const t = parseTrace(RAW)

  it('counts inks, most used first', () => {
    expect(inksOf(t)).toEqual([
      { hex: '#dc3c1e', count: 2 },
      { hex: '#fafaf5', count: 1 },
    ])
  })

  it('adds a viewBox so the output scales', () => {
    expect(buildSvg(t)).toContain('viewBox="0 0 64 32"')
  })

  it('recolours and hides without reordering paths', () => {
    const svg = buildSvg(t, { recolor: { '#dc3c1e': '#0000ff' }, hidden: ['#fafaf5'] })
    expect(svg).not.toContain('#fafaf5')
    expect(svg.match(/#0000ff/g)).toHaveLength(2)
    expect(svg.indexOf('M4,4')).toBeLessThan(svg.indexOf('M20,4'))
  })

  it('ignores an invalid recolour value', () => {
    expect(buildSvg(t, { recolor: { '#dc3c1e': 'red;}' }, hidden: [] })).toContain('#dc3c1e')
  })

  it('writes one file per visible ink, named by its shown colour', () => {
    const files = layerFiles(t, { recolor: { '#fafaf5': '#ffffff' }, hidden: [] }, 'logo')
    expect(files.map((f) => f.name)).toEqual(['logo-01-dc3c1e.svg', 'logo-02-ffffff.svg'])
    expect(statsOf(files[0].svg).paths).toBe(2)
    expect(files[1].svg).toContain('fill="#ffffff"')
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
