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

  it("clusters the colours of an image that isn't pixel art, so they aren't copies of one", () => {
    // A noisy grey field (a photo's background) with a small red square: its 4
    // commonest exact colours are greys a shade apart, covering under half of it.
    const n = 40
    const px = new Uint8Array(n * n * 4)
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < n * n; i++) {
      const g = 120 + Math.round(rand() * 16)
      const red = i % n >= 25 && i % n < 35 && Math.floor(i / n) >= 25 && Math.floor(i / n) < 35
      px.set(red ? [200 + Math.round(rand() * 8), 30, 40, 255] : [g, g, g, 255], i * 4)
    }
    const svg = runTrace(px, n, n, { mode: 'palette', colors: 4, palette: 'exact', pixels: true, speckle: 0, tolerance: 0.25, cornerAngle: 0 })
    const fills = new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]))
    expect([...fills].some((f) => parseInt(f.slice(1, 3), 16) > 180 && parseInt(f.slice(3, 5), 16) < 80)).toBe(true)
  })

  it("doesn't count a white page as pixel art: a JPEG drawing on one keeps its ink", () => {
    // A blue drawing on a page that is 95% exactly white; the drawing's own
    // pixels are all slightly different, so the other exact colours are near-whites.
    const n = 60
    const px = new Uint8Array(n * n * 4)
    let seed = 11
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < n * n; i++) {
      const x = i % n
      const y = Math.floor(i / n)
      const ink = (x >= 10 && x < 30 && (y === 10 || y === 11)) || (y >= 10 && y < 30 && (x === 10 || x === 11))
      const halo = !ink && x >= 8 && x < 32 && y >= 8 && y < 14
      if (ink) px.set([70 + Math.round(rand() * 20), 125 + Math.round(rand() * 20), 165 + Math.round(rand() * 20), 255], i * 4)
      else if (halo) px.set([244 + 4 * Math.floor(rand() * 3), 248 + 2 * Math.floor(rand() * 3), 252, 255], i * 4)
      else px.set([255, 255, 255, 255], i * 4)
    }
    const svg = runTrace(px, n, n, { mode: 'palette', colors: 8, palette: 'exact', pixels: true, speckle: 0, tolerance: 0.25, cornerAngle: 0 })
    const fills = [...svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1])
    expect(fills.some((f) => parseInt(f.slice(1, 3), 16) < 120)).toBe(true)
  })
})
