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
 * Two more measures see what wrong pixels can't. *Regions* is how many of the
 * clean art's flat areas (over 16 px at 1×) the trace covers mostly in their
 * own colour: a dropped background shape counts however pale or small it is.
 * *Lines* is how many separate pieces a fixture's line colour makes in the
 * trace against the clean art: a broken outline is more pieces, though it
 * costs few pixels.
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

// The colours a fixture is drawn in (plus white, which a missing shape shows),
// the palette every pixel of the reference and the traces is labelled with.
const paletteOf = (art) => [...new Set(['#ffffff', ...(art.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((c) => c.toLowerCase())])]

// In the page: label each pixel with its nearest palette colour, and count the
// 8-connected pieces of one label (or of every label) over a minimum area.
await page.evaluate(() => {
  window.__labels = (d, pal) => {
    const out = new Uint8Array(d.length / 4)
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      let best = 0
      let bestD = Infinity
      for (let j = 0; j < pal.length; j++) {
        const e = Math.abs(d[i] - pal[j][0]) + Math.abs(d[i + 1] - pal[j][1]) + Math.abs(d[i + 2] - pal[j][2])
        if (e < bestD) (bestD = e), (best = j)
      }
      out[p] = best
    }
    return out
  }
  // Pieces of the pixels `keep` accepts, as lists of pixel indices.
  window.__pieces = (keep, n, w, minArea) => {
    const seen = new Uint8Array(n)
    const pieces = []
    const stack = []
    for (let s = 0; s < n; s++) {
      if (seen[s] || !keep(s)) continue
      const piece = []
      seen[s] = 1
      stack.push(s)
      while (stack.length) {
        const i = stack.pop()
        piece.push(i)
        const x = i % w
        for (let dy = -w; dy <= w; dy += w)
          for (let dx = -1; dx <= 1; dx++) {
            const j = i + dy + dx
            if (j < 0 || j >= n || (dx === -1 && x === 0) || (dx === 1 && x === w - 1) || seen[j] || !keep(j) || keep.same?.(i, j) === false) continue
            seen[j] = 1
            stack.push(j)
          }
      }
      if (piece.length >= minArea) pieces.push(piece)
    }
    return pieces
  }
})

// The input (JPEG, as the app's sample) and the reference (clean, at 4×, kept in the page).
const prepare = async (art, line, type = 'image/jpeg', quality = 0.72) => {
  const b64 = await page.evaluate(
  async ({ art, size, k, pal, line, type, quality }) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(art)
    await img.decode()
    const c = new OffscreenCanvas(size, size)
    c.getContext('2d').drawImage(img, 0, 0, size, size)
    const jpg = await c.convertToBlob({ type, quality })
    const d = new OffscreenCanvas(size, size)
    d.getContext('2d').drawImage(await createImageBitmap(jpg), 0, 0)
    const px = d.getContext('2d').getImageData(0, 0, size, size).data
    const r = new OffscreenCanvas(size * k, size * k)
    r.getContext('2d').drawImage(img, 0, 0, size * k, size * k)
    window.__ref = r.getContext('2d').getImageData(0, 0, size * k, size * k).data
    // Regions: pieces of one colour, counting only pixels that are that colour
    // (within 24) with all four neighbours labelled the same, so the
    // anti-aliased band between two colours never makes a sliver region of a third.
    const n = size * k
    window.__pal = pal
    const lab = window.__labels(window.__ref, pal)
    const solid = (i) => {
      const c = pal[lab[i]]
      const d = window.__ref
      if (Math.abs(d[4 * i] - c[0]) + Math.abs(d[4 * i + 1] - c[1]) + Math.abs(d[4 * i + 2] - c[2]) > 24) return false
      const x = i % n
      return x > 0 && x < n - 1 && i >= n && i < n * n - n && lab[i - 1] === lab[i] && lab[i + 1] === lab[i] && lab[i - n] === lab[i] && lab[i + n] === lab[i]
    }
    solid.same = (i, j) => lab[i] === lab[j]
    window.__regions = window.__pieces(solid, n * n, n, 16 * k * k).map((piece) => ({ label: lab[piece[0]], piece }))
    window.__line = line == null ? -1 : pal.findIndex((c) => c.join() === line.join())
    window.__refLines = window.__line < 0 ? 0 : window.__pieces((i) => lab[i] === window.__line, n * n, n, k * k * 4).length
    let s = ''
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000))
    return btoa(s)
  },
  { art, size: SIZE, k: K, pal: paletteOf(art).map(rgbOf), line: line ? rgbOf(line) : null, type, quality },
  )
  return new Uint8Array(Buffer.from(b64, 'base64'))
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const pixels = await prepare(ART)

