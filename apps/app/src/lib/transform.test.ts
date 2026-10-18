import { describe, expect, it } from 'vitest'
import { allRefs, apply, boxToBox, handlePoint, nodesInRect, normRect, pathBounds, pathsInRect, scaleFromHandle, transformPath, transformShape, union, type Box } from './transform'
import { deleteNodes, isSmooth, moveHandle, moveNodes, parsePath, serializePath } from './pathdata'

const close = (a: Box | null, b: Box) => {
  expect(a).not.toBeNull()
  for (const k of ['x', 'y', 'w', 'h'] as const) expect(a![k]).toBeCloseTo(b[k], 6)
}

describe('bounds', () => {
  it('fits the drawn curve, not its handles', () => {
    // A quarter-ish arch whose handles reach to y = -10; the curve itself peaks at y = -7.5.
    close(pathBounds('M0 0C0 -10 10 -10 10 0Z'), { x: 0, y: -7.5, w: 10, h: 7.5 })
  })
  it('includes straight segments and every subpath', () => {
    close(pathBounds('M2 3L8 3L8 9ZM20 1L21 2'), { x: 2, y: 1, w: 19, h: 8 })
  })
  it('unions boxes and skips nulls', () => {
    close(union([{ x: 0, y: 0, w: 1, h: 1 }, null, { x: 5, y: -2, w: 1, h: 1 }]), { x: 0, y: -2, w: 6, h: 3 })
    expect(union([])).toBeNull()
  })
})

describe('scaling from a handle', () => {
  const box = { x: 10, y: 10, w: 20, h: 10 }
  const after = (m: ReturnType<typeof scaleFromHandle>) => {
    const a = apply(m, { x: box.x, y: box.y })
    const b = apply(m, { x: box.x + box.w, y: box.y + box.h })
    return normRect(a, b)
  }
  it('drags the bottom-right corner with the top-left fixed', () => {
    close(after(scaleFromHandle(box, { h: 1, v: 1 }, { x: 50, y: 40 })), { x: 10, y: 10, w: 40, h: 30 })
  })
  it('keeps proportions with the larger factor', () => {
    close(after(scaleFromHandle(box, { h: 1, v: 1 }, { x: 50, y: 22 }, { proportional: true })), { x: 10, y: 10, w: 40, h: 20 })
  })
  it('scales from the centre', () => {
    close(after(scaleFromHandle(box, { h: 1, v: 0 }, { x: 40, y: 0 }, { fromCentre: true })), { x: 0, y: 10, w: 40, h: 10 })
  })
  it('scales the other axis about its centre on a proportional edge drag', () => {
    close(after(scaleFromHandle(box, { h: 0, v: 1 }, { x: 0, y: 30 }, { proportional: true })), { x: 0, y: 10, w: 40, h: 20 })
  })
  it('leaves the untouched axis alone and never collapses to zero', () => {
    const m = scaleFromHandle(box, { h: -1, v: 0 }, { x: 30, y: 99 })
    expect(m.d).toBe(1)
    expect(Math.abs(m.a * box.w)).toBeGreaterThanOrEqual(0.5 - 1e-9)
  })
  it('flips past the opposite edge', () => {
    close(after(scaleFromHandle(box, { h: 1, v: 0 }, { x: 0, y: 0 })), { x: 0, y: 10, w: 10, h: 10 })
  })
  it('maps one box onto another for typed values', () => {
    const m = boxToBox(box, { x: 0, y: 5, w: 40, h: 5 })
    expect(apply(m, { x: 10, y: 10 })).toEqual({ x: 0, y: 5 })
    expect(apply(m, { x: 30, y: 20 })).toEqual({ x: 40, y: 10 })
  })
  it('transforms path data', () => {
    expect(transformPath('M0 0L10 0L10 10Z', { a: 2, b: 0, c: 0, d: 3, e: 1, f: 1 })).toBe('M1 1L21 1L21 31Z')
    expect(handlePoint(box, { h: 0, v: -1 })).toEqual({ x: 20, y: 10 })
  })
})

