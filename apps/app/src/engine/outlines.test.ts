/**
 * Keep painted outlines, end to end: settings → toTraceOptions → runTrace →
 * SVG, drawn back at pixel centres. A dark trouser leg on a dark, textured
 * background, its lit side within a few levels of the background and parted
 * from it only by a faint outline (Howl's trousers on the film poster). Colour
 * alone joins the lit side to the background; with the option on it must stay
 * a shape of its own, with Smooth painted shading off and on (smoothing once
 * blurred the found outline back into its sides).
 */
import { describe, expect, it } from 'vitest'
import { runTrace } from './run'
import { settingsFor, toTraceOptions } from './presets'
import { parseTrace } from '../lib/svg'
import { docFromTrace } from '../lib/doc'
import { parsePath } from '../lib/pathdata'

const W = 96
const H = 80
const BG = [30, 28, 36]
const CORE = [10, 10, 12]
const LIT = [31, 30, 37]
const LINE = [20, 19, 23]

/** The leg, top to bottom: an outline at x 18–19, core to 47, lit side to 59, an outline at 60–61. */
function painting() {
  const px = new Uint8Array(W * H * 4)
  let seed = 11
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const inLeg = x >= 18 && x <= 61
      const edge = inLeg && (x <= 19 || x >= 60)
      const c = !inLeg ? BG : edge ? LINE : x <= 47 ? CORE : LIT
      // Brush texture: a few levels either way.
      const n = Math.round((rand() - 0.5) * 6)
      px.set([c[0] + n, c[1] + n, c[2] + n, 255], (y * W + x) * 4)
    }
  return px
}

/** The index of the last path covering each pixel centre (nonzero winding), -1 for none. */
function render(svg: string) {
  const doc = docFromTrace(parseTrace(svg))
  const sx = doc.width / W
  const sy = doc.height / H
  const out = new Int32Array(W * H).fill(-1)
  doc.paths.forEach((p, k) => {
    const edges: [number, number, number, number][] = []
    for (const s of parsePath(p.d))
      for (let i = 0; i < s.nodes.length; i++) {
        const a = s.nodes[i]
        const b = s.nodes[(i + 1) % s.nodes.length]
        edges.push([a.x / sx, a.y / sy, b.x / sx, b.y / sy])
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let wind = 0
        for (const [x0, y0, x1, y1] of edges) {
          if (y0 <= y + 0.5 === y1 <= y + 0.5) continue
          if (x0 + ((y + 0.5 - y0) * (x1 - x0)) / (y1 - y0) > x + 0.5) wind += y1 > y0 ? 1 : -1
        }
        if (wind) out[y * W + x] = k
      }
  })
  return out
}

/** The path drawn over most of a box's pixel centres. */
function drawnOver(at: Int32Array, x0: number, y0: number, x1: number, y1: number) {
  const count = new Map<number, number>()
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) count.set(at[y * W + x], (count.get(at[y * W + x]) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0][0]
}

const trace = (extra: object) => render(runTrace(painting(), W, H, toTraceOptions({ ...settingsFor('illustration'), ...extra })))
// Well inside each area, clear of the outline.
const background = (at: Int32Array) => drawnOver(at, 70, 10, 90, 70)
const lit = (at: Int32Array) => drawnOver(at, 51, 10, 56, 70)
const core = (at: Int32Array) => drawnOver(at, 25, 10, 42, 70)

describe('Keep painted outlines', () => {
  it('without it, the lit side joins the background', () => {
    const at = trace({})
    expect(lit(at)).toBe(background(at))
  })

  for (const smoothShading of [false, true])
    it(`keeps the lit side apart from the background${smoothShading ? ', with smoothed shading' : ''}`, () => {
      const at = trace({ keepOutlines: true, smoothShading })
      expect(lit(at)).not.toBe(background(at))
      expect(lit(at)).not.toBe(core(at))
      expect(core(at)).not.toBe(background(at))
    })
})
