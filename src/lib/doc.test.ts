import { describe, expect, it } from 'vitest'
import { parseTrace, statsOf } from './svg'
import {
  buildSvg,
  deletePath,
  docFromTrace,
  inksOf,
  layerFiles,
  NO_INKS,
  recolorInk,
  removeInk,
  replacePath,
  restoreInk,
  visiblePaths,
} from './doc'
import { HISTORY_LIMIT, push, redo, startHistory, undo } from './history'

const RAW = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32">
<path d="M0,0L64,0L64,32L0,32Z" fill="#FAFAF5"/>
<path d="M4,4C8,4,8,8,4,8Z" fill="#DC3C1E"/>
<path d="M20,4L24,4L24,8Z" fill="#dc3c1e" transform="translate(1,2)"/>
</svg>`

const doc = docFromTrace(parseTrace(RAW))

describe('document', () => {
  it('gives every path an id and bakes transforms in', () => {
    expect(new Set(doc.paths.map((p) => p.id)).size).toBe(3)
    expect(doc.paths.every((p) => /^p\d+$/.test(p.id))).toBe(true)
    expect(doc.paths[2].d).toBe('M21 6L25 6L25 10Z')
  })

  it('counts inks, most used first', () => {
    expect(inksOf(doc)).toEqual([
      { hex: '#dc3c1e', count: 2 },
      { hex: '#fafaf5', count: 1 },
    ])
  })

  it('adds a viewBox so the output scales', () => {
    expect(buildSvg(doc)).toContain('viewBox="0 0 64 32"')
  })

  it('never writes markup from an unchecked d, fill or id', () => {
    const evil = {
      ...doc,
      paths: [
        { id: 'p1', d: 'M0 0Z"/><script>', fill: '#000000' },
        { id: 'x" onload="', d: 'M0 0L1 1Z', fill: '#000000' },
        { id: 'p3', d: 'M0 0L1 1Z', fill: '#000000' },
      ],
    }
    const svg = buildSvg(evil, { recolor: { '#000000': 'red;}' }, removed: [] })
    expect(svg).not.toContain('script')
    expect(svg).not.toContain('onload')
    expect(statsOf(svg).paths).toBe(1)
    expect(svg).toContain('fill="#000000"') // invalid recolour ignored
  })
})

describe('remove and replace', () => {
  it('recolours without reordering paths', () => {
    const svg = buildSvg(doc, recolorInk(NO_INKS, '#dc3c1e', '#0000FF'))
    expect(svg.match(/#0000ff/g)).toHaveLength(2)
    expect(svg.indexOf('M4,4')).toBeLessThan(svg.indexOf('M21'))
  })

  it('removing the background leaves nothing behind the shapes', () => {
    const svg = buildSvg(doc, removeInk(NO_INKS, '#fafaf5'))
    expect(svg).not.toContain('#fafaf5')
    expect(statsOf(svg).paths).toBe(2)
    // No background rect, style or fill on the root: transparent in any viewer.
    expect(svg).not.toMatch(/<rect|style=|<svg[^>]*fill=/)
  })

  it('replace with transparent is the same as remove', () => {
    expect(recolorInk(NO_INKS, '#fafaf5', null)).toEqual(removeInk(NO_INKS, '#fafaf5'))
  })

  it('replacing a removed ink brings it back in the new colour', () => {
    const inks = recolorInk(removeInk(NO_INKS, '#fafaf5'), '#fafaf5', '#ffffff')
    expect(inks.removed).toEqual([])
    expect(visiblePaths(doc, inks)[0].fill).toBe('#ffffff')
  })

  it('restore undoes both a replace and a remove', () => {
    const inks = removeInk(recolorInk(NO_INKS, '#dc3c1e', '#000000'), '#fafaf5')
    expect(restoreInk(restoreInk(inks, '#dc3c1e'), '#fafaf5')).toEqual(NO_INKS)
  })

  it('writes one layer per remaining ink, named by its shown colour', () => {
    const files = layerFiles(doc, removeInk(recolorInk(NO_INKS, '#fafaf5', '#ffffff'), '#dc3c1e'), 'logo')
    expect(files.map((f) => f.name)).toEqual(['logo-01-ffffff.svg'])
    expect(files[0].svg).toContain('fill="#ffffff"')
  })
})

describe('background', () => {
  it('sits behind every shape and is the first element', () => {
    const svg = buildSvg(doc, NO_INKS, undefined, '#FFAA00')
    expect(svg.indexOf('<rect')).toBeLessThan(svg.indexOf('<path'))
    expect(svg).toContain('<rect width="64" height="32" fill="#ffaa00"/>')
  })

  it('is left out when transparent, and malformed colours are ignored', () => {
    expect(buildSvg(doc)).not.toContain('<rect')
    expect(buildSvg(doc, NO_INKS, undefined, 'red;}')).not.toContain('<rect')
  })

  it('is its own layer in the zip, first', () => {
    const files = layerFiles(doc, NO_INKS, 'logo', '#ffffff')
    expect(files[0].name).toBe('logo-00-background-ffffff.svg')
    expect(files[0].svg).toContain('<rect')
    expect(files[0].svg).not.toContain('<path')
    expect(files.slice(1).every((f) => !f.svg.includes('<rect'))).toBe(true)
  })
})

describe('geometry edits', () => {
  it('replace and delete touch only the named path', () => {
    const id = doc.paths[1].id
    const next = replacePath(doc, id, 'M0 0L2 2Z')
    expect(next.paths[1].d).toBe('M0 0L2 2Z')
    expect(next.paths[0]).toBe(doc.paths[0])
    expect(deletePath(next, id).paths.map((p) => p.id)).toEqual([doc.paths[0].id, doc.paths[2].id])
  })
})

describe('undo and redo', () => {
  it('steps back and forward through snapshots', () => {
    let h = startHistory('a')
    h = push(h, 'b')
    h = push(h, 'c')
    h = undo(h)
    expect(h.present).toBe('b')
    h = undo(h)
    expect(h.present).toBe('a')
    h = undo(h) // nothing further back
    expect(h.present).toBe('a')
    h = redo(redo(h))
    expect(h.present).toBe('c')
  })

  it('a new edit after undo drops the redo branch', () => {
    let h = push(push(startHistory(1), 2), 3)
    h = push(undo(h), 4)
    expect(h.future).toEqual([])
    expect(redo(h).present).toBe(4)
  })

  it('coalesces a burst of same-keyed edits into one step', () => {
    let h = startHistory(0)
    for (let i = 1; i <= 30; i++) h = push(h, i, 'drag-1')
    expect(h.present).toBe(30)
    expect(undo(h).present).toBe(0)
    // A new key starts a new step.
    h = push(h, 31, 'drag-2')
    expect(undo(h).present).toBe(30)
  })

  it('caps the stack', () => {
    let h = startHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 50; i++) h = push(h, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    for (let i = 0; i < 500; i++) h = undo(h)
    expect(h.present).toBe(50)
  })
})