async function score(svg, tolerance = 96) {
  const m = await page.evaluate(
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
      let pale = 0
      for (let i = 0; i < d.length; i += 4) {
        const e = Math.abs(d[i] - ref[i]) + Math.abs(d[i + 1] - ref[i + 1]) + Math.abs(d[i + 2] - ref[i + 2])
        if (e > tolerance) bad++
        if (e > 24) pale++
      }
      // A region is found when over half its pixels come out nearest its colour.
      const n = size * k
      const lab = window.__labels(d, window.__pal)
      const found = window.__regions.filter(({ label, piece }) => piece.reduce((s, i) => s + (lab[i] === label), 0) > piece.length / 2).length
      const lines = window.__line < 0 ? 0 : window.__pieces((i) => lab[i] === window.__line, n * n, n, k * k * 4).length
      const px = d.length / 4
      return { wrong: (bad / px) * 100, pale: (pale / px) * 100, found, regions: window.__regions.length, lines, refLines: window.__refLines }
    },
    { svg, size: SIZE, k: K, tolerance },
  )
  const nodes = [...svg.matchAll(/\bd="([^"]*)"/g)].reduce((n, m) => n + (m[1].match(/[MLCQSTHVAmlcqsthva]/g) ?? []).length, 0)
  return { ...m, nodes, paths: (svg.match(/<path\b/g) ?? []).length, kb: svg.length / 1024 }
}

const pct = (v) => `${v.toFixed(2).padStart(6)}%`
const regions = (r) => `${r.found}/${r.regions}`.padStart(7)
const lines = (r) => `${r.lines}/${r.refLines}`.padStart(5)

