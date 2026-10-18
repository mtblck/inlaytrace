/**
 * Pixel art: Inlay's staircase mode against VTracer's pixel mode, on a sprite
 * with one-pixel details, diagonal steps and a colour that touches itself
 * only at a corner. Both are drawn back at pixel centres (nonzero fill, paint
 * order) and compared with the sprite, pixel for pixel.
 */
import { describe, expect, it } from 'vitest'
import { runTrace } from './run'
import { vtracer } from '../../../../scripts/vtracer.mjs'
import { parseTrace } from '../lib/svg'
import { docFromTrace } from '../lib/doc'
import { parsePath } from '../lib/pathdata'

const PAL: Record<string, [number, number, number]> = {
  '.': [92, 148, 252], // sky
  K: [24, 20, 28], // outline
  S: [252, 188, 148], // skin
  s: [244, 176, 136], // a close shade of skin: must stay separate
  R: [216, 40, 32], // cap
  W: [255, 255, 255], // eye
  G: [40, 160, 72], // grass
}
const ART = [
  '................',
  '.....KKKKK......',
  '....KRRRRRK.....',
  '...KRRRRRRRK....',
  '...KKKSSSSK.....',
  '..KSKSSWKSSK....',
  '..KSKSSSSSSSK...',
  '..KKSSSsssKK....',
  '....KSSSSSK.....',
  '...KRRKKRRK.....',
  '..KRRRRRRRRK....',
  '..KSSRRRRSSK....',
  '..KSSRRRRSSK....',
  '...KKK..KKK.....',
  'G.G.G.GGGGGGGGGG',
  'GGGGGGGGGGGGGGGG',
]
const W = 16
const H = 16

function sprite() {
  const px = new Uint8Array(W * H * 4)
  ART.forEach((row, y) => [...row].forEach((ch, x) => px.set([...PAL[ch], 255], (y * W + x) * 4)))
  return px
}

/** The colour drawn at each pixel centre: last path whose nonzero winding covers it. */
function render(svg: string) {
  const doc = docFromTrace(parseTrace(svg))
  const sx = doc.width / W
  const sy = doc.height / H
  const out: string[] = new Array(W * H).fill('')
  for (const p of doc.paths) {
    const edges: [number, number, number, number][] = []
    for (const s of parsePath(p.d)) {
      const n = s.nodes
      for (let i = 0; i < n.length; i++) {
        const a = n[i]
        const b = n[(i + 1) % n.length]
        edges.push([a.x / sx, a.y / sy, b.x / sx, b.y / sy])
      }
    }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const cx = x + 0.5
        const cy = y + 0.5
        let wind = 0
        for (const [x0, y0, x1, y1] of edges) {
          if ((y0 <= cy) === (y1 <= cy)) continue
          const xi = x0 + ((cy - y0) * (x1 - x0)) / (y1 - y0)
          if (xi > cx) wind += y1 > y0 ? 1 : -1
        }
        if (wind !== 0) out[y * W + x] = p.fill
      }
  }
  return { out, doc }
}

const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
const expected = ART.flatMap((row) => [...row].map((ch) => hex(PAL[ch])))
const stats = (svg: string) => {
  const { out, doc } = render(svg)
  const wrong = out.filter((c, i) => c !== expected[i]).length
  const nodes = doc.paths.reduce((n, p) => n + parsePath(p.d).reduce((k, s) => k + s.nodes.length, 0), 0)
  return { wrong, paths: doc.paths.length, nodes, bytes: svg.length, doc }
}

describe('pixel art', () => {
  it('Inlay draws every pixel exactly, on pixel corners, with fewer nodes than VTracer', () => {
    const inlay = stats(runTrace(sprite(), W, H, { mode: 'palette', colors: 32, palette: 'exact', pixels: true, speckle: 0, tolerance: 0.25, cornerAngle: 0 }))
    // VTracer's pixel mode, as the app used before pixel art moved to Inlay (a benchmark only now).
    const vt = stats(vtracer(sprite(), W, H, { mode: 'pixel', maxColors: 32, filterSpeckle: 0, hierarchical: 'stacked' }))
    console.log(`  pixel sprite 16×16, ${Object.keys(PAL).length} colours: Inlay ${inlay.wrong} wrong px, ${inlay.paths} paths, ${inlay.nodes} nodes, ${inlay.bytes} B; VTracer ${vt.wrong} wrong px, ${vt.paths} paths, ${vt.nodes} nodes, ${vt.bytes} B`)
    expect(inlay.wrong).toBe(0)
    for (const p of inlay.doc.paths) for (const s of parsePath(p.d)) for (const n of s.nodes) expect([n.x % 1, n.y % 1, n.in, n.out]).toEqual([0, 0, null, null])
    // The two skin shades stay two colours.
    expect(new Set(inlay.doc.paths.map((p) => p.fill))).toEqual(new Set(Object.values(PAL).map(hex)))
    expect(inlay.nodes).toBeLessThanOrEqual(vt.nodes)
  })
})
