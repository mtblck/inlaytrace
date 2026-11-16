/**
 * The vector Eraser and Knife (#211) on the real paper.js core build, loaded
 * under jsdom as boolean.test.ts does. Areas are measured with paper.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type PaperNS from 'paper/dist/paper-core'
import { eraseDoc, knifeDoc, SLIVER_PX } from './cut'
import { scopeFor } from './mirror'
import { parsePath } from './pathdata'
import type { Doc } from './doc'

let paper: typeof PaperNS
beforeAll(async () => {
  const inert: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 1 : k === 'canvas' ? undefined : inert),
    apply: () => inert,
  })
  HTMLCanvasElement.prototype.getContext = (() => inert) as unknown as HTMLCanvasElement['getContext']
  const m = await import('paper/dist/paper-core')
  paper = ((m as unknown as { default?: typeof PaperNS }).default ?? m) as typeof PaperNS
})

type P = { area: number; length: number; bounds: { width: number; height: number; x: number; y: number }; children?: P[] }
const item = (d: string) => new (scopeFor(paper).CompoundPath)({ pathData: d, insert: false }) as unknown as P
const area = (d: string) => Math.abs(item(d).area)
const square = (x: number, y: number, s: number) => `M${x} ${y}L${x + s} ${y}L${x + s} ${y + s}L${x} ${y + s}Z`
// A 40 × 40 ring round a 20 × 20 hole: the inner square turns the other way.
const ring = 'M10 10L50 10L50 50L10 50ZM20 20L20 40L40 40L40 20Z'
const doc: Doc = {
  width: 100,
  height: 100,
  paths: [
    { id: 'bg', fill: '#ffffff', d: square(0, 0, 100) },
    { id: 'sq', fill: '#ff0000', group: 'g', d: square(60, 60, 30) },
    { id: 'ring', fill: '#0000ff', d: ring },
    { id: 'line', fill: '#000000', stroke: 2, d: 'M0 95L100 95' },
  ],
}
const ok = <T extends { error: string } | object>(r: T) => {
  if ('error' in r) throw new Error((r as { error: string }).error)
  return r as Exclude<T, { error: string }>
}
const ids = (d: Doc) => d.paths.map((p) => p.id)

describe('the Eraser', () => {
  it('rubs a band out of a shape, leaving the rest in its place', () => {
    const r = ok(eraseDoc(paper, doc, ['sq'], [{ x: 50, y: 75 }, { x: 100, y: 75 }], 10))
    expect(ids(r.doc)).toEqual(['bg', 'sq', 'ring', 'line'])
    // 900 less a 30 × 10 band: two pieces, one shape still.
    expect(area(r.doc.paths[1].d)).toBeCloseTo(600, 0)
    expect(r.doc.paths[1]).toMatchObject({ fill: '#ff0000', group: 'g' })
    expect(r.selected).toEqual(['sq'])
  })

  it('touches only the shapes it is given, and never a line', () => {
    const r = ok(eraseDoc(paper, doc, ['sq', 'line'], [{ x: 0, y: 95 }, { x: 100, y: 95 }, { x: 75, y: 50 }, { x: 75, y: 100 }], 4))
    expect(r.doc.paths.find((p) => p.id === 'line')!.d).toBe('M0 95L100 95')
    expect(r.doc.paths.find((p) => p.id === 'bg')!.d).toBe(doc.paths[0].d)
    expect(eraseDoc(paper, doc, ['ring'], [{ x: 70, y: 70 }], 4)).toHaveProperty('error')
  })

  it('deletes a shape it takes entirely', () => {
    const r = ok(eraseDoc(paper, doc, ['sq'], [{ x: 75, y: 55 }, { x: 75, y: 95 }], 40))
    expect(ids(r.doc)).toEqual(['bg', 'ring', 'line'])
    expect(r.selected).toEqual([])
  })

  it('leaves no sliver thinner than half a pixel along an edge it nearly took', () => {
    // A brush whose edge stops 0.2 px short of the square's side.
    const r = ok(eraseDoc(paper, doc, ['sq'], [{ x: 85.2, y: 40 }, { x: 85.2, y: 110 }], 10))
    const d = r.doc.paths.find((p) => p.id === 'sq')!.d
    expect(parsePath(d)).toHaveLength(1)
    const b = item(d).bounds
    expect(b.x + b.width).toBeCloseTo(80.2, 1)
    for (const c of item(d).children ?? []) expect(2 * Math.abs(c.area)).toBeGreaterThanOrEqual(SLIVER_PX * c.length)
  })
})

describe('the Knife', () => {
  it('cuts a shape it crosses into two that keep its colour, group and place', () => {
    const r = ok(knifeDoc(paper, doc, ['sq', 'bg'], { x: 55, y: 70 }, { x: 95, y: 70 }))
    expect(ids(r.doc).slice(0, 3)).toEqual(['bg', 'sq', expect.stringMatching(/^p/)])
    const [a, b] = [r.doc.paths[1], r.doc.paths[2]]
    expect(b).toMatchObject({ fill: '#ff0000', group: 'g' })
    expect([area(a.d), area(b.d)].sort((x, y) => x - y)).toEqual([expect.closeTo(300, 0), expect.closeTo(600, 0)])
    // The background, which the line doesn't cross right through, stays whole.
    expect(r.doc.paths[0].d).toBe(doc.paths[0].d)
  })

  it('cuts through a hole: a ring cut across comes apart in two halves', () => {
    const r = ok(knifeDoc(paper, doc, ['ring'], { x: 5, y: 30 }, { x: 55, y: 30 }))
    const halves = r.doc.paths.filter((p) => p.fill === '#0000ff')
    expect(halves).toHaveLength(2)
    for (const h of halves) expect(area(h.d)).toBeCloseTo(600, 0)
  })

  it('cuts every part of a compound shape it crosses, and only those', () => {
    // Two squares as one shape; the line crosses the left one only.
    const two: Doc = { ...doc, paths: [{ id: 'two', fill: '#00ff00', d: square(10, 10, 20) + square(60, 10, 20) }] }
    const r = ok(knifeDoc(paper, two, ['two'], { x: 20, y: 0 }, { x: 20, y: 40 }))
    const areas = r.doc.paths.map((p) => area(p.d)).sort((x, y) => x - y)
    // The right square, which the line misses, stays as it was with the shape's id; the left one is cut in two.
    expect(r.doc.paths).toHaveLength(3)
    expect(r.doc.paths[0].id).toBe('two')
    expect(area(r.doc.paths[0].d)).toBeCloseTo(400, 0)
    expect(areas).toEqual([expect.closeTo(200, 0), expect.closeTo(200, 0), expect.closeTo(400, 0)])
  })

  it('leaves a shape whole when the cut stops inside it', () => {
    expect(knifeDoc(paper, doc, ['sq'], { x: 50, y: 75 }, { x: 70, y: 75 })).toHaveProperty('error')
    expect(knifeDoc(paper, doc, ['sq'], { x: 70, y: 75 }, { x: 80, y: 75 })).toHaveProperty('error')
  })

  it('the pieces tile the shape exactly', () => {
    const r = ok(knifeDoc(paper, doc, ['sq'], { x: 50, y: 50 }, { x: 100, y: 100 }))
    const pieces = r.doc.paths.filter((p) => p.fill === '#ff0000')
    expect(pieces.reduce((n, p) => n + area(p.d), 0)).toBeCloseTo(900, 1)
  })
})
