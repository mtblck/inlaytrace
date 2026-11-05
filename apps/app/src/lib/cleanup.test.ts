import { describe, expect, it } from 'vitest'
import { addOp, adjustmentOf, checkCleanup, sameGeometry, setAdjustment, straightenAngle, type CleanupOp, type Img } from './cleanup'
import { backgroundOf, replay, sizeAfter } from './cleanupPixels'

/** A w × h image where pixel (x, y) is grey level `f(x, y)`, opaque. */
function image(w: number, h: number, f: (x: number, y: number) => number): Img {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      rgba[o] = rgba[o + 1] = rgba[o + 2] = f(x, y)
      rgba[o + 3] = 255
    }
  return { rgba, width: w, height: h }
}
const at = (img: Img, x: number, y: number) => img.rgba[(y * img.width + x) * 4]
// 3 × 2, each pixel numbered: 10 20 30 / 40 50 60
const small = () => image(3, 2, (x, y) => 10 * (1 + x + 3 * y))
const grid = (img: Img) => Array.from({ length: img.height }, (_, y) => Array.from({ length: img.width }, (_, x) => at(img, x, y)))

describe('clean-up replay', () => {
  it('crops by fractions of the image, so the size it replays at doesn’t matter', () => {
    const out = replay(small(), [{ kind: 'crop', x: 1 / 3, y: 0, width: 2 / 3, height: 1 }])
    expect(grid(out)).toEqual([
      [20, 30],
      [50, 60],
    ])
    const big = replay(image(300, 200, () => 0), [{ kind: 'crop', x: 1 / 3, y: 0.5, width: 1 / 3, height: 0.5 }])
    expect([big.width, big.height]).toEqual([100, 100])
  })

  it('turns by quarter turns exactly, clockwise', () => {
    expect(grid(replay(small(), [{ kind: 'rotate', degrees: 90 }]))).toEqual([
      [40, 10],
      [50, 20],
      [60, 30],
    ])
    expect(grid(replay(small(), [{ kind: 'rotate', degrees: 180 }]))).toEqual([
      [60, 50, 40],
      [30, 20, 10],
    ])
    expect(grid(replay(small(), [{ kind: 'rotate', degrees: -90 }]))).toEqual([
      [30, 60],
      [20, 50],
      [10, 40],
    ])
  })

  it('flips', () => {
    expect(grid(replay(small(), [{ kind: 'flip', axis: 'horizontal' }]))).toEqual([
      [30, 20, 10],
      [60, 50, 40],
    ])
    expect(grid(replay(small(), [{ kind: 'flip', axis: 'vertical' }]))).toEqual([
      [40, 50, 60],
      [10, 20, 30],
    ])
  })

  it('straightens: a small turn grows the canvas and fills the corners with the background', () => {
    // White page, a black square in the middle.
    const page = image(100, 60, (x, y) => (x >= 40 && x < 60 && y >= 20 && y < 40 ? 0 : 255))
    const out = replay(page, [{ kind: 'rotate', degrees: 5 }])
    expect(out.width).toBe(Math.ceil(100 * Math.cos(Math.PI / 36) + 60 * Math.sin(Math.PI / 36)))
    expect(sizeAfter(100, 60, [{ kind: 'rotate', degrees: 5 }])).toEqual({ width: out.width, height: out.height })
    expect(at(out, 0, 0)).toBe(255) // a new corner, filled white, not black or transparent
    expect(out.rgba[3]).toBe(255)
    expect(at(out, Math.floor(out.width / 2), Math.floor(out.height / 2))).toBe(0) // the square stays in the middle
  })

  it('works out the turn that levels a drawn line, or makes it upright', () => {
    // A line sloping down to the right by 3°: turn it back 3° anticlockwise.
    const t = (3 * Math.PI) / 180
    expect(straightenAngle({ x: 0, y: 0 }, { x: 100 * Math.cos(t), y: 100 * Math.sin(t) })).toBeCloseTo(-3, 2)
    // A nearly upright line drawn downwards, 2° clockwise of straight down: turn back 2°.
    const u = (92 * Math.PI) / 180
    expect(straightenAngle({ x: 0, y: 0 }, { x: 100 * Math.cos(u), y: 100 * Math.sin(u) })).toBeCloseTo(-2, 2)
    expect(straightenAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0)
  })

  it('applies levels and threshold, keeping alpha', () => {
    const ramp = image(256, 1, (x) => x)
    const lv = replay(ramp, [{ kind: 'levels', black: 50, white: 200, gamma: 1 }])
    expect([at(lv, 0, 0), at(lv, 50, 0), at(lv, 125, 0), at(lv, 200, 0), at(lv, 255, 0)]).toEqual([0, 0, 128, 255, 255])
    const bright = replay(ramp, [{ kind: 'levels', black: 0, white: 255, gamma: 2 }])
    expect(at(bright, 64, 0)).toBeGreaterThan(64)
    const th = replay(ramp, [{ kind: 'threshold', level: 100 }])
    expect([at(th, 99, 0), at(th, 100, 0)]).toEqual([0, 255])
    expect(th.rgba[3]).toBe(255)
  })

  it('replays a list in order, and leaves the original alone', () => {
    const src = small()
    const before = src.rgba.slice()
    const ops: CleanupOp[] = [{ kind: 'rotate', degrees: 90 }, { kind: 'crop', x: 0, y: 0, width: 1, height: 2 / 3 }, { kind: 'flip', axis: 'horizontal' }]
    expect(grid(replay(src, ops))).toEqual([
      [10, 40],
      [20, 50],
    ])
    expect(src.rgba).toEqual(before)
    expect(sizeAfter(3, 2, ops)).toEqual({ width: 2, height: 2 })
  })

  it('finds the background round the edge, ignoring the middle', () => {
    expect(backgroundOf(image(20, 20, (x, y) => (x > 2 && x < 17 && y > 2 && y < 17 ? 0 : 240)))).toEqual([240, 240, 240, 255])
    const clear = { ...small(), rgba: new Uint8ClampedArray(24) }
    expect(backgroundOf(clear)).toEqual([0, 0, 0, 0])
  })
})

