import { describe, expect, it } from 'vitest'
import type { Doc } from './doc'
import { sharpenNode, smoothNode } from './nodeops'
import { moveHandle, moveNode, parsePath, serializePath } from './pathdata'
import { followShared, movedPoints, simplifyShared } from './shared'

// Two squares side by side sharing the edge x = 10 (each running its own way round), a third apart, and a line.
const doc: Doc = {
  width: 40,
  height: 20,
  paths: [
    { id: 'a', fill: '#ff0000', d: 'M0 0L10 0L10 10L0 10Z' },
    { id: 'b', fill: '#00ff00', d: 'M10 0L20 0L20 10L10 10Z' },
    { id: 'c', fill: '#0000ff', d: 'M30 0L40 0L40 10L30 10Z' },
    { id: 'line', fill: '#000000', stroke: 1, d: 'M10 0L10 20' },
  ],
}
const edit = (d: Doc, id: string, f: (s: ReturnType<typeof parsePath>) => ReturnType<typeof parsePath>, frozen?: Set<string>) => {
  const before = parsePath(d.paths.find((p) => p.id === id)!.d)
  return followShared(d, id, before, f(before), frozen)
}
const d = (x: Doc, id: string) => x.paths.find((p) => p.id === id)!.d

describe('shared edges', () => {
  it('a node moved on a shared edge moves the neighbour’s copy, and nothing else', () => {
    const out = edit(doc, 'a', (s) => moveNode(s, { sub: 0, index: 1 }, 'anchor', { x: 12, y: 1 }))
    expect(d(out, 'b')).toBe('M12 1L20 0L20 10L10 10Z')
    expect(d(out, 'c')).toBe(d(doc, 'c'))
    // Lines aren't shapes with an edge to share.
    expect(d(out, 'line')).toBe(d(doc, 'line'))
  })

  it('a handle bent on a shared edge bends the neighbour’s matching handle', () => {
    const curved: Doc = {
      ...doc,
      paths: [
        { id: 'a', fill: '#ff0000', d: 'M0 0L10 0C12 3 12 7 10 10L0 10Z' },
        { id: 'b', fill: '#00ff00', d: 'M10 0L20 0L20 10L10 10C12 7 12 3 10 0Z' },
      ],
    }
    const out = edit(curved, 'a', (s) => moveHandle(s, { sub: 0, index: 1 }, 'out', { x: 15, y: 3 }, false))
    expect(d(out, 'b')).toBe('M10 0L20 0L20 10L10 10C12 7 15 3 10 0Z')
  })

  it('Smooth and Sharpen on a shared corner give the neighbour the same handles, and take them away again', () => {
    // The edited shape's own change, and its neighbours following it.
    const both = (x: Doc, f: (s: ReturnType<typeof parsePath>) => ReturnType<typeof parsePath>) => {
      const after = f(parsePath(d(x, 'a')))
      const out = edit(x, 'a', () => after)
      return { ...out, paths: out.paths.map((p) => (p.id === 'a' ? { ...p, d: serializePath(after) } : p)) }
    }
    const smooth = both(doc, (s) => smoothNode(s, { sub: 0, index: 1 }))
    const a = parsePath(d(smooth, 'a'))[0].nodes
    const b = parsePath(d(smooth, 'b'))[0].nodes
    // a's (10, 0) → (10, 10) is b's (10, 10) → (10, 0), handles the other way round.
    expect(a[1].out).not.toBeNull()
    expect(b[0].in).toEqual(a[1].out)
    expect(b[3].out).toEqual(a[2].in)
    // b's own top edge, which a doesn't share, keeps its straight line.
    expect(b[0].out).toBeNull()
    const sharp = both(smooth, (s) => sharpenNode(s, { sub: 0, index: 1 }))
    expect(d(sharp, 'b')).toBe(d(doc, 'b'))
  })

  it('leaves locked shapes and outlines that changed shape alone', () => {
    const move = (s: ReturnType<typeof parsePath>) => moveNode(s, { sub: 0, index: 1 }, 'anchor', { x: 12, y: 1 })
    expect(d(edit(doc, 'a', move, new Set(['b'])), 'b')).toBe(d(doc, 'b'))
    const before = parsePath(d(doc, 'a'))
    expect(movedPoints(before, [{ ...before[0], nodes: before[0].nodes.slice(1) }])).toBeNull()
    expect(followShared(doc, 'a', before, before)).toBe(doc)
  })
})

