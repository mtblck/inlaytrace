import jpeg from 'jpeg-js'
import { describe, expect, it } from 'vitest'
import { addOp, adjustmentOf, checkCleanup, sameGeometry, setAdjustment, straightenAngle, type CleanupOp, type Img } from './cleanup'
import { backgroundOf, composite, dabAt, maskOver, regionOf, replay, sizeAfter, stampSegment, strokeColour, type Dab } from './cleanupPixels'

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

describe('brush and eraser', () => {
  const white = () => image(100, 100, () => 255)
  const dot = (over: Partial<CleanupOp & { kind: 'paint' }> = {}): CleanupOp => ({ kind: 'paint', tool: 'brush', color: '#000000', size: 0.2, hardness: 1, points: [0.5, 0.5, 1], ...over }) as CleanupOp

  it('stamps a hard round dab of the brush’s size', () => {
    const out = replay(white(), [dot()])
    // 20 px across at full pressure: solid inside, untouched outside, an anti-aliased edge between.
    expect(at(out, 50, 50)).toBe(0)
    expect(at(out, 50, 41)).toBe(0)
    expect(at(out, 50, 39)).toBe(255)
    expect(at(out, 62, 50)).toBe(255)
    expect(at(out, 57, 57)).toBe(255) // the corner of the box is outside the circle
  })

  it('fades a soft brush towards its edge, and a light pen pressure draws thinner', () => {
    const soft = replay(white(), [dot({ hardness: 0 })])
    expect(at(soft, 50, 50)).toBeLessThan(20)
    const mid = at(soft, 50, 45)
    expect(mid).toBeGreaterThan(20)
    expect(mid).toBeLessThan(235)
    const light = replay(white(), [dot({ points: [0.5, 0.5, 0] })])
    expect(at(light, 50, 50)).toBe(0)
    expect(at(light, 50, 45)).toBe(255) // a fifth of the width
  })

  it('draws a line between points, without doubling up where dabs overlap', () => {
    const out = replay(white(), [dot({ color: '#808080', hardness: 0, points: [0.2, 0.5, 1, 0.8, 0.5, 1] })])
    // Grey at half strength or so all along: one even line, not darker where dabs overlap.
    expect(at(out, 30, 50)).toBe(at(out, 70, 50))
    expect(at(out, 50, 50)).toBe(at(out, 30, 50))
    expect(Math.abs(at(out, 50, 50) - 128)).toBeLessThan(4)
    expect(at(out, 50, 80)).toBe(255)
  })

  it('erases to the background colour, worked out from the image at that step', () => {
    const page = image(60, 60, (x, y) => (x > 20 && x < 40 && y > 20 && y < 40 ? 0 : 230))
    const out = replay(page, [{ kind: 'paint', tool: 'eraser', size: 0.5, hardness: 1, points: [0.5, 0.5, 1] }])
    expect(at(out, 30, 30)).toBe(230)
    // On a transparent image the eraser clears to transparent.
    const clear = { ...page, rgba: page.rgba.map((v, i) => (i % 4 === 3 && !(i / 4 % 60 > 20 && i / 4 % 60 < 40 && Math.floor(i / 240) > 20 && Math.floor(i / 240) < 40) ? 0 : v)) }
    expect(replay(clear, [{ kind: 'paint', tool: 'eraser', size: 0.5, hardness: 1, points: [0.5, 0.5, 1] }]).rgba[(30 * 60 + 30) * 4 + 3]).toBe(0)
  })

  it('draws the same pixels live, a segment at a time, as the replay does', () => {
    const base = image(80, 50, (x, y) => (x * 3 + y * 5) % 256)
    const op = dot({ color: '#ff0000', size: 0.08, hardness: 0.4, points: [0.1, 0.2, 1, 0.4, 0.6, 0.5, 0.9, 0.3, 0.8] }) as Extract<CleanupOp, { kind: 'paint' }>
    const mask = maskOver({ x0: 0, y0: 0, x1: 80, y1: 50 })
    const out = base.rgba.slice()
    let last: Dab | null = null
    for (let i = 0; i < op.points.length; i += 3) {
      const d = dabAt(base, op, op.points[i], op.points[i + 1], op.points[i + 2])
      const r = stampSegment(mask, last, d, op.hardness)
      if (r) composite(out, base.rgba, 80, mask, strokeColour(base, op), r)
      last = d
    }
    expect(Array.from(out)).toEqual(Array.from(replay(base, [op]).rgba))
  })

  it('paints in place only on pixels a replay made itself', () => {
    const src = white()
    const before = src.rgba.slice()
    replay(src, [dot()])
    expect(src.rgba).toEqual(before)
    // After a flip the stroke paints on the flipped copy: the result is still right.
    const out = replay(src, [{ kind: 'flip', axis: 'horizontal' }, dot({ points: [0.1, 0.1, 1] })])
    expect(at(out, 10, 10)).toBe(0)
    expect(src.rgba).toEqual(before)
  })
})