describe('rectangle selection', () => {
  const paths = [
    { id: 'big', d: 'M0 0L100 0L100 100L0 100Z' },
    { id: 'dot', d: 'M10 10L20 10L20 20L10 20Z' },
    { id: 'edge', d: 'M25 10L45 10L45 20Z' },
  ]
  it('takes shapes wholly inside, never the background behind them', () => {
    expect(pathsInRect(paths, normRect({ x: 40, y: 30 }, { x: 5, y: 5 }))).toEqual(['dot'])
    expect(pathsInRect(paths, { x: 0, y: 0, w: 50, h: 50 })).toEqual(['dot', 'edge'])
  })
  it('finds nodes inside, across subpaths', () => {
    const subs = parsePath('M0 0L10 0L10 10ZM20 20L30 20L30 30Z')
    expect(nodesInRect(subs, { x: 5, y: -1, w: 30, h: 22 })).toEqual([
      { sub: 0, index: 1 },
      { sub: 0, index: 2 },
      { sub: 1, index: 0 },
      { sub: 1, index: 1 },
    ])
    expect(allRefs(subs)).toHaveLength(6)
  })
})

describe('node edits', () => {
  const smooth = parsePath('M0 0C0 -5 5 -10 10 -10C15 -10 20 -5 20 0Z')
  it('recognises a smooth node and a corner', () => {
    expect(isSmooth(smooth[0].nodes[1])).toBe(true)
    expect(isSmooth(parsePath('M0 0C0 -5 5 -10 10 -10C10 -5 20 -5 20 0Z')[0].nodes[1])).toBe(false)
    expect(isSmooth(parsePath('M0 0L10 0L10 10Z')[0].nodes[1])).toBe(false)
  })
  it('swings the opposite handle round, keeping its length', () => {
    const n = moveHandle(smooth, { sub: 0, index: 1 }, 'out', { x: 10, y: -5 }, true)[0].nodes[1]
    expect(n.out).toEqual({ x: 10, y: -5 })
    expect(n.in!.x).toBeCloseTo(10)
    expect(n.in!.y).toBeCloseTo(-15)
    expect(isSmooth(n)).toBe(true)
  })
  it('moves only the dragged handle when broken', () => {
    const n = moveHandle(smooth, { sub: 0, index: 1 }, 'out', { x: 10, y: -5 }, false)[0].nodes[1]
    expect(n.in).toEqual({ x: 5, y: -10 })
  })
  it('moves several nodes with their handles', () => {
    const out = serializePath(moveNodes(smooth, [{ sub: 0, index: 0 }, { sub: 0, index: 1 }], 1, 2))
    expect(out).toBe('M1 2C1 -3 6 -8 11 -8C16 -8 20 -5 20 0Z')
  })
  it('deletes several nodes, dropping a subpath left with one', () => {
    const subs = parsePath('M0 0L10 0L10 10L0 10ZM20 20L30 20Z')
    const out = deleteNodes(subs, [{ sub: 0, index: 1 }, { sub: 0, index: 3 }, { sub: 1, index: 0 }])
    expect(serializePath(out)).toBe('M0 0L10 10Z')
  })
})

describe('stroked paths', () => {
  it('scale their width with the geometry, and keep it when moved or turned', () => {
    expect(transformShape({ d: 'M0 0L10 0', stroke: 4 }, { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })).toEqual({ d: 'M0 0L5 0', stroke: 2 })
    expect(transformShape({ d: 'M0 0L10 0', stroke: 4 }, { a: 1, b: 0, c: 0, d: 1, e: 3, f: 2 }).stroke).toBe(4)
    expect(transformShape({ d: 'M0 0L10 0', stroke: 4 }, { a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }).stroke).toBe(4)
    expect(transformShape({ d: 'M0 0L10 0' }, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })).toEqual({ d: 'M0 0L20 0' })
  })
})
