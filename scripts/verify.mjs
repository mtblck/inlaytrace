/**
 * End-to-end check in a real browser, against a running build.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm run verify                                   # local preview
 *   npm run verify -- https://mattblack.space/tools/img-to-svg/
 *
 * Env: CHROME_PATH (use an installed Chromium), SHOTS (directory for
 * screenshots), FIXTURE (an image file to trace in addition to the sample).
 *
 * It fails on any console error or CSP violation. That matters more than it
 * sounds: a CSP that blocks WebAssembly leaves a page that looks fine and
 * never traces anything, and only a real browser with the real headers sees it.
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:4173/tools/img-to-svg/'
const shots = process.env.SHOTS
if (shots) mkdirSync(shots, { recursive: true })

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const failures = []
const check = (ok, message) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${message}`)
  if (!ok) failures.push(message)
}

async function newPage(viewport, colorScheme = 'light') {
  const context = await browser.newContext({ viewport, colorScheme, acceptDownloads: true })
  const page = await context.newPage()
  page.on('console', (m) => m.type() === 'error' && failures.push(`console: ${m.text()}`))
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`))
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`)),
  )
  return page
}

const shot = async (page, name) => shots && (await page.screenshot({ path: join(shots, `${name}.png`) }))

async function traced(page) {
  await page.getByText(/Traced in [\d,]+ ms$/).waitFor({ timeout: 30_000 })
}

/** Run an action that should cause a new trace, and wait for that trace. */
async function retrace(page, action) {
  const main = page.locator('main')
  const before = Number(await main.getAttribute('data-traces'))
  await action()
  await page.waitForFunction((n) => Number(document.querySelector('main').dataset.traces) > n, before, { timeout: 30_000 })
  await traced(page)
}


/** Render an SVG string in the page and read one pixel's alpha (0 = transparent). */
async function alphaAt(page, svg, x, y) {
  return page.evaluate(
    async ([svg, x, y]) => {
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const c = new OffscreenCanvas(img.naturalWidth || 640, img.naturalHeight || 640)
      c.getContext('2d').drawImage(img, 0, 0)
      return c.getContext('2d').getImageData(x, y, 1, 1).data[3]
    },
    [svg, x, y],
  )
}

/** Percentage of pixels that differ between the left half and the mirrored right half. */
async function asymmetry(page, svg) {
  return page.evaluate(async (svg) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const w = 400
    const h = Math.round((img.naturalHeight / img.naturalWidth) * w)
    const c = new OffscreenCanvas(w, h)
    const x = c.getContext('2d')
    x.drawImage(img, 0, 0, w, h)
    const d = x.getImageData(0, 0, w, h).data
    let diff = 0
    let n = 0
    for (let yy = 0; yy < h; yy++)
      for (let xx = 0; xx < w / 2; xx++) {
        const a = (yy * w + xx) * 4
        const b = (yy * w + (w - 1 - xx)) * 4
        const delta = Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]) + Math.abs(d[a + 3] - d[b + 3])
        if (delta > 64) diff++
        n++
      }
    return (diff / n) * 100
  }, svg)
}

async function exportSvg(page) {
  await page.getByText(/Traced in [\d,]+ ms$/).waitFor()
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SVG' }).click()])
  return readFileSync(await dl.path(), 'utf8')
}

