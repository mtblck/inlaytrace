#!/usr/bin/env node
/**
 * Score the presets against clean source art: `npm run score`.
 *
 * Traces the built-in sample badge exactly as the app receives it (rendered at
 * 640 px, JPEG q72), renders each SVG back in Chromium at 4×, and counts the
 * pixels that differ noticeably from the clean art rendered at 4×. 4× is what
 * makes wobbly edges and rounded corners count; at 1× they hide inside the
 * anti-aliasing. Also reports nodes (path segments) and size.
 *
 * Then two symmetric marks (scripts/fixtures/emblem.svg, pinwheel.svg) traced
 * with Logo, and again after the Mirror tool enforces what detectSymmetry finds:
 * asymmetry is the share of the drawing that differs from its own reflection.
 *
 * Re-run this before shipping any change to the tracer, the fitter or a preset
 * (see docs/design-notes.md, "Tuning the presets").
 *
 *   CHROME_PATH=/path/to/chrome npm run score
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 640
const K = 4

// Load the app's own TypeScript modules through Vite, so this scores exactly what ships.
const vite = await createServer({ root: join(root, 'apps/app'), logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' })
const { runTrace } = await vite.ssrLoadModule('/src/engine/run.ts')
const { PRESETS, settingsFor, toTraceOptions } = await vite.ssrLoadModule('/src/engine/presets.ts')

const ART = readFileSync(join(root, 'apps/app/src/lib/sample.ts'), 'utf8').match(/const ART = `([\s\S]*?)`/)[1]
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage()
await page.goto('about:blank')

// The input (JPEG, as the app's sample) and the reference (clean, at 4×, kept in the page).
const prepare = async (art) => {
  const b64 = await page.evaluate(
  async ({ art, size, k }) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art)
    await img.decode()
    const c = new OffscreenCanvas(size, size)
    c.getContext('2d').drawImage(img, 0, 0, size, size)
    const jpg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.72 })
    const d = new OffscreenCanvas(size, size)
    d.getContext('2d').drawImage(await createImageBitmap(jpg), 0, 0)
    const px = d.getContext('2d').getImageData(0, 0, size, size).data
    const r = new OffscreenCanvas(size * k, size * k)
    r.getContext('2d').drawImage(img, 0, 0, size * k, size * k)
    window.__ref = r.getContext('2d').getImageData(0, 0, size * k, size * k).data
    let s = ''
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000))
    return btoa(s)
  },
  { art, size: SIZE, k: K },
  )
  return new Uint8Array(Buffer.from(b64, 'base64'))
}
const pixels = await prepare(ART)

async function score(svg, tolerance = 96) {
  const wrong = await page.evaluate(
    async ({ svg, size, k, tolerance }) => {
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const c = new OffscreenCanvas(size * k, size * k)
      const x = c.getContext('2d')
      x.fillStyle = '#ffffff' // a missing shape counts as wrong rather than matching anything
      x.fillRect(0, 0, size * k, size * k)
      x.drawImage(img, 0, 0, size * k, size * k)
      const d = x.getImageData(0, 0, size * k, size * k).data
      const ref = window.__ref
      let bad = 0
      for (let i = 0; i < d.length; i += 4)
        if (Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2]) > tolerance) bad++
      return (bad / (d.length / 4)) * 100
    },
    { svg, size: SIZE, k: K, tolerance },
  )
  const nodes = [...svg.matchAll(/\bd="([^"]*)"/g)].reduce((n, m) => n + (m[1].match(/[MLCQSTHVAmlcqsthva]/g) ?? []).length, 0)
  return { wrong, nodes, paths: (svg.match(/<path\b/g) ?? []).length, kb: svg.length / 1024 }
}

console.log(`\n  Sample badge, ${SIZE} px JPEG q72, scored at ${K}× against the clean art\n`)
console.log('  Preset         Tracer     Wrong px   Nodes  Paths   Size')
for (const p of PRESETS) {
  if (p.id === 'lineart' || p.id === 'pixel') continue // one colour / no smoothing: not comparable on a colour badge
  const t = performance.now()
  const svg = runTrace(pixels.slice(), SIZE, SIZE, toTraceOptions(settingsFor(p.id)))
  const ms = performance.now() - t
  const r = await score(svg)
  console.log(
    `  ${p.label.padEnd(14)} ${'Inlay'.padEnd(10)} ${r.wrong.toFixed(2).padStart(7)}%  ${String(r.nodes).padStart(6)} ${String(r.paths).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB  (${ms.toFixed(0)} ms)`,
  )
}

// ---- Symmetry -------------------------------------------------------------
// The Mirror tool runs in the app on paper.js; here it runs under jsdom, with
// an inert canvas for paper's import-time feature check (as the app's tests do).
const dom = new JSDOM('')
globalThis.window = globalThis.self = dom.window
globalThis.document = dom.window.document
globalThis.DOMParser = dom.window.DOMParser
const inert = new Proxy(function () {}, {
  get: (_t, k) => (k === Symbol.toPrimitive ? () => 1 : k === 'canvas' ? undefined : inert),
  apply: () => inert,
})
dom.window.HTMLCanvasElement.prototype.getContext = () => inert
const paper = createRequire(import.meta.url)('paper/dist/paper-core')
const { detectSymmetry } = await vite.ssrLoadModule('inlaytrace')
const { likelyAxis, mirrorDoc } = await vite.ssrLoadModule('/src/lib/mirror.ts')
const { parseTrace } = await vite.ssrLoadModule('/src/lib/svg.ts')
const { docFromTrace, buildSvg } = await vite.ssrLoadModule('/src/lib/doc.ts')

/** The share of the drawing (pixels that aren't background) that differs from its reflection or turn. */
const asymmetry = (svg, axis) =>
  page.evaluate(
    async ({ svg, size, k, axis }) => {
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const n = size * k
      const draw = (flip) => {
        const c = new OffscreenCanvas(n, n)
        const x = c.getContext('2d')
        x.fillStyle = '#ffffff'
        x.fillRect(0, 0, n, n)
        if (flip) flip(x)
        x.drawImage(img, 0, 0, n, n)
        return x.getImageData(0, 0, n, n).data
      }
      const a = draw()
      const b = draw((x) => {
        if (axis.orientation === 'vertical') x.setTransform(-1, 0, 0, 1, 2 * axis.position * k, 0)
        else if (axis.orientation === 'horizontal') x.setTransform(1, 0, 0, -1, 0, 2 * axis.position * k)
        else {
          x.translate(axis.cx * k, axis.cy * k)
          x.rotate((2 * Math.PI) / axis.order)
          x.translate(-axis.cx * k, -axis.cy * k)
        }
      })
      let bad = 0
      let ink = 0
      for (let i = 0; i < a.length; i += 4) {
        const paper = a[i] > 240 && a[i + 1] > 235 && a[i + 2] > 220
        if (!paper) ink++
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 96) bad++
      }
      return (bad / ink) * 100
    },
    { svg, size: SIZE, k: K, axis },
  )

