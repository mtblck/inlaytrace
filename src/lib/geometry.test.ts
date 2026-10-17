/**
 * The two pieces of geometry the editor relies on: path data that survives a
 * round trip without drifting, and mirroring that produces one seamless,
 * symmetric shape. Mirror runs the real paper.js core build, the same module
 * the app lazy-loads.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import type PaperNS from 'paper/dist/paper-core'
import { deleteNode, moveNode, parsePath, serializePath } from './pathdata'
import { mirrorDoc, centreAxis } from './mirror'
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
})
