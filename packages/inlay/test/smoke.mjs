/**
 * The built package as an npm user gets it: plain Node, no TypeScript, no
 * bundler. Traces a two-colour image and checks the result is usable SVG.
 * Run after `npm run build` (CI does): `node test/smoke.mjs`.
 */
import assert from 'node:assert/strict'
import { trace, toSvg, peakPalette, parsePath } from 'inlaytrace'

// 64 × 64: a red disc on white.
const w = 64
const h = 64
const rgba = new Uint8ClampedArray(w * h * 4)
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const inside = (x - 32) ** 2 + (y - 32) ** 2 < 20 ** 2
    rgba.set(inside ? [220, 40, 40, 255] : [255, 255, 255, 255], i)
  }

const palette = peakPalette(rgba, 4)
assert.equal(palette.length, 2, `two colours found (${palette})`)
const result = trace(rgba, w, h, { mode: 'palette', palette, speckle: 4, tolerance: 1, cornerAngle: 45 })
assert.equal(result.width, w)
assert.equal(result.paths.length, 2, 'background and disc')
for (const p of result.paths) assert.ok(parsePath(p.d).length > 0, `parsable path data: ${p.d.slice(0, 40)}`)
// A disc fits as a handful of curves, not a pixel outline.
const disc = result.paths.find((p) => p.fill !== '#ffffff')
const nodes = parsePath(disc.d).flatMap((s) => s.nodes).length
assert.ok(nodes >= 4 && nodes <= 8, `the disc is ${nodes} nodes`)
const svg = toSvg(result)
assert.match(svg, /^<svg [^>]*viewBox="0 0 64 64"/)
console.log(`  smoke ok: ${result.paths.length} shapes, the disc in ${nodes} nodes, ${svg.length} bytes of SVG`)
