/**
 * The two pieces of geometry the editor relies on: path data that survives a
 * round trip without drifting, and mirroring that produces one seamless,
 * symmetric shape. Mirror runs the real paper.js core build, the same module
 * the app lazy-loads.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type PaperNS from 'paper/dist/paper-core'
import { deleteNode, moveNode, parsePath, serializePath } from './pathdata'
import { mirrorDoc, centreAxis, centreTurn, likelyAxis } from './mirror'
import type { Symmetry } from 'inlaytrace'
import type { Doc } from './doc'

// paper.js asks for a 2D context at import time for feature detection only;
// the booleans never draw. jsdom has no canvas implementation, so hand it an
// inert one. Browsers use their real canvas.
let paper: typeof PaperNS
beforeAll(async () => {
  // Callable, chainable, and 1 when used as a number (paper reads pixel ratios).
  const inert: unknown = new Proxy(function () {}, {
    get: (_t, k) => (k === Symbol.toPrimitive ? () => 1 : k === 'canvas' ? undefined : inert),
    apply: () => inert,
  })
  HTMLCanvasElement.prototype.getContext = (() => inert) as unknown as HTMLCanvasElement['getContext']
  const m = await import('paper/dist/paper-core')
  paper = ((m as unknown as { default?: typeof PaperNS }).default ?? m) as typeof PaperNS
})

// A real VTracer path (relative cubics, closed by curving back onto its start).
const TRACED = 'M41.7,14.11c23.75,14.64,4.6,49.2-19.5,35.92C.32,37.97,17.05,4.01,41.7,14.11Z'

const points = (d: string) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)

describe('path data', () => {
  it('round-trips without drift', () => {
    const once = serializePath(parsePath(TRACED))
    let d = once
    for (let i = 0; i < 20; i++) d = serializePath(parsePath(d))
    expect(d).toBe(once) // idempotent after the first pass
    // The first pass only converts relative → absolute; the curve itself is unchanged.
    const subs = parsePath(TRACED)
    expect(subs).toHaveLength(1)
    expect(subs[0].closed).toBe(true)
    expect(subs[0].nodes[0]).toMatchObject({ x: 41.7, y: 14.11 })
    // Closing exactly onto the start point folds the end node into the first.
    expect(subs[0].nodes).toHaveLength(2)
  })

  it('moves an anchor with its handles, or a handle on its own', () => {
    const subs = parsePath('M0 0C10 0 20 10 20 20L0 20Z')
    const moved = moveNode(subs, { sub: 0, index: 1 }, 'anchor', { x: 30, y: 25 })
    expect(moved[0].nodes[1]).toMatchObject({ x: 30, y: 25, in: { x: 30, y: 15 } })
    const handle = moveNode(subs, { sub: 0, index: 0 }, 'out', { x: 5, y: -5 })
    expect(handle[0].nodes[0].out).toEqual({ x: 5, y: -5 })
    expect(serializePath(handle)).toBe('M0 0C5 -5 20 10 20 20L0 20Z')
  })

  it('deletes a node and drops subpaths that collapse', () => {
    const subs = parsePath('M0 0L10 0L10 10ZM50 50L60 50Z')
    const one = deleteNode(subs, { sub: 0, index: 1 })
    expect(serializePath(one)).toBe('M0 0L10 10ZM50 50L60 50Z')
    expect(deleteNode(subs, { sub: 1, index: 0 })).toHaveLength(1)
  })
})

describe('mirror', () => {
  // An off-centre blob that crosses the vertical centre line (x = 50), plus a
  // small square entirely on the discarded right side.
  const doc: Doc = {
    width: 100,
    height: 100,
    paths: [
      { id: 'blob', fill: '#000000', d: 'M30 20C45 10 60 15 62 40C64 60 50 80 35 75C20 70 15 35 30 20Z' },
      { id: 'right', fill: '#ff0000', d: 'M80 80L90 80L90 90L80 90Z' },
    ],
  }

  it('keeps the left half, reflects it, and merges across the axis', () => {
    const out = mirrorDoc(paper, doc, centreAxis(doc, 'vertical', 'start'))
    // The square lived only on the discarded side, so it is gone.
    expect(out.paths.map((p) => p.id)).toEqual(['blob'])
    const subs = parsePath(out.paths[0].d)
    // One seamless shape, not two halves meeting at the axis.
    expect(subs).toHaveLength(1)
    const xs = points(out.paths[0].d).filter((_, i) => i % 2 === 0)
    // Its extent is symmetric about x = 50.
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(100, 1)
    // And every node has a mirror twin.
    const nodes = subs[0].nodes.map((n) => `${Math.round(n.x * 10) / 10},${Math.round(n.y * 10) / 10}`)
    for (const n of subs[0].nodes) {
      const twin = `${Math.round((100 - n.x) * 10) / 10},${Math.round(n.y * 10) / 10}`
      expect(nodes).toContain(twin)
    }
  })

  it('keeps the right half when asked, and mirrors horizontally too', () => {
    const right = mirrorDoc(paper, doc, centreAxis(doc, 'vertical', 'end'))
    expect(right.paths.map((p) => p.id).sort()).toEqual(['blob', 'right'])
    const top = mirrorDoc(paper, doc, centreAxis(doc, 'horizontal', 'start'))
    const ys = points(top.paths[0].d).filter((_, i) => i % 2 === 1)
    expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(100, 1)
  })

  it('preserves paint order and fills', () => {
    const out = mirrorDoc(paper, doc, centreAxis(doc, 'vertical', 'end'))
    expect(out.paths.map((p) => p.fill)).toEqual(['#000000', '#ff0000'])
  })
  it('mirrors a gradient with its shape: two halves, the copy with its gradient reflected', () => {
    const gradient = { type: 'linear' as const, x1: 0, y1: 0, x2: 100, y2: 0, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] }
    const shaded: Doc = { ...doc, paths: [{ ...doc.paths[0], gradient }] }
    const out = mirrorDoc(paper, shaded, centreAxis(shaded, 'vertical', 'start'))
    expect(out.paths).toHaveLength(2)
    expect(out.paths[0]).toMatchObject({ id: 'blob', gradient })
    expect(out.paths[1].id).not.toBe('blob')
    expect(out.paths[1].gradient!.transform).toEqual([-1, 0, 0, 1, 100, 0])
    const xs = (d: string) => points(d).filter((_, i) => i % 2 === 0)
    expect(Math.max(...xs(out.paths[0].d))).toBeCloseTo(50, 1)
    expect(Math.min(...xs(out.paths[1].d))).toBeCloseTo(50, 1)
  })
})

describe('turn', () => {
  // A blob above the centre, crossing into the next slice, and a square low
  // down, outside the kept (top) slice.
  const doc: Doc = {
    width: 100,
    height: 100,
    paths: [
      { id: 'blob', fill: '#000000', d: 'M45 15C55 10 70 20 66 35C62 48 50 52 44 40C38 30 38 18 45 15Z' },
      { id: 'low', fill: '#ff0000', d: 'M45 85L55 85L55 95L45 95Z' },
    ],
  }
  const nodes = (d: string) => parsePath(d).flatMap((s) => s.nodes.map((n) => ({ x: n.x, y: n.y })))

  for (const order of [2, 3, 5]) {
    it(`repeats the top slice ${order} times, as one shape per path`, () => {
      const out = mirrorDoc(paper, doc, centreTurn(doc, order))
      expect(out.paths.map((p) => p.id)).toEqual(['blob'])
      // Every node, turned by one step about the centre, lands on another node.
      const ns = nodes(out.paths[0].d)
      const t = (2 * Math.PI) / order
      for (const n of ns) {
        const x = 50 + (n.x - 50) * Math.cos(t) - (n.y - 50) * Math.sin(t)
        const y = 50 + (n.x - 50) * Math.sin(t) + (n.y - 50) * Math.cos(t)
        expect(Math.min(...ns.map((m) => Math.hypot(m.x - x, m.y - y)))).toBeLessThan(0.05)
      }
    })
  }

  it('turns a gradient with each copy of its shape', () => {
    const gradient = { type: 'radial' as const, cx: 55, cy: 30, r: 15, stops: [{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#000000' }] }
    const shaded: Doc = { ...doc, paths: [{ ...doc.paths[0], gradient }] }
    const out = mirrorDoc(paper, shaded, centreTurn(shaded, 4))
    expect(out.paths).toHaveLength(4)
    expect(out.paths[0].gradient).toEqual(gradient)
    // A quarter turn clockwise about (50, 50): (x, y) → (100 − y, x).
    expect(out.paths[1].gradient!.transform!.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 1, -1, 0, 100, 0])
    expect(new Set(out.paths.map((p) => p.id)).size).toBe(4)
  })

  it('leaves what lies outside the circle alone, so a background keeps its corners', () => {
    const bg: Doc = { width: 100, height: 100, paths: [{ id: 'bg', fill: '#ffffff', d: 'M0 0L100 0L100 100L0 100Z' }, ...doc.paths] }
    const out = mirrorDoc(paper, bg, centreTurn(bg, 5))
    const ns = nodes(out.paths[0].d)
    for (const corner of [[0, 0], [100, 0], [100, 100], [0, 100]]) expect(ns.some((n) => Math.hypot(n.x - corner[0], n.y - corner[1]) < 0.01)).toBe(true)
  })

  it('picks the likeliest symmetry, preferring the highest order that fits', () => {
    const mirror = (score: number): Symmetry => ({ kind: 'mirror', orientation: 'vertical', position: 50, score })
    const turn = (order: number, score: number): Symmetry => ({ kind: 'rotation', order, cx: 50.2, cy: 49.9, score })
    expect(likelyAxis([mirror(0.99), turn(2, 0.6)])).toMatchObject({ orientation: 'vertical', position: 50, keep: 'start' })
    expect(likelyAxis([turn(2, 0.99), turn(4, 0.985), mirror(0.97), turn(8, 0.9)])).toMatchObject({ orientation: 'rotation', order: 4, cx: 50, cy: 50 })
    expect(likelyAxis([mirror(0.9), turn(3, 0.8)])).toBeNull()
  })
})
