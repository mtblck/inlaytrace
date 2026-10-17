import { describe, expect, it } from 'vitest'
import { anchorScroll, bounds, effective, fromSlider, snap, step, toSlider, wheelFactor } from './zoom'

describe('zoom', () => {
  it('null follows fit; numbers are clamped to the range', () => {
    expect(effective(null, 2.5)).toBe(2.5)
    expect(effective(0.01, 2.5)).toBe(bounds(2.5).min)
    expect(effective(1000, 2.5)).toBe(bounds(2.5).max)
  })

  it('allows at least 16× actual size even when fit is small', () => {
    expect(bounds(0.2).max).toBe(16)
    expect(bounds(5).max).toBe(160)
  })

  it('steps land on 100% and on fit instead of skipping past them', () => {
    // fit is 0.8 (a big image): stepping in from fit crosses 100%.
    expect(step(null, 0.8, 1)).toBe(1)
    // Stepping out from 120% stops at 100% first, then at fit.
    expect(step(1.2, 0.8, -1)).toBe(1)
    expect(step(1, 0.8, -1)).toBeNull()
    // Ordinary steps are √2.
    expect(step(2, 0.8, 1)).toBeCloseTo(2 * Math.SQRT2)
  })

  it('snaps to fit within 1%', () => {
    expect(snap(2.51, 2.5)).toBeNull()
    expect(snap(2.6, 2.5)).toBe(2.6)
  })

  it('slider is log2 and round-trips', () => {
    expect(toSlider(4)).toBe(2)
    expect(fromSlider(toSlider(3.3))).toBeCloseTo(3.3)
  })

  it('wheel: pinch deltas are gentle, mouse notches are capped', () => {
    expect(wheelFactor(-4, 0)).toBeCloseTo(Math.exp(0.04))
    expect(wheelFactor(-100, 0)).toBeCloseTo(Math.exp(0.5)) // capped at 50 px
    expect(wheelFactor(3, 1)).toBeCloseTo(Math.exp(-0.48)) // lines → px
    expect(wheelFactor(10, 0)).toBeLessThan(1) // positive delta zooms out
  })

  it('keeps the point under the cursor in place', () => {
    const before = { left: 100, top: 50, width: 400, height: 300 }
    // Doubled in size around the same top-left: the point at (300, 200),
    // half-way across, is now at 100 + 400 = 500, so scroll right by 200.
    const after = { left: 100, top: 50, width: 800, height: 600 }
    expect(anchorScroll(before, after, 300, 200)).toEqual({ dx: 200, dy: 150 })
  })
})