for (const [file, title] of [
  ['emblem.svg', 'Symmetric emblem'],
  ['pinwheel.svg', 'Pinwheel (turns, no mirror)'],
]) {
  const art = await prepare(readFileSync(join(root, 'scripts/fixtures', file), 'utf8'))
  let t = performance.now()
  const found = detectSymmetry(art, SIZE, SIZE)
  const detectMs = performance.now() - t
  const axis = likelyAxis(found)
  console.log(`\n  ${title}, ${SIZE} px JPEG q72, traced with Logo`)
  console.log(
    `  Detected: ${axis ? (axis.orientation === 'rotation' ? `turn of order ${axis.order} at (${axis.cx}, ${axis.cy})` : `${axis.orientation} axis at ${axis.position}`) : 'nothing likely'}` +
      ` (${(found[0].score * 100).toFixed(1)}% match; next best ${(found[1].score * 100).toFixed(1)}%; ${detectMs.toFixed(0)} ms)\n`,
  )
  console.log('                 Wrong px   Asymmetry   Nodes   Size')
  const logo = runTrace(art.slice(), SIZE, SIZE, toTraceOptions(settingsFor('logo')))
  const rows = [['Traced', logo]]
  if (axis) {
    t = performance.now()
    const svg = buildSvg(mirrorDoc(paper, docFromTrace(parseTrace(logo)), axis))
    rows.push([axis.orientation === 'rotation' ? 'Turned' : 'Mirrored', svg, performance.now() - t])
  }
  for (const [label, svg, ms] of rows) {
    const r = await score(svg)
    const asym = axis ? await asymmetry(svg, axis) : NaN
    console.log(`  ${label.padEnd(14)} ${r.wrong.toFixed(2).padStart(7)}%  ${asym.toFixed(2).padStart(9)}%  ${String(r.nodes).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB${ms ? `  (${ms.toFixed(0)} ms)` : ''}`)
  }
}

// ---- Centerline -------------------------------------------------------------
// A pen drawing: Centerline's single strokes against Line art's outlines, both
// scored against the clean drawing. Strokes are where a plotter lifts its pen.
{
  const art = await prepare(readFileSync(join(root, 'scripts/fixtures/strokes.svg'), 'utf8'))
  console.log(`\n  Pen drawing (strokes ${(3 * SIZE) / 200} px wide), ${SIZE} px JPEG q72\n`)
  console.log('  Preset         Wrong px   Strokes  Nodes   Size   Stroke width')
  for (const id of ['centerline', 'lineart']) {
    const t = performance.now()
    const svg = runTrace(art.slice(), SIZE, SIZE, toTraceOptions(settingsFor(id)))
    const ms = performance.now() - t
    const r = await score(svg)
    const subpaths = (svg.match(/M/g) ?? []).length
    const width = svg.match(/stroke-width="([\d.]+)"/)?.[1]
    console.log(
      `  ${PRESETS.find((p) => p.id === id).label.padEnd(14)} ${r.wrong.toFixed(2).padStart(6)}%  ${String(id === 'centerline' ? subpaths : '–').padStart(7)} ${String(r.nodes).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB  ${width ? `${width} px` : '–'}  (${ms.toFixed(0)} ms)`,
    )
  }
}
// ---- Outline illustration ---------------------------------------------------
// Thin mid-blue outlines on white with pale tinted fills. A pale fill differs
// from white by under 96, so this counts a pixel wrong past 24 instead: a
// missing fill is wrong here, where on the badge it would hide.
{
  const art = await prepare(readFileSync(join(root, 'scripts/fixtures/outline.svg'), 'utf8'))
  console.log(`\n  Outline illustration (outlines ${(1 * SIZE) / 200} px wide, pale fills), ${SIZE} px JPEG q72, wrong past 24\n`)
  console.log('  Preset         Wrong px   Nodes  Paths   Size')
  for (const id of ['logo', 'illustration', 'outline', 'lineart', 'photo']) {
    const t = performance.now()
    const svg = runTrace(art.slice(), SIZE, SIZE, toTraceOptions(settingsFor(id)))
    const ms = performance.now() - t
    const r = await score(svg, 24)
    console.log(
      `  ${PRESETS.find((p) => p.id === id).label.padEnd(14)} ${r.wrong.toFixed(2).padStart(6)}%  ${String(r.nodes).padStart(6)} ${String(r.paths).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB  (${ms.toFixed(0)} ms)`,
    )
  }
}
console.log()
await browser.close()
await vite.close()
