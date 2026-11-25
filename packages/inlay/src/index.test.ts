import { describe, expect, it, vi } from 'vitest'
import * as inlay from './index'
import { exactPalette, parsePath, peakPalette, toSvg, trace, traceAsync, type TraceStep } from './index'

/** 40 × 20: a red square and a blue square side by side on white. */
function card() {
  const w = 40
  const h = 20
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = y >= 4 && y < 16 && x >= 4 && x < 36 ? (x < 20 ? [220, 40, 30] : [30, 60, 200]) : [255, 255, 255]
      px.set([...c, 255], (y * w + x) * 4)
    }
  return { px, w, h }
}

describe('the public API', () => {
  it('exports only what docs/package/api.md documents (#161): anything added here is frozen at 1.0', () => {
    expect(Object.keys(inlay).sort()).toEqual(
      ['boostLines', 'centerline', 'centerlineToSvg', 'deblur', 'detectSymmetry', 'edgeBlur', 'exactPalette', 'fitChain', 'isFlat', 'mapPoints', 'oklab', 'parsePath', 'peakPalette', 'pointAt', 'presets', 'quantizePalette', 'serializePath', 'smoothShading', 'toSvg', 'trace', 'traceAsync', 'traceCenterline', 'traceInlay'].sort(),
    )
  })
  it('traces to shapes as data, largest first, sharing their edge exactly', () => {
    const { px, w, h } = card()
    const r = trace(px, w, h, { mode: 'palette', palette: exactPalette(px, 8), speckle: 0, tolerance: 1, cornerAngle: 45 })
    expect(r.width).toBe(40)
    // White (largest) first; the two equal squares follow.
    expect(r.paths[0].fill).toBe('#ffffff')
    expect(r.paths.slice(1).map((p) => p.fill).sort()).toEqual(['#1e3cc8', '#dc281e'])
    // The red square's right edge and the blue square's left edge are the same line, x = 20.
    const xs = (d: string) => parsePath(d).flatMap((s) => s.nodes.map((n) => n.x))
    for (const p of r.paths.slice(1)) expect(xs(p.d)).toContain(20)
  })
  it('writes an SVG with a viewBox', () => {
    const { px, w, h } = card()
    const svg = toSvg(trace(px, w, h, { mode: 'palette', palette: peakPalette(px, 8), speckle: 0, tolerance: 1, cornerAngle: 45 }))
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="40" height="20" viewBox="0 0 40 20">/)
    expect(svg.match(/<path /g)).toHaveLength(3)
  })
  it("traces with a caller's own palette: every fill is one of its colours", () => {
    // Noisy, with soft edges, in colours that aren't the palette's: each shape
    // must still come out in one of the caller's colours, whatever the options.
    const w = 48
    const h = 32
    const px = new Uint8Array(w * h * 4)
    let seed = 3
    const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % 11) - 5
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - 16, y - 16) - 10 // a disc with a 1 px soft edge
        const t = Math.min(1, Math.max(0, 0.5 - d))
        const c = x > 30 && y > 6 && y < 26 ? [40, 70, 190] : [0, 1, 2].map((i) => t * [200, 50, 40][i] + (1 - t) * [240, 236, 228][i])
        px.set([...c.map((v) => Math.max(0, Math.min(255, Math.round(v + noise())))), 255], (y * w + x) * 4)
      }
    const palette = ['#FFFFFF', '#000000', '#ff0000', '#0000ff', '#00a000']
    const allowed = new Set(palette.map((c) => c.toLowerCase()))
    const base = { mode: 'palette' as const, palette, speckle: 2, tolerance: 1, cornerAngle: 45 }
    for (const extra of [{}, { stacked: true }, { photo: true }, { photo: true, stacked: true }, { strokes: true }, { shapes: true }]) {
      const r = trace(px, w, h, { ...base, ...extra })
      expect(r.paths.length).toBeGreaterThan(0)
      for (const p of r.paths) expect(allowed.has(p.fill), `${JSON.stringify(extra)}: ${p.fill}`).toBe(true)
    }
  })
})

describe('traceAsync (#239)', () => {
  const image = () => {
    const { px, w, h } = card()
    return { data: px, width: w, height: h }
  }

  it('gives what trace gives, reporting each stage in order', async () => {
    for (const preset of ['logo', 'poster', 'centerline'] as const) {
      const steps: TraceStep[] = []
      const r = await traceAsync(image(), { preset, onProgress: (s) => steps.push(s) })
      expect(r).toEqual(trace(image(), { preset }))
      expect(steps.length).toBeGreaterThan(0)
      if (preset !== 'centerline') expect([...new Set(steps.map((s) => s.stage))]).toEqual(['palette', 'label', 'clean', 'regions', 'fit', 'shapes'])
      for (const s of steps) expect(s.done >= 0 && s.done <= 1).toBe(true)
    }
  })

  it('stops when its signal aborts, with the signal’s reason', async () => {
    const controller = new AbortController()
    const seen: string[] = []
    const run = traceAsync(image(), {
      signal: controller.signal,
      onProgress: (s) => {
        seen.push(s.stage)
        if (s.stage === 'clean') controller.abort(new Error('stop'))
      },
    })
    await expect(run).rejects.toThrow('stop')
    expect(seen).not.toContain('fit')
  })

  it('gives the thread back once a slice is used up, so an abort from outside lands at the next pause', async () => {
    // Each step looks 20 ms after the last, so every pause hands the thread back.
    let now = 0
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 20))
    try {
      const controller = new AbortController()
      // Queued before the trace starts: it runs at the first hand-back, as a Cancel click would.
      const timer = setTimeout(() => controller.abort(new Error('cancelled')), 0)
      const seen: string[] = []
      await expect(traceAsync(image(), { signal: controller.signal, onProgress: (s) => seen.push(s.stage) })).rejects.toThrow('cancelled')
      clearTimeout(timer)
      expect(seen).toEqual(['palette'])
      // Not aborted, every step hands back and it still finishes with trace's result.
      const r = await traceAsync(image(), { preset: 'poster' })
      expect(r).toEqual(trace(image(), { preset: 'poster' }))
    } finally {
      clock.mockRestore()
    }
  })

  it('doesn’t start when the signal has already aborted, and rejects bad input', async () => {
    const steps: TraceStep[] = []
    await expect(traceAsync(image(), { signal: { aborted: true }, onProgress: (s) => steps.push(s) })).rejects.toMatchObject({ name: 'AbortError' })
    expect(steps).toEqual([])
    await expect(traceAsync({ data: new Uint8Array(4), width: 10, height: 10 })).rejects.toThrow(/RGBA/)
  })
})