describe('despeckle and heal (#206)', () => {
  const stroke = (tool: 'despeckle' | 'heal', points: number[], size = 0.2): CleanupOp => ({ kind: 'paint', tool, size, hardness: 1, points })
  const rgbAt = (img: Img, x: number, y: number) => Array.from(img.rgba.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3))

  it('heals a mark from the colour round it', () => {
    const page = image(60, 60, (x, y) => (Math.hypot(x - 30, y - 30) < 5 ? 0 : 240))
    const out = replay(page, [stroke('heal', [0.5, 0.5, 1])])
    expect(grid(out).flat().every((v) => v === 240)).toBe(true)
  })

  it('keeps an edge sharp where it heals across two colours', () => {
    // Black left, white right, a red blot on the line between.
    const img = image(60, 60, (x) => (x < 30 ? 0 : 255))
    for (let y = 26; y < 34; y++) for (let x = 26; x < 34; x++) img.rgba.set([255, 0, 0, 255], (y * 60 + x) * 4)
    const out = replay(img, [stroke('heal', [0.5, 0.5, 1])])
    for (let y = 20; y < 40; y++)
      for (let x = 20; x < 40; x++) {
        const [r, g, b] = rgbAt(out, x, y)
        expect(r === g && g === b && (r === 0 || r === 255)).toBe(true)
      }
    // The line carries straight through: black on the left of it, white on the right.
    expect(at(out, 28, 30)).toBe(0)
    expect(at(out, 31, 30)).toBe(255)
  })

  it('despeckles a noisy JPEG under the brush, and only there, keeping real shapes', () => {
    // A blue disc on white, dusted with dark specks, saved as a rough JPEG.
    const w = 120
    const h = 80
    const raw = Buffer.alloc(w * h * 4)
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) raw.set(Math.hypot(x - 30, y - 40) < 18 ? [30, 60, 200, 255] : [255, 255, 255, 255], (y * w + x) * 4)
    for (let k = 0; k < 60; k++) {
      const x = 55 + Math.floor(rand() * 60)
      const y = 5 + Math.floor(rand() * 70)
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]].slice(0, 1 + Math.floor(rand() * 4))) raw.set([40, 40, 40, 255], ((y + dy) * w + x + dx) * 4)
    }
    const decoded = jpeg.decode(jpeg.encode({ data: raw, width: w, height: h }, 40).data, { useTArray: true })
    const noisy: Img = { rgba: new Uint8ClampedArray(decoded.data), width: w, height: h }
    const dark = (img: Img, x0: number, x1: number) => {
      let n = 0
      for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) if (at(img, x, y) < 160) n++
      return n
    }
    // A stroke down the specked right half, and one across the disc's edge.
    const out = replay(noisy, [stroke('despeckle', [0.72, 0.2, 1, 0.72, 0.8, 1, 0.88, 0.8, 1, 0.88, 0.2, 1], 0.25), stroke('despeckle', [0.25, 0.5, 1], 0.2)])
    expect(dark(noisy, 75, 100)).toBeGreaterThan(10)
    expect(dark(out, 75, 100)).toBe(0)
    // Outside the strokes nothing changed.
    expect(Array.from(out.rgba.slice(0, 4 * 40))).toEqual(Array.from(noisy.rgba.slice(0, 4 * 40)))
    // The disc is a shape, not a speck: it's still blue.
    const [r, , b] = rgbAt(out, 30, 40)
    expect(b - r).toBeGreaterThan(120)
  })
})

