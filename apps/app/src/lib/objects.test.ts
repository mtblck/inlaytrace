import { describe, expect, it } from 'vitest'
import { NO_INKS, type Doc, type DocPath } from './doc'
import { findObjects, groupByObject, objectFiles } from './objects'

const rect = (id: string, x: number, y: number, w: number, h: number, extra: Partial<DocPath> = {}): DocPath => ({
  id,
  fill: '#123456',
  d: `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`,
  ...extra,
})

// A sheet of three icons on a white background: one of two shapes sharing an edge (as Inlay traces them),
// one with a shape stacked inside another (as Poster does), and one of a single shape.
const sheet: Doc = {
  width: 200,
  height: 60,
  paths: [
    rect('bg', 0, 0, 200, 60, { fill: '#ffffff' }),
    rect('a1', 10, 10, 20, 40),
    rect('a2', 30, 10, 20, 40, { fill: '#ff0000' }),
    rect('b1', 80, 10, 40, 40),
    rect('b2', 90, 20, 10, 10, { fill: '#00ff00' }),
    rect('c', 150, 10, 40, 40),
  ],
}

describe('objects', () => {
  it('finds each icon on a sheet, leaving out the background', () => {
    expect(findObjects(sheet, NO_INKS)).toEqual([['a1', 'a2'], ['b1', 'b2'], ['c']])
  })

  it('keeps the letters of a word, and the dot of an i, as one object', () => {
    const word: Doc = {
      width: 200,
      height: 100,
      paths: [rect('l1', 10, 20, 20, 40), rect('l2', 34, 20, 20, 40), rect('l3', 58, 30, 6, 30), rect('dot', 58, 22, 6, 5), rect('far', 150, 20, 20, 40)],
    }
    expect(findObjects(word, NO_INKS)).toEqual([['l1', 'l2', 'l3', 'dot'], ['far']])
  })

  it('joins lines that cross or meet within their width, and leaves removed inks out', () => {
    const lines: Doc = {
      width: 100,
      height: 100,
      paths: [
        { id: 'h', fill: '#000000', stroke: 4, d: 'M10 10L40 10' },
        { id: 'v', fill: '#000000', stroke: 4, d: 'M25 13L25 40' },
        { id: 'apart', fill: '#000000', stroke: 4, d: 'M80 80L95 95' },
        rect('gone', 20, 20, 10, 10, { fill: '#ff0000' }),
      ],
    }
    expect(findObjects(lines, { recolor: {}, removed: ['#ff0000'] })).toEqual([['h', 'v'], ['apart']])
  })

  it('groups each object once, and doing it again changes nothing', () => {
    const { doc, objects } = groupByObject(sheet, NO_INKS)
    expect(objects).toBe(3)
    const g = (id: string) => doc.paths.find((p) => p.id === id)!.group
    expect(g('a1')).toBeTruthy()
    expect(g('a2')).toBe(g('a1'))
    expect(g('b2')).toBe(g('b1'))
    expect(g('b1')).not.toBe(g('a1'))
    expect(g('c')).toBeUndefined()
    expect(g('bg')).toBeUndefined()
    // The picture is unchanged: nothing moved past a shape it overlaps.
    expect(doc.paths.map((p) => p.id)).toEqual(sheet.paths.map((p) => p.id))
    expect(groupByObject(doc, NO_INKS).doc).toBe(doc)
  })

  it('writes each object as its own SVG, cropped to it', () => {
    const files = objectFiles(sheet, NO_INKS, 'icons')
    expect(files.map((f) => f.name)).toEqual(['icons-object-01.svg', 'icons-object-02.svg', 'icons-object-03.svg'])
    expect(files[1].svg).toContain('viewBox="80 10 40 40"')
    expect(files[1].svg).toContain('width="40" height="40"')
    expect(files[1].svg.match(/<path/g)).toHaveLength(2)
    expect(files[1].svg).not.toContain('#ffffff')
  })
})
