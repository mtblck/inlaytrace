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
 * Re-run this before shipping any change to the tracer, the fitter or a preset
 * (see docs/design-notes.md, "Tuning the presets").
 *
 *   CHROME_PATH=/path/to/chrome npm run score
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
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

// The input (JPEG, as the app's sample) and the reference (clean, at 4×).
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
  { art: ART, size: SIZE, k: K },
)
const pixels = new Uint8Array(Buffer.from(b64, 'base64'))

async function score(svg) {
  const wrong = await page.evaluate(
    async ({ svg, size, k }) => {
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
        if (Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2]) > 96) bad++
      return (bad / (d.length / 4)) * 100
    },
    { svg, size: SIZE, k: K },
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
console.log()
await browser.close()
await vite.close()
