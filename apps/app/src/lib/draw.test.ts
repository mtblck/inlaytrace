import { describe, expect, it } from 'vitest'
import { addShape, dragBox, ellipsePath, lineEnd, penDrag, penPath, polygonPath, rectPath, shapePath, SHAPE_DEFAULT } from './draw'
import type { Doc } from './doc'
import { parsePath } from './pathdata'

const nodesOf = (d: string) => parsePath(d)[0].nodes
const xy = (d: string) => nodesOf(d).map((n) => [n.x, n.y])

describe('dragBox', () => {
  it('spans the drag either way round', () => {
    expect(dragBox({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, w: 10, h: 15 })
  })
  it('⇧ squares it on the longer side, toward the pointer', () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 0, y: 14 }, { square: true })).toEqual({ x: 0, y: 10, w: 10, h: 10 })
  })
  it('⌥ draws it from the start as the centre', () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 14, y: 7 }, { fromCentre: true })).toEqual({ x: 6, y: 7, w: 8, h: 6 })
  })
})

describe('the Shape tool', () => {
  it('draws a rectangle clockwise from the top left, closed', () => {
    const d = rectPath({ x: 0, y: 0, w: 10, h: 5 })
    expect(parsePath(d)[0].closed).toBe(true)
    expect(xy(d)).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]])
  })
  it('rounds corners with two nodes each, the radius capped at half the short side', () => {
    const d = rectPath({ x: 0, y: 0, w: 10, h: 4 }, 9)
    const ns = nodesOf(d)
    expect(ns).toHaveLength(8)
    expect([ns[0].x, ns[0].y]).toEqual([2, 0])
    expect([ns[2].x, ns[2].y]).toEqual([10, 2])
  })
  it('draws an ellipse as four smooth nodes on the box', () => {
    const ns = nodesOf(ellipsePath({ x: 0, y: 0, w: 20, h: 10 }))
    expect(ns.map((n) => [n.x, n.y])).toEqual([[10, 0], [20, 5], [10, 10], [0, 5]])
    for (const n of ns) expect(n.in && n.out).toBeTruthy()
    // The top node's handles are level and reach the quarter-circle distance.
    expect(ns[0].out!.x - 10).toBeCloseTo(10 * 0.5523, 1)
    expect(ns[0].out!.y).toBe(0)
  })
  it('draws a polygon with a corner at the top, sides clamped', () => {
    const d = polygonPath({ x: 0, y: 0, w: 10, h: 10 }, 6)
    expect(nodesOf(d)).toHaveLength(6)
    expect(xy(d)[0]).toEqual([5, 0])
    expect(nodesOf(polygonPath({ x: 0, y: 0, w: 10, h: 10 }, 1))).toHaveLength(3)
    expect(nodesOf(polygonPath({ x: 0, y: 0, w: 10, h: 10 }, 99))).toHaveLength(24)
  })
  it('⇧ holds a line to the nearest 45°', () => {
    const e = lineEnd({ x: 0, y: 0 }, { x: 10, y: 1 }, true)
    expect(e.y).toBeCloseTo(0)
    expect(e.x).toBeCloseTo(Math.hypot(10, 1))
    const f = lineEnd({ x: 0, y: 0 }, { x: 10, y: 9 }, true)
    expect(f.x).toBeCloseTo(f.y)
  })
  it('draws an open line and drops a drag too small to keep', () => {
    const d = shapePath({ ...SHAPE_DEFAULT, kind: 'line' }, { x: 0, y: 0 }, { x: 5, y: 5 })!
    expect(parsePath(d)[0].closed).toBe(false)
    expect(xy(d)).toEqual([[0, 0], [5, 5]])
    expect(shapePath(SHAPE_DEFAULT, { x: 0, y: 0 }, { x: 0.5, y: 30 })).toBeNull()
    expect(shapePath({ ...SHAPE_DEFAULT, kind: 'line' }, { x: 0, y: 0 }, { x: 0.2, y: 0.2 })).toBeNull()
  })
})

describe('the Pen', () => {
  it('a click is a corner, a drag a smooth node with mirrored handles', () => {
    const ns = nodesOf(penPath([{ x: 0, y: 0, out: null }, penDrag({ x: 10, y: 0 }, { x: 14, y: 3 }), { x: 10, y: 10, out: null }], true))
    expect(ns[0].in).toBeNull()
    expect(ns[0].out).toBeNull()
    expect(ns[1].out).toEqual({ x: 14, y: 3 })
    expect(ns[1].in).toEqual({ x: 6, y: -3 })
  })
  it('an open path has no handle reaching past its ends', () => {
    const subs = parsePath(penPath([penDrag({ x: 0, y: 0 }, { x: 3, y: 3 }), penDrag({ x: 10, y: 0 }, { x: 13, y: 3 })], false))
    expect(subs[0].closed).toBe(false)
    expect(subs[0].nodes[0].in).toBeNull()
    expect(subs[0].nodes[0].out).toEqual({ x: 3, y: 3 })
    expect(subs[0].nodes[1].in).toEqual({ x: 7, y: -3 })
    expect(subs[0].nodes[1].out).toBeNull()
  })
})

describe('addShape', () => {
  const doc: Doc = { width: 10, height: 10, paths: [{ id: 'a', d: 'M0 0', fill: '#000000' }, { id: 'g1', d: 'M0 0', fill: '#000000', group: 'g' }, { id: 'g2', d: 'M0 0', fill: '#000000', group: 'g' }, { id: 'z', d: 'M0 0', fill: '#000000' }] } as Doc
  it('goes on top with nothing selected, a stroke only when asked', () => {
    const { doc: out, id } = addShape(doc, 'M1 1', '#ff0000', null)
    expect(out.paths.at(-1)).toEqual({ id, d: 'M1 1', fill: '#ff0000' })
    expect(addShape(doc, 'M1 1', '#ff0000', 3).doc.paths.at(-1)!.stroke).toBe(3)
  })
  it('goes just above the topmost selected shape, past the rest of its group', () => {
    expect(addShape(doc, 'M1 1', '#ff0000', null, ['a']).doc.paths.map((p) => p.id).indexOf('a')).toBe(0)
    const ids = addShape(doc, 'M1 1', '#ff0000', null, ['g1', 'a']).doc.paths.map((p) => p.id)
    expect(ids.slice(0, 3)).toEqual(['a', 'g1', 'g2'])
    expect(ids[4]).toBe('z')
  })
})