describe('fill and the magic wand (#205)', () => {
  // 40 × 20: two black rings on white, the left one 30 grey inside, the right one 60 grey inside.
  const rings = () =>
    image(40, 20, (x, y) => {
      const r = Math.max(Math.abs((x % 20) - 10), Math.abs(y - 10))
      return r === 6 ? 0 : r < 6 ? (x < 20 ? 30 : 60) : 255
    })
  const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0)
  const centre = [0.26, 0.51]

  it('takes the touching pixels within the tolerance of the one clicked', () => {
    const img = rings()
    // The left ring's inside: 11 × 11, stopped by the black ring.
    expect(count(regionOf(img, centre, 0, true))).toBe(121)
    // A tolerance of 30 reaches black from 30 grey, so the ring joins in; it still stops at the white beyond.
    expect(count(regionOf(img, centre, 30, true))).toBe(169)
    // Not touching: both insides, since 60 is within 30 of 30.
    expect(count(regionOf(img, centre, 30, false))).toBe(2 * 169)
    expect(count(regionOf(img, centre, 0, false))).toBe(121)
  })

  it('joins the regions of every point clicked, each by its own colour', () => {
    const both = regionOf(rings(), [...centre, 0.76, 0.51], 0, true)
    expect(count(both)).toBe(242)
    expect(count(regionOf(rings(), [0.01, 0.01], 0, true))).toBe(40 * 20 - 2 * 169)
  })

  it('fills in a colour, or clears to the background, and replays the same', () => {
    const filled = replay(rings(), [{ kind: 'fill', seeds: centre, tolerance: 0, contiguous: true, color: '#ff0000' }])
    expect(Array.from(filled.rgba.slice((10 * 40 + 10) * 4, (10 * 40 + 10) * 4 + 4))).toEqual([255, 0, 0, 255])
    expect(at(filled, 30, 10)).toBe(60)
    expect(at(filled, 4, 10)).toBe(0)
    // Cleared: the ring and its inside become the white round them.
    const cleared = replay(rings(), [{ kind: 'fill', seeds: [0.11, 0.51], tolerance: 0, contiguous: true }, { kind: 'fill', seeds: centre, tolerance: 0, contiguous: true }])
    expect(grid(cleared).slice(0, 20).every((row) => row.slice(0, 20).every((v) => v === 255))).toBe(true)
    expect(at(cleared, 30, 10)).toBe(60)
  })

  it('treats every transparent pixel alike, whatever colour it hides', () => {
    const img = image(10, 1, (x) => x * 20)
    for (let x = 0; x < 6; x++) img.rgba[x * 4 + 3] = 0
    expect(count(regionOf(img, [0.05, 0.5], 0, true))).toBe(6)
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
    const stroke = { kind: 'paint', tool: 'brush', color: '#AABBCC', size: 0.05, hardness: 0.5, points: [0.1, 0.2, 1, 0.3, 0.4, 0.5] }
    expect(checkCleanup([stroke])).toEqual([{ ...stroke, color: '#aabbcc' }])
    expect(checkCleanup([{ kind: 'paint', tool: 'eraser', size: 0.05, hardness: 1, points: [0.5, 0.5, 1] }])).toHaveLength(1)
    expect(checkCleanup([{ ...stroke, color: 'red' }])).toBeNull()
    expect(checkCleanup([{ ...stroke, points: [0.1, 0.2] }])).toBeNull()
    expect(checkCleanup([{ ...stroke, points: [0.1, 0.2, 2] }])).toBeNull()
    expect(checkCleanup([{ ...stroke, tool: 'eraser' }])).toBeNull() // an eraser has no colour of its own
    expect(checkCleanup([{ ...stroke, tool: 'smudge' }])).toBeNull()
    expect(checkCleanup([{ kind: 'paint', tool: 'heal', size: 0.05, hardness: 1, points: [0.5, 0.5, 1] }])).toHaveLength(1)
    expect(checkCleanup([{ ...stroke, tool: 'despeckle' }])).toBeNull() // only the brush has a colour
    expect(checkCleanup('nope')).toBeNull()
    const fill = { kind: 'fill', seeds: [0.1, 0.2, 0.3, 0.4], tolerance: 32, contiguous: true, color: '#FF0000' }
    expect(checkCleanup([fill])).toEqual([{ ...fill, color: '#ff0000' }])
    expect(checkCleanup([{ ...fill, color: undefined }])).toEqual([{ kind: 'fill', seeds: fill.seeds, tolerance: 32, contiguous: true }])
    expect(checkCleanup([{ ...fill, seeds: [0.1] }])).toBeNull()
    expect(checkCleanup([{ ...fill, seeds: [] }])).toBeNull()
    expect(checkCleanup([{ ...fill, seeds: [1.2, 0] }])).toBeNull()
    expect(checkCleanup([{ ...fill, tolerance: 300 }])).toBeNull()
    expect(checkCleanup([{ ...fill, contiguous: 'yes' }])).toBeNull()
  })
})
