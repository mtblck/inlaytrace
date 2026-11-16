import { describe, expect, it } from 'vitest'
import { alignMoves, distributeMoves } from './align'
import { SnapIndex, snapMove, snapPoint } from './snap'

const page = { x: 0, y: 0, w: 200, h: 100 }
const a = { x: 10, y: 10, w: 20, h: 20 }
const b = { x: 50, y: 30, w: 40, h: 10 }
const c = { x: 120, y: 5, w: 10, h: 50 }

describe('align and distribute', () => {
  it('lines edges and centres up on the selection’s bounds', () => {
    expect(alignMoves([a, b, c], 'left', page)).toEqual([{ dx: 0, dy: 0 }, { dx: -40, dy: 0 }, { dx: -110, dy: 0 }])
    expect(alignMoves([a, b, c], 'right', page).map((m) => m.dx)).toEqual([100, 40, 0])
    expect(alignMoves([a, b, c], 'centre', page).map((m) => m.dx)).toEqual([50, 0, -55])
    expect(alignMoves([a, b, c], 'top', page).map((m) => m.dy)).toEqual([-5, -25, 0])
    expect(alignMoves([a, b, c], 'middle', page).map((m) => m.dy)).toEqual([10, -5, 0])
    expect(alignMoves([a, b, c], 'bottom', page).map((m) => m.dy)).toEqual([25, 15, 0])
  })

  it('lines one item up with the drawing', () => {
    expect(alignMoves([a], 'centre', page)).toEqual([{ dx: 80, dy: 0 }])
    expect(alignMoves([a], 'bottom', page)).toEqual([{ dx: 0, dy: 70 }])
  })

  it('spaces three or more evenly, the end ones staying put', () => {
    // Gaps: span 10..130 = 120, widths 70, so two gaps of 25.
    expect(distributeMoves([c, a, b], 'horizontal')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 5, dy: 0 }])
    expect(distributeMoves([a, b], 'horizontal')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }])
    // Top to bottom: 0..10, 15..25, 60..70 span 70 with 30 of shapes, so gaps of 20 put the middle one at 30.
    const v = distributeMoves([{ x: 0, y: 60, w: 5, h: 10 }, { x: 0, y: 0, w: 5, h: 10 }, { x: 0, y: 15, w: 5, h: 10 }], 'vertical')
    expect(v).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 15 }])
  })
})

describe('snapping', () => {
  const index = new SnapIndex([{ x: 10, y: 10 }, { x: 50, y: 50 }], 3)
  it('lands a point on a node within reach, else on whole pixels if the grid is on', () => {
    expect(snapPoint({ x: 11, y: 12 }, index, false, 3)).toEqual({ at: { x: 10, y: 10 }, node: true })
    expect(snapPoint({ x: 14.4, y: 12 }, index, true, 3)).toEqual({ at: { x: 14, y: 12 }, node: false })
    expect(snapPoint({ x: 14.4, y: 12 }, index, false, 3)).toEqual({ at: { x: 14.4, y: 12 }, node: false })
    expect(snapPoint({ x: 11, y: 12 }, null, false, 3).node).toBe(false)
  })

  it('moves shapes so their nearest node lands on a still one, keeping a held axis', () => {
    const moving = [{ x: 0, y: 0 }, { x: 40, y: 41 }]
    // (40, 41) + (9, 8) = (49, 49), next to (50, 50).
    expect(snapMove(9, 8, { x: false, y: false }, moving, null, index, false, 3)).toEqual({ dx: 10, dy: 9, at: { x: 50, y: 50 } })
    // Held level: y can't change, so only a node already level with a still one can land: (0, 10) + (9, 0) on (10, 10).
    expect(snapMove(9, 0, { x: false, y: true }, [{ x: 0, y: 10 }], null, index, false, 3)).toEqual({ dx: 10, dy: 0, at: { x: 10, y: 10 } })
    expect(snapMove(9, 0, { x: false, y: true }, [{ x: 0, y: 11 }], null, index, false, 3)).toEqual({ dx: 9, dy: 0, at: null })
    // Nothing near: the grid puts the box's corner on whole pixels.
    expect(snapMove(20.3, 0.6, { x: false, y: false }, moving, { x: 0.5, y: 0, w: 40, h: 41 }, index, true, 3)).toEqual({ dx: 20.5, dy: 1, at: null })
  })
})