describe('simplify by shared edge', () => {
  // A wavy edge of 41 nodes from (0, 0) down to (0, 100), shared by a shape on its left and one on its right.
  const wave = Array.from({ length: 41 }, (_, i) => ({ x: Math.round(3 * Math.sin(i / 6) * 1000) / 1000, y: i * 2.5 }))
  const pt = (p: { x: number; y: number }) => `${p.x} ${p.y}`
  const left = `M${pt(wave[0])}${wave.slice(1).map((p) => `L${pt(p)}`).join('')}L-50 100L-50 0Z`
  const right = `M${pt(wave[40])}${[...wave].reverse().slice(1).map((p) => `L${pt(p)}`).join('')}L50 0L50 100Z`
  const two: Doc = { width: 100, height: 100, paths: [{ id: 'l', fill: '#f00', d: left }, { id: 'r', fill: '#0f0', d: right }, { id: 'far', fill: '#00f', d: 'M60 0L70 0L70 10L60 10Z' }] }
  const nodes = (x: Doc, id: string) => parsePath(d(x, id))[0].nodes.length
  // Every segment of `a` that some segment of `b` runs back along.
  const sharedSegs = (x: Doc, a: string, b: string) => {
    const k = (p: { x: number; y: number } | null, q: { x: number; y: number }) => `${(p ?? q).x},${(p ?? q).y}`
    const segs = (id: string) => {
      const n = parsePath(d(x, id))[0].nodes
      return n.map((p, i) => [p, n[(i + 1) % n.length]] as const)
    }
    const back = new Set(segs(b).map(([p, q]) => `${k(q, q)}|${k(q.in, q)}|${k(p.out, p)}|${k(p, p)}`))
    return segs(a).filter(([p, q]) => back.has(`${k(p, p)}|${k(p.out, p)}|${k(q.in, q)}|${k(q, q)}`)).length
  }

  it('re-fits the shared edge once and writes it into the neighbour too, so they still meet exactly', () => {
    expect(sharedSegs(two, 'l', 'r')).toBe(40)
    const out = simplifyShared(two, ['l'], 1)
    expect(nodes(out, 'l')).toBeLessThan(nodes(two, 'l'))
    expect(nodes(out, 'r')).toBeLessThan(nodes(two, 'r'))
    // Every segment of the new edge is in both shapes, one running each way.
    const shared = sharedSegs(out, 'l', 'r')
    expect(shared).toBeGreaterThan(0)
    expect(shared).toBe(nodes(out, 'l') - 3)
    expect(sharedSegs(out, 'r', 'l')).toBe(shared)
    expect(d(out, 'far')).toBe(d(two, 'far'))
  })

  it('re-fits an island once and writes it into the hole round it, running the other way', () => {
    // A 10 px square island with a node every pixel, in a container with a matching hole.
    const ring = [
      ...Array.from({ length: 10 }, (_, i) => `${i} 0`),
      ...Array.from({ length: 10 }, (_, i) => `10 ${i}`),
      ...Array.from({ length: 10 }, (_, i) => `${10 - i} 10`),
      ...Array.from({ length: 10 }, (_, i) => `0 ${10 - i}`),
    ]
    const loop = (pts: string[]) => `M${pts[0]}${pts.slice(1).map((q) => `L${q}`).join('')}Z`
    const isl: Doc = {
      width: 40,
      height: 40,
      paths: [
        { id: 'box', fill: '#f00', d: `M-10 -10L20 -10L20 20L-10 20Z${loop([...ring].reverse())}` },
        { id: 'isl', fill: '#0f0', d: loop(ring) },
      ],
    }
    const out = simplifyShared(isl, ['isl'], 1)
    const island = parsePath(d(out, 'isl'))[0].nodes
    const hole = parsePath(d(out, 'box'))[1].nodes
    expect(island.length).toBeLessThan(40)
    expect(hole.length).toBe(island.length)
    const area = (n: { x: number; y: number }[]) => n.reduce((s, p, i) => s + p.x * n[(i + 1) % n.length].y - n[(i + 1) % n.length].x * p.y, 0)
    expect(Math.sign(area(hole))).toBe(-Math.sign(area(island)))
    // Every segment of the island is a segment of the hole, running back.
    const holeOnly: Doc = { ...out, paths: out.paths.map((p) => (p.id === 'box' ? { ...p, d: p.d.slice(p.d.indexOf('Z') + 1) } : p)) }
    expect(sharedSegs(holeOnly, 'isl', 'box')).toBe(island.length)
    // The container's outside is untouched.
    expect(parsePath(d(out, 'box'))[0].nodes.length).toBe(4)
  })

  it('leaves a locked neighbour’s edge, and the selected shape along it, as they were', () => {
    const out = simplifyShared(two, ['l'], 1, new Set(['r']))
    expect(d(out, 'r')).toBe(d(two, 'r'))
    expect(sharedSegs(out, 'l', 'r')).toBe(40)
  })
})