console.log(`\n  Sample badge, ${SIZE} px JPEG q72, scored at ${K}× against the clean art\n`)
console.log('  Preset         Tracer     Wrong px  Past 24  Regions   Nodes  Paths   Size')
for (const p of PRESETS) {
  if (p.id === 'lineart' || p.id === 'pixel') continue // one colour / no smoothing: not comparable on a colour badge
  const t = performance.now()
  const svg = runTrace(pixels.slice(), SIZE, SIZE, toTraceOptions(settingsFor(p.id)))
  const ms = performance.now() - t
  const r = await score(svg)
  console.log(
    `  ${p.label.padEnd(14)} ${'Inlay'.padEnd(10)} ${r.wrong.toFixed(2).padStart(7)}%  ${pct(r.pale)}  ${regions(r)}  ${String(r.nodes).padStart(6)} ${String(r.paths).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB  (${ms.toFixed(0)} ms)`,
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
  const art = await prepare(readFileSync(join(root, 'scripts/fixtures/strokes.svg'), 'utf8'), '#1a1a1a')
  console.log(`\n  Pen drawing (strokes ${(3 * SIZE) / 200} px wide), ${SIZE} px JPEG q72\n`)
  console.log('  Preset         Wrong px   Lines  Strokes  Nodes   Size   Stroke width')
  for (const id of ['centerline', 'lineart']) {
    const t = performance.now()
    const svg = runTrace(art.slice(), SIZE, SIZE, toTraceOptions(settingsFor(id)))
    const ms = performance.now() - t
    const r = await score(svg)
    const subpaths = (svg.match(/M/g) ?? []).length
    const width = svg.match(/stroke-width="([\d.]+)"/)?.[1]
    console.log(
      `  ${PRESETS.find((p) => p.id === id).label.padEnd(14)} ${r.wrong.toFixed(2).padStart(6)}%   ${lines(r)}  ${String(id === 'centerline' ? subpaths : '–').padStart(7)} ${String(r.nodes).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB  ${width ? `${width} px` : '–'}  (${ms.toFixed(0)} ms)`,
    )
  }
}

// How many of a fixture's shapes the trace draws whole: a path of the
// shape's colour that matches the whole shape, hidden parts included (IoU
// over 0.95 at 1×). Cut out, a shape partly behind another is only its
// visible part, so this counts shapes that are fully visible, and stacked
// shapes completed under the ones in front.
async function whole(art, svg) {
  const shapes = [...art.matchAll(/<(circle|rect)\b[^>]*>/g)].map((m) => m[0])
  const paths = [...svg.matchAll(/<path d="([^"]*)" fill="(#[0-9a-f]{6})"/g)].map((m) => ({ d: m[1], fill: m[2] }))
  const view = svg.match(/viewBox="([^"]*)"/)[1]
  return page.evaluate(
    async ({ shapes, paths, view, size }) => {
      const mask = async (markup, box) => {
        const img = new Image()
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${markup}</svg>`)
        await img.decode()
        const c = new OffscreenCanvas(size, size)
        c.getContext('2d').drawImage(img, 0, 0, size, size)
        const d = c.getContext('2d').getImageData(0, 0, size, size).data
        const m = new Uint8Array(size * size)
        for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 127 ? 1 : 0
        return m
      }
      const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
      const colours = shapes.map((s) => rgb(s.match(/fill="(#[0-9a-fA-F]{6})"/)[1]))
      const nearest = (hex) => {
        const c = rgb(hex)
        let best = 0
        colours.forEach((k, i) => {
          const e = (a) => Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2])
          if (e(k) < e(colours[best])) best = i
        })
        return colours[best].join()
      }
      const traced = await Promise.all(paths.map(async (p) => ({ colour: nearest(p.fill), m: await mask(`<path d="${p.d}"/>`, view) })))
      let n = 0
      for (let i = 0; i < shapes.length; i++) {
        const ref = await mask(shapes[i], '0 0 200 200')
        let best = 0
        for (const t of traced) {
          if (t.colour !== colours[i].join()) continue
          let both = 0
          let either = 0
          for (let j = 0; j < ref.length; j++) (both += ref[j] & t.m[j]), (either += ref[j] | t.m[j])
          best = Math.max(best, either ? both / either : 0)
        }
        if (best > 0.95) n++
      }
      return `${n}/${shapes.length}`
    },
    { shapes, paths, view, size: SIZE },
  )
}

// Lines are the fixture's line colour; Line art and Centerline draw them in
// black, which is still nearest that colour, so they count too.
const flatArt = async (file, title, line, presets, { wholes = false } = {}) => {
  const source = readFileSync(join(root, 'scripts/fixtures', file), 'utf8')
  const art = await prepare(source, line)
  console.log(`\n  ${title}, ${SIZE} px JPEG q72, wrong past 24\n`)
  console.log(`  ${'Preset'.padEnd(23)} Wrong px  Regions  Lines${wholes ? '  Whole' : ''}   Nodes  Paths   Size`)
  // A preset name alone is its defaults; with ':stacked' or ':cutout', those shapes; with ':gradients', gradient fills.
  for (const entry of presets) {
    const [id, mod] = entry.split(':')
    const shapes = mod === 'gradients' ? undefined : mod
    const t = performance.now()
    const svg = runTrace(art.slice(), SIZE, SIZE, { ...toTraceOptions({ ...settingsFor(id), ...(shapes ? { shapes } : {}) }), ...(mod === 'gradients' ? { gradients: true } : {}) })
    const ms = performance.now() - t
    const r = await score(svg, 24)
    const label = PRESETS.find((p) => p.id === id).label + (mod ? { stacked: ', stacked', cutout: ', cut out', gradients: ', gradients' }[mod] : '')
    console.log(
      `  ${label.padEnd(23)} ${pct(r.wrong)}  ${regions(r)}  ${line ? lines(r) : '    –'}${wholes ? `  ${(await whole(source, svg)).padStart(5)}` : ''}  ${String(r.nodes).padStart(6)} ${String(r.paths).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB  (${ms.toFixed(0)} ms)`,
    )
  }
}

// ---- Outline illustration ---------------------------------------------------
// Thin mid-blue outlines on white with pale tinted fills. A pale fill differs
// from white by under 96, so this counts a pixel wrong past 24 instead: a
// missing fill is wrong here, where on the badge it would hide.
await flatArt('outline.svg', `Outline illustration (outlines ${(1 * SIZE) / 200} px wide, pale fills)`, '#4f86af', ['logo', 'illustration', 'outline', 'lineart', 'photo'])

// ---- Junctions --------------------------------------------------------------
// The same outlines meeting as T, Y, X and corners, and a box with a gap a
// line width wide that is drawn, not broken. Every junction joined and the gap
// kept is 8 pieces.
await flatArt('junctions.svg', 'Junctions (lines 3.2 px wide)', '#4f86af', ['illustration', 'outline', 'lineart', 'centerline'])
// Lines 2.2 px wide, under the width Outline art draws as strokes, where
// each line's two sides used to meet at its ends and taper it to a point.
await flatArt('junctions-thin.svg', 'Junctions (lines 2.2 px wide)', '#4f86af', ['logo', 'illustration', 'lineart', 'centerline'])
// Lines 1.1 px wide: at a slant, a staircase of pixels that touch only at
// corners, and paler than the ink, since no pixel is wholly covered.
await flatArt('junctions-hair.svg', 'Junctions (lines 1.1 px wide)', '#4f86af', ['logo', 'illustration', 'lineart', 'centerline'])
// Lines 8 px wide: the skeleton Centerline draws bends toward each junction
// over about a stroke's width, so a crossing is pinched unless refitted.
await flatArt('junctions-thick.svg', 'Junctions (lines 8 px wide)', '#4f86af', ['lineart', 'centerline'])

// ---- Overlaps ---------------------------------------------------------------
// Shapes partly behind others, down to a thin crescent: what cut-out shapes
// reduce to slivers and speck clean-up can lose, and stacked flat art draws
// whole behind the shapes in front.
await flatArt('overlap.svg', 'Overlapping shapes', null, ['logo', 'logo:stacked', 'illustration', 'illustration:cutout', 'photo'], { wholes: true })

// ---- Soft shading -----------------------------------------------------------
// A sky, a ball and a hill shaded with gradients, beside flat shapes. Flat
// fills turn shading into bands of tints: more shapes, and steps where the art
// is smooth.
await flatArt('shaded.svg', 'Soft shading (two linear gradients, one radial, flat shapes)', null, ['logo', 'illustration', 'illustration:cutout', 'photo', 'photo:gradients'])

// ---- Lossless --------------------------------------------------------------
// The same drawings saved as PNG, the way most logos arrive. Without JPEG's
// noise, an anti-aliased pixel says where in it the edge runs, and Inlay
// places edges between pixels from that.
console.log(`\n  Saved as PNG, wrong past 96 (badge) or 24 (fixtures)\n`)
console.log(`  ${'Drawing'.padEnd(16)} ${'Preset'.padEnd(14)} Wrong px   Nodes   Size`)
for (const [name, file, line] of [
  ['Badge', null, null],
  ['Emblem', 'emblem.svg', null],
  ['Outline', 'outline.svg', '#4f86af'],
  ['Overlap', 'overlap.svg', null],
]) {
  const art = await prepare(file ? readFileSync(join(root, 'scripts/fixtures', file), 'utf8') : ART, line, 'image/png')
  for (const id of ['logo', 'illustration']) {
    const svg = runTrace(art.slice(), SIZE, SIZE, toTraceOptions(settingsFor(id)))
    const r = await score(svg, file ? 24 : 96)
    console.log(`  ${name.padEnd(16)} ${PRESETS.find((p) => p.id === id).label.padEnd(14)} ${r.wrong.toFixed(2).padStart(7)}%  ${String(r.nodes).padStart(6)} ${r.kb.toFixed(1).padStart(5)} KB`)
  }
}

console.log()
await browser.close()
await vite.close()
