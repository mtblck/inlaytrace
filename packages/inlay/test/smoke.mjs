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
// The preset form (0.4): the same Logo trace from { data, width, height }.
const viaPreset = trace({ data: rgba, width: w, height: h }, { preset: 'logo', speckle: 4 })
assert.equal(viaPreset.paths.length, 2, 'the preset form traces the same two shapes')
const svg = toSvg(result)
assert.match(svg, /^<svg [^>]*viewBox="0 0 64 64"/)
console.log(`  smoke ok: ${result.paths.length} shapes, the disc in ${nodes} nodes, ${svg.length} bytes of SVG`)

// The command line (#165): a PNG in, an SVG out, through the bin npm installs.
{
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { deflateSync } = await import('node:zlib')
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (b) => {
    let c = 0xffffffff
    for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (kind, body) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(body.length, 0)
    head.write(kind, 4, 'latin1')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])))
    return Buffer.concat([head, body, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const rows = []
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)))
  const file = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))])
  const dir = mkdtempSync(join(tmpdir(), 'inlaytrace-'))
  writeFileSync(join(dir, 'disc.png'), file)
  const bin = new URL('../bin/inlaytrace.mjs', import.meta.url).pathname
  execFileSync(process.execPath, [bin, join(dir, 'disc.png'), '-o', join(dir, 'disc.svg'), '--speckle', '4'], { stdio: 'pipe' })
  const out = readFileSync(join(dir, 'disc.svg'), 'utf8')
  assert.equal(out, toSvg(trace({ data: rgba, width: w, height: h }, { speckle: 4 })), 'the CLI writes the same SVG as trace()')
  const help = execFileSync(process.execPath, [bin, '--help'], { encoding: 'utf8' })
  assert.match(help, /Usage: inlaytrace <image>/)
  console.log('  smoke ok: the CLI traced a PNG to the same SVG')
}
