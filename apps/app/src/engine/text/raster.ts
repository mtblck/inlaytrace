import type { PathCommand } from 'opentype.js'

/** Steps a curve is flattened into: glyphs at matching sizes are tens of pixels at most. */
const CURVE_STEPS = 8

/**
 * Glyph outlines as anti-aliased coverage (0–1 per pixel), nonzero winding,
 * 4 × 4 samples a pixel. Small and exact enough to compare a font's word with
 * the image's, and quicker than a canvas round trip for hundreds of fonts.
 */
export function rasterize(commands: PathCommand[], w: number, h: number, ss = 4): Float32Array {
  const edges: [number, number, number, number, number][] = [] // x0 y0 x1 y1 dir, y0 < y1, in samples
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    if (y0 === y1) return
    if (y0 < y1) edges.push([x0 * ss, y0 * ss, x1 * ss, y1 * ss, 1])
    else edges.push([x1 * ss, y1 * ss, x0 * ss, y0 * ss, -1])
  }
  let sx = 0
  let sy = 0
  let cx = 0
  let cy = 0
  for (const c of commands) {
    if (c.type === 'M') {
      cx = sx = c.x
      cy = sy = c.y
    } else if (c.type === 'L') {
      line(cx, cy, c.x, c.y)
      cx = c.x
      cy = c.y
    } else if (c.type === 'Q' || c.type === 'C') {
      let px = cx
      let py = cy
      for (let i = 1; i <= CURVE_STEPS; i++) {
        const t = i / CURVE_STEPS
        const u = 1 - t
        const x = c.type === 'Q' ? u * u * cx + 2 * u * t * c.x1 + t * t * c.x : u * u * u * cx + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x
        const y = c.type === 'Q' ? u * u * cy + 2 * u * t * c.y1 + t * t * c.y : u * u * u * cy + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y
        line(px, py, x, y)
        px = x
        py = y
      }
      cx = c.x
      cy = c.y
    } else {
      line(cx, cy, sx, sy)
      cx = sx
      cy = sy
    }
  }
  const out = new Float32Array(w * h)
  const W = w * ss
  const inc = 1 / (ss * ss)
  const xs: [number, number][] = []
  for (let row = 0; row < h * ss; row++) {
    const y = row + 0.5
    xs.length = 0
    for (const e of edges) if (y >= e[1] && y < e[3]) xs.push([e[0] + ((y - e[1]) / (e[3] - e[1])) * (e[2] - e[0]), e[4]])
    if (!xs.length) continue
    xs.sort((a, b) => a[0] - b[0])
    const at = Math.floor(row / ss) * w
    let wind = 0
    for (let i = 0; i < xs.length - 1; i++) {
      wind += xs[i][1]
      if (!wind) continue
      const a = Math.max(0, Math.ceil(xs[i][0] - 0.5))
      const b = Math.min(W, Math.ceil(xs[i + 1][0] - 0.5))
      for (let x = a; x < b; x++) out[at + Math.floor(x / ss)] += inc
    }
  }
  return out
}
