import { describe, expect, it } from 'vitest'
import { closeGaps } from './gaps'

const W = 80
const H = 60
/** A blank page with rectangles of ink (x0, y0, x1, y1, ends exclusive). */
function page(...rects: [number, number, number, number][]) {
  const ink = new Uint8Array(W * H)
  for (const [x0, y0, x1, y1] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink[y * W + x] = 1
  return ink
}
/** Pieces of ink, 8-connected. */
function pieces(ink: Uint8Array) {
  const seen = new Uint8Array(ink.length)
  let n = 0
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i] || seen[i]) continue
    n++
    const stack = [i]
    seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!
      const x = j % W
      const y = (j / W) | 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          const k = ny * W + nx
          if (nx >= 0 && nx < W && ny >= 0 && ny < H && ink[k] && !seen[k]) {
            seen[k] = 1
            stack.push(k)
          }
        }
    }
  }
  return n
}

describe('closeGaps', () => {
  it('joins a line broken by a gap about its width', () => {
    const ink = page([5, 28, 37, 31], [40, 28, 75, 31])
    expect(closeGaps(ink, W, H)).toBe(1)
    expect(pieces(ink)).toBe(1)
    // Painted the line's own width, not a blob.
    expect(ink[20 * W + 38]).toBe(0)
  })

  it('leaves a drawn gap open: dashes four widths apart', () => {
    const ink = page([5, 28, 20, 31], [32, 28, 47, 31], [59, 28, 74, 31])
    expect(closeGaps(ink, W, H)).toBe(0)
    expect(pieces(ink)).toBe(3)
  })

  it('leaves a gap of a width on a heavy line: it is drawn', () => {
    const ink = page([5, 25, 35, 33], [43, 25, 75, 33])
    expect(closeGaps(ink, W, H)).toBe(0)
  })

  it('reaches the line a T’s stem stops short of', () => {
    const ink = page([5, 10, 75, 13], [38, 16, 41, 55])
    expect(closeGaps(ink, W, H)).toBe(1)
    expect(pieces(ink)).toBe(1)
  })

  it('doesn’t join lines that pass side by side', () => {
    const ink = page([5, 20, 40, 23], [42, 26, 75, 29])
    expect(closeGaps(ink, W, H)).toBe(0)
    expect(pieces(ink)).toBe(2)
  })
})
