#!/usr/bin/env node
/**
 * Score the Poster preset on real photos: `npm run score:photos`.
 *
 * `npm run score` measures against clean art, which photos don't have, so
 * here the reference is the photo itself. Each photo in
 * scripts/fixtures/photos/ is traced by Poster as the app runs it (Inlay, a
 * quantized palette, stacked shapes) and by VTracer as Poster ran it before
 * #53, plus variations (VARIANTS=more,noise); each SVG is
 * rendered back at 1× in Chromium and compared with the photo:
 *
 *  - mean error: the average per-channel difference, 0–255 (lower is closer);
 *  - paths, nodes (path commands, as `npm run score` counts them), size (raw
 *    SVG bytes), and the time to trace.
 *
 *   CHROME_PATH=/path/to/chrome npm run score:photos
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { vtracer } from './vtracer.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'scripts/fixtures/photos')

const vite = await createServer({ root: join(root, 'apps/app'), logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' })
const { runTrace } = await vite.ssrLoadModule('/src/engine/run.ts')
const { settingsFor, toTraceOptions, toleranceFor } = await vite.ssrLoadModule('/src/engine/presets.ts')
const { traceInlay, quantizePalette } = await vite.ssrLoadModule('inlaytrace')

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage()
await page.goto('about:blank')

/** Decode a photo to RGBA in the browser, as the app does. */
async function pixelsOf(file) {
  const b64 = readFileSync(join(dir, file)).toString('base64')
  const { w, h, data } = await page.evaluate(async (b64) => {
    const img = new Image()
    img.src = 'data:image/jpeg;base64,' + b64
    await img.decode()
    const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight)
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0)
    window.__ref = x.getImageData(0, 0, c.width, c.height).data
    const px = window.__ref
    let s = ''
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000))
    return { w: c.width, h: c.height, data: btoa(s) }
  }, b64)
  return { w, h, rgba: new Uint8ClampedArray(Buffer.from(data, 'base64')) }
}

/** Render an SVG at the photo's size and compare with it (the photo is in window.__ref). */
const meanError = (svg, w, h) =>
  page.evaluate(
    async ({ svg, w, h }) => {
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const c = new OffscreenCanvas(w, h)
      const x = c.getContext('2d')
      x.fillStyle = '#ffffff'
      x.fillRect(0, 0, w, h)
      x.drawImage(img, 0, 0, w, h)
      const d = x.getImageData(0, 0, w, h).data
      const ref = window.__ref
      let sum = 0
      for (let i = 0; i < d.length; i += 4) sum += Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2])
      return sum / ((d.length / 4) * 3)
    },
    { svg, w, h },
  )

const stats = (svg) => ({
  paths: (svg.match(/<path\b/g) ?? []).length,
  nodes: [...svg.matchAll(/\bd="([^"]*)"/g)].reduce((n, m) => n + (m[1].match(/[MLCQSTHVAmlcqsthva]/g) ?? []).length, 0),
  kb: svg.length / 1024,
})

const poster = settingsFor('photo')
/** Box blur, radius r (separable, edges clamped): an experiment in steadying photo noise. */
function blur(px, w, h, r) {
  if (!r) return px
  const out = new Uint8ClampedArray(px.length)
  const tmp = new Float32Array(px.length)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0
        for (let k = -r; k <= r; k++) s += px[(y * w + Math.min(w - 1, Math.max(0, x + k))) * 4 + c]
        tmp[(y * w + x) * 4 + c] = s / n
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0
        for (let k = -r; k <= r; k++) s += tmp[(Math.min(h - 1, Math.max(0, y + k)) * w + x) * 4 + c]
        out[(y * w + x) * 4 + c] = s / n
      }
  return out
}
const inlay = (over = {}) => {
  const o = { colors: poster.colors, speckle: poster.speckle, tolerance: toleranceFor(poster.smoothing), cornerAngle: poster.corners, stacked: true, blur: 0, ...over }
  return (px, w, h) => {
    const src = blur(px, w, h, o.blur)
    return traceInlay(src, w, h, { mode: 'palette', palette: quantizePalette(src, o.colors), speckle: o.speckle, tolerance: o.tolerance, cornerAngle: o.cornerAngle, stacked: o.stacked })
  }
}
const variants = (process.env.VARIANTS ?? 'default').split(',')
const tracers = [
  // Poster as the app ran it on VTracer until #53: spline mode, its own quantizer.
  ['VTracer (Poster before #53)', (px, w, h) => vtracer(px, w, h, { mode: 'spline', filterSpeckle: poster.speckle, hierarchical: poster.shapes, cornerThreshold: poster.corners, simplify: poster.smoothing, maxColors: poster.colors })],
  ['Inlay (Poster now)', (px, w, h) => runTrace(px, w, h, toTraceOptions(poster))],
  ['Inlay, cut out', inlay({ stacked: false })],
  ...(variants.includes('more')
    ? [
        ['Inlay, stacked, 32 colours', inlay({ colors: 32 })],
        ['Inlay, stacked, speckle 4', inlay({ speckle: 4 })],
        ['Inlay, stacked, tolerance 1.25', inlay({ tolerance: 1.25 })],
      ]
    : []),
  ...(variants.includes('noise')
    ? [
        ['Inlay, blur 1', inlay({ blur: 1 })],
        ['Inlay, blur 2', inlay({ blur: 2 })],
        ['Inlay, speckle 12', inlay({ speckle: 12 })],
        ['Inlay, speckle 16', inlay({ speckle: 16 })],
        ['Inlay, blur 1, speckle 12', inlay({ blur: 1, speckle: 12 })],
        ['Inlay, blur 2, speckle 12, 16 col', inlay({ blur: 2, speckle: 12, colors: 16 })],
      ]
    : []),
]

const totals = new Map()
for (const file of readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort()) {
  const { w, h, rgba } = await pixelsOf(file)
  console.log(`\n  ${file} (${w} × ${h})\n`)
  console.log('  tracer                          mean err   paths    nodes      size     time')
  for (const [name, fn] of tracers) {
    const t0 = performance.now()
    const svg = fn(rgba.slice(), w, h)
    const ms = performance.now() - t0
    const err = await meanError(svg, w, h)
    const s = stats(svg)
    console.log(
      `  ${name.padEnd(30)} ${err.toFixed(2).padStart(9)} ${String(s.paths).padStart(7)} ${String(s.nodes).padStart(8)} ${s.kb.toFixed(1).padStart(7)} KB ${ms.toFixed(0).padStart(6)} ms`,
    )
    const t = totals.get(name) ?? { err: 0, paths: 0, nodes: 0, kb: 0, ms: 0, n: 0 }
    totals.set(name, { err: t.err + err, paths: t.paths + s.paths, nodes: t.nodes + s.nodes, kb: t.kb + s.kb, ms: t.ms + ms, n: t.n + 1 })
  }
}
console.log('\n  Average over the photos\n')
for (const [name, t] of totals)
  console.log(
    `  ${name.padEnd(30)} ${(t.err / t.n).toFixed(2).padStart(9)} ${String(Math.round(t.paths / t.n)).padStart(7)} ${String(Math.round(t.nodes / t.n)).padStart(8)} ${(t.kb / t.n).toFixed(1).padStart(7)} KB ${(t.ms / t.n).toFixed(0).padStart(6)} ms`,
  )
await browser.close()
await vite.close()
process.exit(0)
