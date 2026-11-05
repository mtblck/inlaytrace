/**
 * Boolean ops (#207) on the real paper.js core build, loaded under jsdom the
 * way geometry.test.ts does it. Areas are measured with paper too, so each
 * check is about the shape that comes out, not the exact path text.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type PaperNS from 'paper/dist/paper-core'
import { booleanOp } from './boolean'
import { scopeFor } from './mirror'
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

const area = (d: string) => Math.abs((new (scopeFor(paper).CompoundPath)({ pathData: d, insert: false }) as unknown as { area: number }).area)
const square = (x: number, y: number, s: number) => `M${x} ${y}L${x + s} ${y}L${x + s} ${y + s}L${x} ${y + s}Z`

// Two 20×20 squares overlapping in a 10×10 corner, between two shapes left alone.
const doc: Doc = {
  width: 100,
  height: 100,
  paths: [
    { id: 'bg', fill: '#ffffff', d: square(0, 0, 100) },
    { id: 'a', fill: '#ff0000', group: 'g1', d: square(10, 10, 20) },
    { id: 'mid', fill: '#00ff00', d: square(80, 80, 5) },
    { id: 'b', fill: '#0000ff', d: square(20, 20, 20) },
    { id: 'top', fill: '#000000', d: square(90, 90, 5) },
  ],
}
const ok = (r: ReturnType<typeof booleanOp>) => {
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('boolean ops', () => {
  it('unites into one path in the back shape’s colour and group, painted where the top one was', () => {
    const r = ok(booleanOp(paper, doc, ['a', 'b'], 'unite'))
    // mid sat under b, so it stays under the result.
    expect(r.doc.paths.map((p) => p.id)).toEqual(['bg', 'mid', 'a', 'top'])
    expect(r.doc.paths[2]).toMatchObject({ fill: '#ff0000', group: 'g1' })
    expect(area(r.doc.paths[2].d)).toBeCloseTo(700, 0)
    expect(r.selected).toEqual(['a'])
  })

  it('subtracts the front shapes from the back one, leaving a hole when one sits inside', () => {
    const r = ok(booleanOp(paper, doc, ['a', 'b'], 'subtract'))
    expect(r.doc.paths.map((p) => p.id)).toEqual(['bg', 'a', 'mid', 'top'])
    expect(area(r.doc.paths.find((p) => p.id === 'a')!.d)).toBeCloseTo(300, 0)
    // Front shapes that miss the back one would just vanish: refused instead.
    expect(booleanOp(paper, doc, ['a', 'top'], 'subtract')).toHaveProperty('error')
    // A shape inside the background cuts a hole: the background keeps its outline and loses the inner area.
    const holed = ok(booleanOp(paper, doc, ['bg', 'mid'], 'subtract'))
    expect(area(holed.doc.paths[0].d)).toBeCloseTo(10000 - 25, 0)
    expect(holed.doc.paths.map((p) => p.id)).toEqual(['bg', 'a', 'b', 'top'])
  })

  it('intersects to the overlap, and says so when there isn’t one', () => {
    const r = ok(booleanOp(paper, doc, ['a', 'b'], 'intersect'))
    expect(area(r.doc.paths.find((p) => p.id === 'a')!.d)).toBeCloseTo(100, 0)
    expect(booleanOp(paper, doc, ['mid', 'top'], 'intersect')).toHaveProperty('error')
  })

  it('divides into pieces that don’t overlap, each in the colour on top there', () => {
    const r = ok(booleanOp(paper, doc, ['a', 'b'], 'divide'))
    const pieces = r.doc.paths.filter((p) => r.selected.includes(p.id))
    // a's uncovered L, then b whole (its part over a, and the rest).
    expect(pieces.map((p) => p.fill)).toEqual(['#ff0000', '#0000ff', '#0000ff'])
    expect(pieces.map((p) => Math.round(area(p.d))).sort((x, y) => x - y)).toEqual([100, 300, 300])
    expect(pieces[0].id).toBe('a')
    expect(new Set(pieces.map((p) => p.id)).size).toBe(3)
    // The pieces sit where the top shape was, the rest of the doc in order.
    expect(r.doc.paths.slice(0, 2).map((p) => p.id)).toEqual(['bg', 'mid'])
    expect(r.doc.paths.at(-1)!.id).toBe('top')
  })

  it('divides a shape cut in two into two pieces, each movable on its own', () => {
    const bar: Doc = { width: 100, height: 100, paths: [{ id: 'bar', fill: '#ff0000', d: 'M0 40L100 40L100 60L0 60Z' }, { id: 'sq', fill: '#0000ff', d: 'M40 30L60 30L60 70L40 70Z' }] }
    const r = ok(booleanOp(paper, bar, ['bar', 'sq'], 'divide'))
    const reds = r.doc.paths.filter((p) => p.fill === '#ff0000')
    expect(reds.map((p) => Math.round(area(p.d)))).toEqual([800, 800])
    // A ring keeps its hole: one piece, not an outline and a hole apart.
    const ring: Doc = { width: 100, height: 100, paths: [{ id: 'big', fill: '#ff0000', d: square(0, 0, 60) }, { id: 'small', fill: '#0000ff', d: square(20, 20, 20) }] }
    const rr = ok(booleanOp(paper, ring, ['big', 'small'], 'divide'))
    expect(rr.doc.paths.map((p) => Math.round(area(p.d)))).toEqual([3600 - 400, 400])
  })

  it('needs two filled shapes', () => {
    expect(booleanOp(paper, doc, ['a'], 'unite')).toHaveProperty('error')
    const lined: Doc = { ...doc, paths: doc.paths.map((p) => (p.id === 'b' ? { ...p, stroke: 2 } : p)) }
    expect(booleanOp(paper, lined, ['a', 'b'], 'unite')).toHaveProperty('error')
  })
})
