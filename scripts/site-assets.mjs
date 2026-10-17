#!/usr/bin/env node
/**
 * The landing page's evidence, made from the real tracers rather than drawn:
 * `npm run site:assets` (then commit apps/site/src/data/sample.json).
 *
 * Traces the app's sample badge as the app receives it (640 px, JPEG q72)
 * with Inlay (the Logo preset) and with VTracer as the Logo preset used it
 * before Inlay (each colour traced on its own, cut out, peak palette). Both are
 * rendered at 4× and compared with the clean source art, as `npm run score`
 * does. The close-up is a fixed 48 px window on the left peak, picked by eye:
 * the window where VTracer is most wrong by pixel count is a gentle curve where
 * the two look the same, and the page's claim is about corners and straight
 * edges. Its wrong-pixel counts are measured, not chosen.
 *
 * It also measures the seams: where two shapes meet, how far apart the two
 * copies of their shared edge are. On this sample both tracers keep them
 * together (VTracer to within about 0.06 px), so the page doesn't claim that
 * VTracer leaves gaps here; what differs is how well each follows the art.
 *
 *   CHROME_PATH=/path/to/chrome npm run site:assets
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SIZE = 640
const K = 4 // render scale, as npm run score
const WIN = 48 // close-up window, in trace pixels
const CROP = { x: 200, y: 240 } // the left peak and its snowcap

const vite = await createServer({ root: join(root, 'apps/app'), logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' })
const { runTrace } = await vite.ssrLoadModule('/src/engine/run.ts')
const { settingsFor, toVtracerOptions } = await vite.ssrLoadModule('/src/engine/presets.ts')
const { init } = await vite.ssrLoadModule('/src/engine/vtracer/vtracer.js')
const { parsePath } = await vite.ssrLoadModule('inlaytrace')
globalThis.fetch = async () => new Response(readFileSync(join(root, 'apps/app/src/engine/vtracer/vtracer.wasm')), { headers: { 'content-type': 'application/wasm' } })
await init('vtracer.wasm')
const ART = readFileSync(join(root, 'apps/app/src/lib/sample.ts'), 'utf8').match(/const ART = `([\s\S]*?)`/)[1]

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const page = await browser.newPage()
await page.goto('about:blank')
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
    const r = new OffscreenCanvas(size * k, size * k)
    r.getContext('2d').drawImage(img, 0, 0, size * k, size * k)
    window.__ref = r.getContext('2d').getImageData(0, 0, size * k, size * k).data
    const px = d.getContext('2d').getImageData(0, 0, size, size).data
    let s = ''
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000))
    return btoa(s)
  },
  { art: ART, size: SIZE, k: K },
)
const pixels = new Uint8Array(Buffer.from(b64, 'base64'))

const paths = (svg) =>
  [...svg.matchAll(/<path\b[^>]*\/>/g)].map(([tag]) => {
    const at = (n) => tag.match(new RegExp(`\\b${n}="([^"]*)"`))?.[1]
    return { d: at('d'), fill: at('fill'), ...(at('transform') ? { transform: at('transform') } : {}) }
  })
const inlaySvg = runTrace(pixels.slice(), SIZE, SIZE, toVtracerOptions(settingsFor('logo')))
const vtSvg = runTrace(pixels.slice(), SIZE, SIZE, { mode: 'spline', hierarchical: 'cutout', filterSpeckle: 8, cornerThreshold: 45, simplify: 1.5, peakColors: 8, layerDifference: 32 })
const inlay = paths(inlaySvg)
const percolour = paths(vtSvg)

// Wrong pixels against the clean art at 4×, overall and per window.
const wrong = await page.evaluate(
  async ({ a, b, size, k, win, crop }) => {
    const toSvg = (ps) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${ps.map((p) => `<path d="${p.d}" fill="${p.fill}"${p.transform ? ` transform="${p.transform}"` : ''}/>`).join('')}</svg>`
    const ref = window.__ref
    const n = size * k
    const map = async (ps) => {
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(toSvg(ps))
      await img.decode()
      const c = new OffscreenCanvas(n, n)
      const x = c.getContext('2d')
      x.fillStyle = '#ffffff'
      x.fillRect(0, 0, n, n)
      x.drawImage(img, 0, 0, n, n)
      const d = x.getImageData(0, 0, n, n).data
      const bad = new Uint8Array(n * n)
      let total = 0
      for (let i = 0; i < n * n; i++) {
        const j = i * 4
        if (Math.abs(d[j] - ref[j]) + Math.abs(d[j + 1] - ref[j + 1]) + Math.abs(d[j + 2] - ref[j + 2]) > 96) {
          bad[i] = 1
          total++
        }
      }
      return { bad, pct: (total / (n * n)) * 100 }
    }
    const A = await map(a)
    const B = await map(b)
    const integral = (bad) => {
      const s = new Float64Array((n + 1) * (n + 1))
      for (let y = 0; y < n; y++) {
        let row = 0
        for (let x = 0; x < n; x++) {
          row += bad[y * n + x]
          s[(y + 1) * (n + 1) + x + 1] = s[y * (n + 1) + x + 1] + row
        }
      }
      return (x0, y0, w) => s[(y0 + w) * (n + 1) + x0 + w] - s[y0 * (n + 1) + x0 + w] - s[(y0 + w) * (n + 1) + x0] + s[y0 * (n + 1) + x0]
    }
    const IA = integral(A.bad)
    const IB = integral(B.bad)
    const w = win * k
    const best = { x: crop.x * k, y: crop.y * k, a: IA(crop.x * k, crop.y * k, w), b: IB(crop.x * k, crop.y * k, w) }
    return {
      inlayPct: A.pct,
      percolourPct: B.pct,
      crop: { x: best.x / k, y: best.y / k, w: win, h: win },
      window: { inlay: best.a / (k * k), percolour: best.b / (k * k) },
    }
  },
  { a: inlay, b: percolour, size: SIZE, k: K, win: WIN, crop: CROP },
)
await browser.close()

// Seams: for each outline point, the nearest point on another shape's outline
// within 3 px (further than that, it's an outer edge).
function outline(d, transform) {
  const t = transform?.match(/translate\(([-\d.]+)[ ,]+([-\d.]+)\)/)
  const dx = t ? Number(t[1]) : 0
  const dy = t ? Number(t[2]) : 0
  const pts = []
  for (const sp of parsePath(d)) {
    const n = sp.nodes
    for (let i = 0; i < (sp.closed ? n.length : n.length - 1); i++) {
      const a = n[i]
      const b = n[(i + 1) % n.length]
      const c1 = a.out ?? a
      const c2 = b.in ?? b
      const k = Math.max(2, Math.ceil((Math.hypot(b.x - a.x, b.y - a.y) + 1) * 4))
      for (let j = 0; j < k; j++) {
        const t = j / k
        const u = 1 - t
        pts.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x + dx, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y + dy })
      }
    }
  }
  return pts
}
function seams(shapes) {
  const lines = shapes.map((s) => outline(s.d, s.transform))
  const grid = new Map()
  lines.forEach((pts, si) =>
    pts.forEach((p) => {
      const key = `${Math.floor(p.x)},${Math.floor(p.y)}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push({ ...p, si })
    }),
  )
  let max = 0
  lines.forEach((pts, si) =>
    pts.forEach((p) => {
      let best = Infinity
      for (let gy = Math.floor(p.y) - 3; gy <= Math.floor(p.y) + 3; gy++)
        for (let gx = Math.floor(p.x) - 3; gx <= Math.floor(p.x) + 3; gx++)
          for (const q of grid.get(`${gx},${gy}`) ?? []) if (q.si !== si) best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y))
      if (best <= 3) max = Math.max(max, best)
    }),
  )
  return +max.toFixed(3)
}
// Counted as `npm run score` and the docs count them: path commands, so the page and the docs agree.
const nodes = (ps) => ps.reduce((k, p) => k + (p.d.match(/[MLCQSTHVAmlcqsthva]/g) ?? []).length, 0)

const out = {
  note: 'Generated by scripts/site-assets.mjs from the app sample; do not edit by hand.',
  size: SIZE,
  art: ART,
  inlay,
  percolour,
  crop: wrong.crop,
  wrongPct: { inlay: +wrong.inlayPct.toFixed(2), percolour: +wrong.percolourPct.toFixed(2) },
  wrongInWindow: { inlay: Math.round(wrong.window.inlay), percolour: Math.round(wrong.window.percolour) },
  nodes: { inlay: nodes(inlay), percolour: nodes(percolour) },
  seamMax: { inlay: seams(inlay), percolour: seams(percolour) },
}
mkdirSync(join(root, 'apps/site/src/data'), { recursive: true })
writeFileSync(join(root, 'apps/site/src/data/sample.json'), JSON.stringify(out))
console.log('  wrong px at 4×:', out.wrongPct, '| nodes:', out.nodes, '| seams max px apart:', out.seamMax, '| close-up', out.crop, out.wrongInWindow)
await vite.close()
process.exit(0)