describe('clean-up list', () => {
  it('folds quarter turns together and cancels a repeated flip', () => {
    let ops = addOp([], { kind: 'rotate', degrees: 90 })
    ops = addOp(ops, { kind: 'rotate', degrees: 90 })
    expect(ops).toEqual([{ kind: 'rotate', degrees: 180 }])
    expect(addOp(ops, { kind: 'rotate', degrees: 180 })).toEqual([])
    expect(addOp(addOp([], { kind: 'flip', axis: 'vertical' }), { kind: 'flip', axis: 'vertical' })).toEqual([])
    // A straighten stays its own step.
    expect(addOp([{ kind: 'rotate', degrees: 2.5 }], { kind: 'rotate', degrees: 90 })).toHaveLength(2)
    // Two straightens are one turn.
    expect(addOp([{ kind: 'rotate', degrees: 2.5 }], { kind: 'rotate', degrees: -1 })).toEqual([{ kind: 'rotate', degrees: 1.5 }])
  })

  it('keeps one of each adjustment, edited in place', () => {
    let ops = addOp([], { kind: 'flip', axis: 'horizontal' })
    ops = setAdjustment(ops, 'levels', { kind: 'levels', black: 10, white: 240, gamma: 1 })
    ops = setAdjustment(ops, 'levels', { kind: 'levels', black: 20, white: 240, gamma: 1 })
    expect(ops).toHaveLength(2)
    expect(adjustmentOf(ops, 'levels')?.black).toBe(20)
    expect(setAdjustment(ops, 'levels', null)).toHaveLength(1)
    expect(sameGeometry(ops, [{ kind: 'flip', axis: 'horizontal' }])).toBe(true)
    expect(sameGeometry(ops, [])).toBe(false)
  })

  it('checks a saved list op by op', () => {
    const ops: CleanupOp[] = [
      { kind: 'crop', x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
      { kind: 'rotate', degrees: -2.5 },
      { kind: 'flip', axis: 'vertical' },
      { kind: 'levels', black: 10, white: 200, gamma: 1.2 },
      { kind: 'threshold', level: 128 },
    ]
    expect(checkCleanup(JSON.parse(JSON.stringify(ops)))).toEqual(ops)
    expect(checkCleanup([{ kind: 'crop', x: 0.8, y: 0, width: 0.5, height: 1 }])).toBeNull()
    expect(checkCleanup([{ kind: 'levels', black: 200, white: 100, gamma: 1 }])).toBeNull()
    expect(checkCleanup([{ kind: 'paint' }])).toBeNull()
    expect(checkCleanup('nope')).toBeNull()
  })
})
