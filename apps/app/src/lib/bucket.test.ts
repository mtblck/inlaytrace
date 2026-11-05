/** The paint bucket (#193) on the real paper.js core build, loaded under jsdom as boolean.test.ts does. */
import { beforeAll, describe, expect, it } from 'vitest'
import type PaperNS from 'paper/dist/paper-core'
import { bucketFill } from './bucket'
import { scopeFor } from './mirror'
import { NO_INKS, type Doc } from './doc'

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
const square = (x: number, y: number, s: number, cw = true) =>
  cw ? `M${x} ${y}L${x + s} ${y}L${x + s} ${y + s}L${x} ${y + s}Z` : `M${x} ${y}L${x} ${y + s}L${x + s} ${y + s}L${x + s} ${y}Z`

// A line drawing as Line art traces it: a square ring of ink (outline and hole), and a dot inside it.
const doc: Doc = {
  width: 100,
  height: 100,
  paths: [
    { id: 'ring', fill: '#000000', d: `${square(20, 20, 60)} ${square(25, 25, 50, false)}` },
    { id: 'dot', fill: '#000000', d: square(45, 45, 10) },
  ],
}
const all = new Set(['ring', 'dot'])
const none = new Set<string>()
const ok = (r: ReturnType<typeof bucketFill>) => {
  if ('error' in r) throw new Error(r.error)
  return r
}

describe('paint bucket', () => {
  it('fills the paper a line encloses, at the back, round anything inside it', () => {
    const r = ok(bucketFill(paper, doc, NO_INKS, all, none, { x: 30, y: 30 }, '#ffcc00'))
    expect(r.added).toBe(true)
    expect(r.doc.paths[0]).toMatchObject({ id: r.id, fill: '#ffcc00' })
    expect(r.doc.paths.slice(1).map((p) => p.id)).toEqual(['ring', 'dot'])
    // The ring's hole, less the dot: the edges are the lines' own.
    expect(area(r.doc.paths[0].d)).toBeCloseTo(50 * 50 - 10 * 10, 0)
  })

  it('fills the outside too, up to the frame', () => {
    const r = ok(bucketFill(paper, doc, NO_INKS, all, none, { x: 5, y: 5 }, '#00aaff'))
    expect(area(r.doc.paths[0].d)).toBeCloseTo(100 * 100 - 60 * 60, 0)
  })

  it('recolours a shape you click on, the topmost one there', () => {
    const r = ok(bucketFill(paper, doc, NO_INKS, all, none, { x: 50, y: 50 }, '#ff0000'))
    expect(r).toMatchObject({ id: 'dot', added: false })
    expect(r.doc.paths.map((p) => p.fill)).toEqual(['#000000', '#ff0000'])
    expect(bucketFill(paper, r.doc, NO_INKS, all, none, { x: 50, y: 50 }, '#ff0000')).toHaveProperty('error')
  })

  it('leaves a locked shape its colour', () => {
    expect(bucketFill(paper, doc, NO_INKS, all, new Set(['dot']), { x: 50, y: 50 }, '#ff0000')).toHaveProperty('error')
  })

  it('goes through a hidden shape, and fills on under it', () => {
    const r = ok(bucketFill(paper, doc, NO_INKS, new Set(['ring']), none, { x: 50, y: 50 }, '#00ff00'))
    expect(r.added).toBe(true)
    expect(area(r.doc.paths[0].d)).toBeCloseTo(50 * 50, 0)
  })

  it('steps off a colour that has been replaced, and ignores removed colours’ shapes', () => {
    const inks = { recolor: { '#ffcc00': '#123456' }, removed: [] }
    expect(ok(bucketFill(paper, doc, inks, all, none, { x: 30, y: 30 }, '#ffcc00')).doc.paths[0].fill).toBe('#ffcc01')
    // With the ink removed, nothing is drawn: the whole frame is one area.
    const gone = ok(bucketFill(paper, doc, { recolor: {}, removed: ['#000000'] }, all, none, { x: 30, y: 30 }, '#ffcc00'))
    expect(area(gone.doc.paths[0].d)).toBeCloseTo(10000, 0)
    expect(bucketFill(paper, doc, NO_INKS, all, none, { x: 150, y: 30 }, '#ffcc00')).toHaveProperty('error')
  })
})
