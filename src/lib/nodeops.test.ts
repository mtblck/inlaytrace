import { describe, expect, it } from 'vitest'
import { addNode, cubicOf, nearestOnPath, pointAt, roundNode, sharpenNode, simplifySubpaths, smoothNode } from './nodeops'
import { isSmooth, parsePath, serializePath, type Subpath } from './pathdata'
import { apply, rotateAbout } from './transform'

/** Points along every segment, to compare outlines. */
const trace = (subs: Subpath[], k = 32) =>
  subs.flatMap((s) => {
    const out = []
    const n = s.nodes.length
    for (let i = 0; i < (s.closed ? n : n - 1); i++) {
      const c = cubicOf(s.nodes[i], s.nodes[(i + 1) % n])
      for (let j = 0; j < k; j++) out.push(pointAt(c, j / k))
    }
    return out
  })
/** Furthest any point of `a` is from the outline `b`. */
const offBy = (a: Subpath[], b: Subpath[]) => Math.max(...trace(a).map((p) => nearestOnPath(b, p)!.dist))

describe('adding a node', () => {
  const arch = parsePath('M0 0C0 -10 20 -10 20 0L20 10L0 10Z')
  it('splits a curve without moving the outline', () => {
    const { subs, ref } = addNode(arch, 0, 0, 0.3)
    expect(subs[0].nodes).toHaveLength(5)
    expect(ref).toEqual({ sub: 0, index: 1 })
    expect(offBy(subs, arch)).toBeLessThan(0.01)
    expect(offBy(arch, subs)).toBeLessThan(0.01)
    expect(isSmooth(subs[0].nodes[1])).toBe(true)
  })
  it('splits a straight segment with a plain node', () => {
    const { subs } = addNode(arch, 0, 1, 0.5)
    expect(subs[0].nodes[2]).toEqual({ x: 20, y: 5, in: null, out: null })
  })
  it('splits the closing segment of a loop', () => {
    const { subs, ref } = addNode(arch, 0, 3, 0.5)
    expect(ref.index).toBe(4)
    expect(subs[0].nodes[4]).toMatchObject({ x: 0, y: 5 })
  })
  it('finds the nearest point on the outline', () => {
    const hit = nearestOnPath(arch, { x: 21, y: 4 })!
    expect(hit.seg).toBe(1)
    expect(hit.at.x).toBeCloseTo(20)
    expect(hit.at.y).toBeCloseTo(4)
    expect(hit.dist).toBeCloseTo(1)
  })
})

describe('smooth and sharp', () => {
  const square = parsePath('M0 0L10 0L10 10L0 10Z')
  it('makes a corner smooth with handles in line', () => {
    const n = smoothNode(square, { sub: 0, index: 1 })[0].nodes[1]
    expect(isSmooth(n)).toBe(true)
    // From the previous node (0,0) to the next (10,10): a 45° direction.
    expect(n.out!.x - n.x).toBeCloseTo(n.out!.y - n.y)
  })
  it('sharpens by dropping handles', () => {
    const arch = parsePath('M0 0C0 -10 20 -10 20 0Z')
    expect(sharpenNode(arch, { sub: 0, index: 0 })[0].nodes[0]).toMatchObject({ in: null, out: null })
  })
})

describe('rounding a corner', () => {
  const square = parsePath('M0 0L10 0L10 10L0 10Z')
  it('replaces the corner with an arc of the given reach', () => {
    const out = roundNode(square, { sub: 0, index: 1 }, 3)
    const ns = out[0].nodes
    expect(ns).toHaveLength(5)
    expect(ns[1].x).toBeCloseTo(7, 9)
    expect(ns[1].y).toBeCloseTo(0, 9)
    expect(ns[2].x).toBeCloseTo(10, 9)
    expect(ns[2].y).toBeCloseTo(3, 9)
    // A quarter circle of radius 3: its midpoint sits 3 px from the centre (7, 3).
    const mid = pointAt(cubicOf(ns[1], ns[2]), 0.5)
    expect(Math.hypot(mid.x - 7, mid.y - 3)).toBeCloseTo(3, 2)
  })
  it('caps the radius so neighbouring corners never overlap', () => {
    const ns = roundNode(square, { sub: 0, index: 1 }, 50)[0].nodes
    expect(ns[1].x).toBeCloseTo(5.5)
  })
  it('leaves an open end alone', () => {
    const open = parsePath('M0 0L10 0L10 10')
    expect(roundNode(open, { sub: 0, index: 0 }, 3)).toBe(open)
  })
})

describe('simplify', () => {
  it('re-fits a densely noded circle with fewer nodes, close to the original', () => {
    const pts = Array.from({ length: 64 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2
      return `${i ? 'L' : 'M'}${(50 + 30 * Math.cos(a)).toFixed(3)} ${(50 + 30 * Math.sin(a)).toFixed(3)}`
    })
    const circle = parsePath(pts.join('') + 'Z')
    const out = simplifySubpaths(circle, 0.5)
    expect(out[0].nodes.length).toBeLessThan(12)
    expect(offBy(out, circle)).toBeLessThan(0.75)
  })
  it('keeps a square square', () => {
    const square = parsePath('M0 0L40 0L40 40L0 40Z')
    expect(serializePath(simplifySubpaths(square, 1))).toBe('M0 0L40 0L40 40L0 40Z')
  })
})

describe('rotation', () => {
  it('turns clockwise on screen and quarter turns are exact', () => {
    const m = rotateAbout({ x: 10, y: 10 }, 90)
    expect(apply(m, { x: 20, y: 10 })).toEqual({ x: 10, y: 20 })
    let p = { x: 3.3, y: 7.1 }
    for (let i = 0; i < 4; i++) p = apply(m, p)
    expect(p.x).toBeCloseTo(3.3, 12)
    expect(p.y).toBeCloseTo(7.1, 12)
  })
})