async function editorChecks(page, label, n) {
  await page.getByRole('tab', { name: /Edit/ }).click()
  await page.getByRole('radio', { name: 'Vector' }).click()

  // Overlays, with custom colours.
  await page.getByLabel('Paths', { exact: true }).check()
  await page.getByLabel('Paths overlay colour').fill('#00aa55')
  await page.getByLabel('Nodes', { exact: true }).check()
  await page.getByLabel('Nodes overlay colour').fill('#aa00ff')
  const nodeRects = Number(await page.locator('[data-overlay="nodes"]').getAttribute('data-count'))
  const pathStroke = await page.locator('g[stroke="#00aa55"] path').count()
  check(nodeRects > 10 && pathStroke > 0, `${label}: overlays show ${pathStroke} outlines and ${nodeRects} nodes in the chosen colours`)
  check((await page.locator('[data-overlay="nodes"]').getAttribute('fill')) === '#aa00ff', `${label}: node colour applied`)
  await shot(page, `${n}a-${label}-overlays`)

  // Select the largest shape by clicking its hit target, then drag a node.
  const hits = page.locator('path[data-path-id]')
  let best = 0
  let bestArea = -1
  const sheet = await page.locator('svg[aria-label="Traced SVG"]').boundingBox()
  for (let i = 0; i < (await hits.count()); i++) {
    const b = await hits.nth(i).boundingBox()
    if (b && b.width * b.height > bestArea && b.width < sheet.width * 0.9) [best, bestArea] = [i, b.width * b.height]
  }
  const target = hits.nth(best)
  const id = await target.getAttribute('data-path-id')
  const tb = await target.boundingBox()
  await target.dispatchEvent('pointerdown', { bubbles: true, clientX: tb.x + tb.width / 2, clientY: tb.y + tb.height / 2, pointerId: 1, isPrimary: true })
  await page.locator('[data-selected]').waitFor()
  check((await page.locator('[data-selected]').getAttribute('data-selected')) === id, `${label}: clicking a shape selects it`)
  const dBefore = await page.locator(`svg[aria-label="Traced SVG"] path`).nth(best).getAttribute('d')
  // A node with clear space around it: overlapping squares hand the press to whichever is on top.
  const boxes = await page.locator('[data-node]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
  const free = boxes.findIndex((b, i) => boxes.every((o, j) => j === i || Math.hypot(o.x - b.x, o.y - b.y) > 14))
  const node = page.locator('[data-node]').nth(Math.max(0, free))
  const nb = await node.boundingBox()

  // A plain click, off-centre, selects the node and changes nothing.
  const wasDetached = (await page.locator('[data-edited]').count()) > 0
  await page.mouse.click(nb.x + nb.width - 1, nb.y + nb.height - 1)
  const dClicked = await page.locator('[data-selected] path').first().getAttribute('d')
  const nowDetached = (await page.locator('[data-edited]').count()) > 0
  check(dClicked === dBefore && nowDetached === wasDetached, `${label}: clicking a node selects it without moving it`)

  // Grabbed off-centre, the node moves by exactly the pointer's travel instead of jumping to it.
  const gx = nb.x + 1
  const gy = nb.y + 1
  await page.mouse.move(gx, gy)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(gx + i * 8, gy + i * 6)
  await page.mouse.up()
  const nb2 = await node.boundingBox()
  const off = Math.hypot(nb2.x - nb.x - 40, nb2.y - nb.y - 30)
  check(off < 1.5, `${label}: a dragged node follows the pointer exactly (${off.toFixed(2)} px off)`)
  const dAfter = await page.locator(`[data-selected]`).locator('path').first().getAttribute('d')
  check(dAfter !== dBefore, `${label}: dragging a node reshapes the path`)
  await shot(page, `${n}b-${label}-node-dragged`)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  const dUndone = await page.locator(`svg[aria-label="Traced SVG"] path`).nth(best).getAttribute('d')
  check(dUndone === dBefore, `${label}: one Undo reverts the whole drag`)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z')
  const dRedone = await page.locator(`svg[aria-label="Traced SVG"] path`).nth(best).getAttribute('d')
  check(dRedone === dAfter, `${label}: Redo brings it back`)
  await page.keyboard.press('Escape')

  // Mirror the left half onto the right.
  const before = await asymmetry(page, await exportSvg(page))
  await page.getByRole('radio', { name: 'Mirror' }).click()
  await page.locator('[data-overlay="axis"]').waitFor()
  await shot(page, `${n}c-${label}-mirror-tool`)
  await page.getByRole('button', { name: /Mirror left onto right/ }).click()
  await page.getByRole('radio', { name: 'Select', checked: true }).waitFor({ timeout: 15000 })
  const after = await asymmetry(page, await exportSvg(page))
  check(after < 2, `${label}: mirrored export is symmetric (${before.toFixed(1)}% → ${after.toFixed(2)}% of pixels differ)`)
  await shot(page, `${n}d-${label}-mirrored`)

  // Changing a trace setting now asks first, and Keep editing keeps the edits.
  await page.getByRole('tab', { name: /Trace/ }).click()
  await page.getByRole('radio', { name: /Illustration/ }).click()
  await page.getByRole('alertdialog').waitFor()
  check(true, `${label}: changing a setting after editing asks first`)
  await page.getByRole('button', { name: 'Keep editing' }).click()
  const stillSymmetric = await asymmetry(page, await exportSvg(page))
  check(stillSymmetric < 2, `${label}: Keep editing leaves the edits in place`)
}

console.log(`\n  verify ${url}\n`)

// ---- Desktop, sample image ------------------------------------------------
const page = await newPage({ width: 1440, height: 900 })
const response = await page.goto(url)
check(response?.ok(), `page loads (${response?.status()})`)
const csp = response?.headers()['content-security-policy'] ?? ''
check(csp.includes("'wasm-unsafe-eval'"), 'CSP allows WebAssembly')
await shot(page, '01-empty')

await page.getByRole('button', { name: 'Try a sample' }).click()
await traced(page)
const VECTOR = 'svg[aria-label="Traced SVG"] path'
const INKS = 'aside li[data-ink]'
const pathCount = await page.locator(VECTOR).count()
check(pathCount > 3, `sample traced into ${pathCount} paths`)
const inkCount = await page.locator(INKS).count()
check(inkCount >= 5 && inkCount <= 8, `logo preset found ${inkCount} inks (5 in the art, cap 8)`)
await shot(page, '02-split')

// The view: Split to compare, then Vector once editing starts, unless you chose.
const viewIs = async (name) => (await page.getByRole('radio', { name }).getAttribute('aria-checked')) === 'true'
check(await viewIs('Split'), 'a new image opens on Split')
await page.getByRole('tab', { name: /Edit/ }).click()
check(await viewIs('Vector'), 'starting to edit switches to Vector, hiding the original')
await page.getByRole('radio', { name: 'Split' }).click()
await page.getByRole('tab', { name: /Trace/ }).click()
await page.getByRole('tab', { name: /Edit/ }).click()
check(await viewIs('Split'), 'a view picked afterwards sticks')
await page.getByRole('tab', { name: /Trace/ }).click()

for (const mode of ['Difference', 'Vector']) {
  await page.getByRole('radio', { name: mode }).click()
  await shot(page, `03-${mode.toLowerCase()}`)
}
await page.getByRole('radio', { name: 'Split' }).click()

// Preset change re-traces.
await retrace(page, () => page.getByRole('radio', { name: /Line art/ }).click())
check((await page.locator(INKS).count()) === 1, 'line art traces to a single ink')
await retrace(page, () => page.getByRole('radio', { name: /^Logo/ }).click())

// ---- Colours: replace and remove ------------------------------------------
await page.getByRole('tab', { name: /Edit/ }).click()
const firstInk = page.locator(INKS).first()
const bgHex = await firstInk.getAttribute('data-ink')
await page.locator(INKS).nth(1).locator('input[type=color]').fill('#123456')
check((await page.locator(`${VECTOR}[fill="#123456"]`).count()) > 0, 'replacing a colour updates the preview')
await firstInk.getByRole('button', { name: /^Remove/ }).click()
await page.getByText('Restore all').waitFor()
check((await page.locator(`${VECTOR}[fill="${bgHex}"]`).count()) === 0, `removing ${bgHex} drops its shapes`)
await shot(page, '04-colours-edited')

// Export.
await page.getByText(/Traced in [\d,]+ ms$/).waitFor() // optimised numbers are in
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SVG' }).click()])
const svg = readFileSync(await download.path(), 'utf8')
check(download.suggestedFilename() === 'sample-badge.svg', `download named ${download.suggestedFilename()}`)
check(/<svg[^>]*viewBox="0 0 640 640"/.test(svg), 'exported SVG has a viewBox')
check(svg.includes('#123456'), 'export carries the replaced colour')
const corner = await alphaAt(page, svg, 2, 2)
check(corner === 0, `removed background exports as transparent (corner alpha ${corner})`)
const sizeShown = await page.locator('dd').nth(2).innerText()
console.log(`         exported ${svg.length.toLocaleString()} bytes, panel shows ${sizeShown}`)

const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Layers (.zip)' }).click()])
check(zip.suggestedFilename() === 'sample-badge-layers.zip', 'layers download is a zip')

// ---- Background: behind everything, shows where a colour was removed ---------
await page.getByRole('button', { name: 'Add background' }).click()
await page.getByLabel('Background colour').fill('#ff00ff')
check((await page.locator('svg[aria-label="Traced SVG"] rect[data-background]').getAttribute('fill')) === '#ff00ff', 'background shows in the preview')
await page.getByRole('radio', { name: 'Vector' }).click()
await shot(page, '04c-background')
const withBg = await exportSvg(page)
// SVGO may write the rect as a path and shorten the colour; either way it comes first.
check(/<svg[^>]*>\s*<(rect|path)[^>]*fill="#(ff00ff|f0f)"/.test(withBg), 'background exports as the first element')
check((await alphaAt(page, withBg, 2, 2)) === 255, 'the removed colour now shows the background')
await page.keyboard.press('Control+z')
check((await page.locator('svg[aria-label="Traced SVG"] rect[data-background]').getAttribute('fill')) === '#ffffff', 'Undo reverts the colour first')
await page.keyboard.press('Control+z')
await page.getByRole('button', { name: 'Add background' }).waitFor()
check((await page.locator('rect[data-background]').count()) === 0, 'then takes the background away')
await page.getByRole('radio', { name: 'Split' }).click()

// Keyboard: the split handle is a real slider.
const handle = page.getByRole('slider', { name: /Comparison split/ })
await handle.focus()
await page.keyboard.press('End')
check((await handle.getAttribute('aria-valuenow')) === '100', 'split handle responds to the keyboard')

// ---- Zoom ---------------------------------------------------------------------
{
  const readout = () => page.locator('[data-zoom-readout]').innerText()
  const scale = async () => Number(await page.locator('[data-zoom]').getAttribute('data-zoom'))
  const fitPct = await readout()
  check((await page.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')) === 'true', `opens at fit (${fitPct})`)
  await page.getByRole('button', { name: '100%' }).click()
  check((await scale()) === 1 && (await readout()) === '100%', '100% shows one image pixel per screen pixel')
  // + steps by √2, but stops at fit when a step would cross it.
  const fit = Number(fitPct.replace('%', '')) / 100
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const stepped = await scale()
  const expected = fit > 1 && fit < Math.SQRT2 ? fit : Math.SQRT2
  check(Math.abs(stepped - expected) < 0.01, `+ steps by √2, stopping at fit if it crosses it (100% → ${await readout()})`)
  await page.getByRole('slider', { name: 'Zoom' }).fill('2')
  check((await readout()) === '400%', `slider sets the zoom (${await readout()})`)
  const sheetW = (await page.locator('[data-zoom] .checker').boundingBox()).width
  check(Math.abs(sheetW - 640 * 4) <= 1, `sheet is drawn at 400% (${Math.round(sheetW)} px for a 640 px image)`)

  // Wheel with Ctrl (what a trackpad pinch sends) zooms around the cursor.
  await page.getByRole('button', { name: 'Fit' }).click()
  const mat = await page.locator('[data-zoom]').boundingBox()
  const cx = mat.x + mat.width * 0.3
  const cy = mat.y + mat.height * 0.35
  const fracAt = async () => {
    const b = await page.locator('[data-zoom] .checker').boundingBox()
    return [(cx - b.x) / b.width, (cy - b.y) / b.height]
  }
  await page.mouse.move(cx, cy)
  const before = await fracAt()
  const s0 = await scale()
  await page.mouse.wheel(0, 10) // plain scroll: no zoom
  check((await scale()) === s0, 'plain scrolling over the canvas does not zoom')
  await page.keyboard.down('Control')
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -40)
  await page.keyboard.up('Control')
  await page.waitForTimeout(100)
  const after = await fracAt()
  const drift = Math.max(Math.abs(after[0] - before[0]), Math.abs(after[1] - before[1])) * 100
  const s1 = await scale()
  check(s1 > s0 * 2, `ctrl+wheel (trackpad pinch) zooms in (${Math.round(s0 * 100)}% → ${Math.round(s1 * 100)}%)`)
  check(drift < 0.5, `the point under the cursor stays put (${drift.toFixed(2)}% drift)`)
  await shot(page, '04b-zoomed')

  // Keyboard: Ctrl+- steps out, Ctrl+0 fits, with the pointer over the canvas.
  await page.keyboard.press('Control+Minus')
  check((await scale()) < s1, 'Ctrl+− zooms out')
  await page.keyboard.press('Control+0')
  check((await page.getByRole('button', { name: 'Fit' }).getAttribute('aria-pressed')) === 'true', 'Ctrl+0 returns to fit')
}

// ---- Editor: overlays, node drag, undo/redo, mirror ------------------------
await editorChecks(page, 'sample', '05')

// Opening another image clears history, so the prompt must not promise Undo.
await page.locator('input[type=file]').setInputFiles({ name: 'other.png', mimeType: 'image/png', buffer: await page.screenshot() })
const prompt = await page.getByRole('alertdialog').innerText()
check(!/\bundo\b/i.test(prompt) && /can.t be undone/i.test(prompt), `opening an image after edits warns it can't be undone`)
await page.getByRole('button', { name: 'Keep editing' }).click()
check((await page.locator('aside .truncate').first().innerText()) === 'sample-badge', 'Keep editing keeps the current image')

// A colour changed while a discard prompt is open survives confirming it.
await page.getByRole('tab', { name: /Trace/ }).click()
await retrace(page, async () => {
  await page.getByRole('radio', { name: /^Logo/ }).click()
  await page.getByRole('alertdialog').waitFor()
  await page.getByRole('tab', { name: /Edit/ }).click()
  await page.locator(INKS).nth(1).locator('input[type=color]').fill('#00ff7f')
  await page.getByRole('button', { name: 'Discard edits and re-trace' }).click()
})
check((await page.locator(`${VECTOR}[fill="#00ff7f"]`).count()) > 0, 'a colour changed while the prompt was open survives confirming it')
check((await page.locator('[data-edited]').count()) === 0, 'confirming re-attaches the drawing to the trace')

// ---- Optional real-world fixture ------------------------------------------
if (process.env.FIXTURE) {
  // A fresh page, so the sample's edits don't trigger the discard prompt.
  const fx = await newPage({ width: 1440, height: 900 })
  await fx.goto(url)
  await fx.locator('input[type=file]').setInputFiles(process.env.FIXTURE)
  await traced(fx)
  await retrace(fx, () => fx.getByRole('radio', { name: /Line art/ }).click())
  const light = await fx.getByRole('radio', { name: 'Light on dark' }).getAttribute('aria-checked')
  console.log(`         fixture: ${await fx.locator('aside .num').first().innerText()}, light ink auto-selected: ${light}`)
  await shot(fx, '06-fixture')
  await editorChecks(fx, 'fixture', '07')
}

// ---- Dark theme and mobile ------------------------------------------------
const dark = await newPage({ width: 1440, height: 900 }, 'dark')
await dark.goto(url)
check((await dark.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark preference applied before paint')
await dark.getByRole('button', { name: 'Try a sample' }).click()
await traced(dark)
await shot(dark, '08-dark')

const mobile = await newPage({ width: 390, height: 844 })
await mobile.goto(url)
await mobile.getByRole('button', { name: 'Try a sample' }).click()
await traced(mobile)
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check(overflow <= 0, `no horizontal scroll on a phone (${overflow}px)`)
await shot(mobile, '09-mobile')
await mobile.getByRole('tab', { name: /Edit/ }).click()
await shot(mobile, '10-mobile-edit')

await browser.close()

const unexpected = failures.filter((f) => f.startsWith('console') || f.startsWith('pageerror'))
for (const f of unexpected) console.log(`  FAIL  ${f}`)
console.log(failures.length ? `\n  ${failures.length} problem(s).\n` : '\n  All checks passed.\n')
process.exit(failures.length ? 1 : 0)
