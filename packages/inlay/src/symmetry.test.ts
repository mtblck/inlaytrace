import { describe, expect, it } from 'vitest'
import { detectSymmetry, type MirrorSymmetry, type RotationalSymmetry } from './symmetry'

type Rgba = [number, number, number, number]

/** Paint a picture from a colour function of the pixel centre. */
function paint(w: number, h: number, at: (x: number, y: number) => Rgba) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set(at(x + 0.5, y + 0.5), (y * w + x) * 4)
  return px
}
const PAPER: Rgba = [245, 240, 230, 255]
const NAVY: Rgba = [30, 60, 140, 255]
const GOLD: Rgba = [235, 170, 40, 255]
const RED: Rgba = [210, 50, 40, 255]

const mirrorOf = (found: ReturnType<typeof detectSymmetry>, o: MirrorSymmetry['orientation']) => found.find((s): s is MirrorSymmetry => s.kind === 'mirror' && s.orientation === o)!
const turnOf = (found: ReturnType<typeof detectSymmetry>, order: number) => found.find((s): s is RotationalSymmetry => s.kind === 'rotation' && s.order === order)!

describe('detectSymmetry', () => {
  // A shield off the picture's centre: its axis is x = 70, not the middle.
  const shield = paint(200, 160, (x, y) => {
    const dx = Math.abs(x - 70)
    if (y > 20 && y < 140 && dx < 40 - Math.max(0, y - 90) * 0.8) return y > 60 && y < 90 && dx < 12 ? GOLD : NAVY
    if (Math.hypot(dx - 30, y - 12) < 6) return RED // a dot each side
    return PAPER
  })

  it('finds a mirror axis, even off the centre', () => {
    const found = detectSymmetry(shield, 200, 160)
    expect(found[0]).toMatchObject({ kind: 'mirror', orientation: 'vertical', position: 70 })
    expect(found[0].score).toBeGreaterThan(0.99)
    expect(mirrorOf(found, 'horizontal').score).toBeLessThan(0.8)
  })

  it('finds a mirror axis between pixels and on a pixel', () => {
    for (const axis of [60, 60.5]) {
      const px = paint(120, 80, (x, y) => (Math.abs(x - axis) < 20 + (y % 20) && y > 10 && y < 70 ? NAVY : PAPER))
      expect(mirrorOf(detectSymmetry(px, 120, 80), 'vertical').position).toBe(axis)
    }
  })

  it('finds rotational symmetry and its order', () => {
    // Five petals round (100, 90), each lopsided so there's no mirror axis.
    const px = paint(200, 200, (x, y) => {
      const r = Math.hypot(x - 100, y - 90)
      const t = Math.atan2(y - 90, x - 100)
      const phase = (((t / (2 * Math.PI)) * 5) % 1 + 1) % 1
      if (r < 12) return RED
      return r < 30 + 50 * phase * (1 - phase) * 4 * (phase < 0.7 ? 1 : 0) ? NAVY : PAPER
    })
    const found = detectSymmetry(px, 200, 200)
    expect(found[0]).toMatchObject({ kind: 'rotation', order: 5 })
    expect(found[0].score).toBeGreaterThan(0.95)
    expect(Math.abs((found[0] as RotationalSymmetry).cx - 100)).toBeLessThanOrEqual(1)
    expect(Math.abs((found[0] as RotationalSymmetry).cy - 90)).toBeLessThanOrEqual(1)
    expect(turnOf(found, 4).score).toBeLessThan(0.7)
    expect(mirrorOf(found, 'vertical').score).toBeLessThan(0.8)
  })

  it('scores a lopsided drawing low everywhere', () => {
    const px = paint(160, 120, (x, y) => (x < 50 && y < 90 ? NAVY : x > 90 && y > 80 ? GOLD : PAPER))
    for (const s of detectSymmetry(px, 160, 120)) expect(s.score).toBeLessThan(0.8)
  })

  it('treats transparency as the background', () => {
    const px = paint(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 30 && x < 70 ? NAVY : [0, 0, 0, 0]))
    expect(mirrorOf(detectSymmetry(px, 100, 100), 'horizontal')).toMatchObject({ position: 50 })
  })

  it('returns nothing for an empty picture', () => {
    expect(detectSymmetry(paint(40, 40, () => PAPER), 40, 40)).toEqual([])
    expect(detectSymmetry(new Uint8ClampedArray(0), 0, 0)).toEqual([])
  })
})
