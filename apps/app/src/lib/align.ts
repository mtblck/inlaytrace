/**
 * Align and distribute (#213), on the selection's bounds. Each item is a shape
 * or a whole group, so a group keeps its shape. With one item, it lines up
 * with the drawing instead.
 */
import type { Box } from './transform'

export type AlignHow = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'
export type DistributeHow = 'horizontal' | 'vertical'

/** How far to move each item (by index) so its edge or centre meets the others'. */
export function alignMoves(boxes: Box[], how: AlignHow, page: Box): { dx: number; dy: number }[] {
  if (!boxes.length) return []
  const all = boxes.length === 1 ? page : outer(boxes)
  return boxes.map((b) => {
    switch (how) {
      case 'left':
        return { dx: all.x - b.x, dy: 0 }
      case 'centre':
        return { dx: all.x + all.w / 2 - (b.x + b.w / 2), dy: 0 }
      case 'right':
        return { dx: all.x + all.w - (b.x + b.w), dy: 0 }
      case 'top':
        return { dx: 0, dy: all.y - b.y }
      case 'middle':
        return { dx: 0, dy: all.y + all.h / 2 - (b.y + b.h / 2) }
      case 'bottom':
        return { dx: 0, dy: all.y + all.h - (b.y + b.h) }
    }
  })
}

/**
 * Even gaps between the items (three or more), left to right or top to
 * bottom by their centres; the two at the ends stay where they are. Items
 * wider together than the span they cover overlap evenly instead.
 */
export function distributeMoves(boxes: Box[], how: DistributeHow): { dx: number; dy: number }[] {
  const moves = boxes.map(() => ({ dx: 0, dy: 0 }))
  if (boxes.length < 3) return moves
  const h = how === 'horizontal'
  const start = (b: Box) => (h ? b.x : b.y)
  const len = (b: Box) => (h ? b.w : b.h)
  const order = boxes.map((_, i) => i).sort((i, j) => start(boxes[i]) + len(boxes[i]) / 2 - (start(boxes[j]) + len(boxes[j]) / 2))
  const first = boxes[order[0]]
  const last = boxes[order[order.length - 1]]
  const span = start(last) + len(last) - start(first)
  const gap = (span - order.reduce((n, i) => n + len(boxes[i]), 0)) / (order.length - 1)
  let at = start(first)
  for (const i of order) {
    const d = at - start(boxes[i])
    moves[i] = h ? { dx: d, dy: 0 } : { dx: 0, dy: d }
    at += len(boxes[i]) + gap
  }
  return moves
}

function outer(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}
