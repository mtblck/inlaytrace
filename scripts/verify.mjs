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

/** A point on screen where the shape's own hit target is what a click lands on, as near its middle as possible. */
async function pointOn(page, id) {
  return page.evaluate((id) => {
    const el = document.querySelector(`path[data-path-id="${id}"]`)
    const r = el.getBoundingClientRect()
    const hits = []
    for (let i = 1; i < 24; i++)
      for (let j = 1; j < 24; j++) {
        const x = r.x + (r.width * i) / 24
        const y = r.y + (r.height * j) / 24
        if (document.elementFromPoint(x, y) === el) hits.push({ x, y, d: Math.hypot(i - 12, j - 12) })
      }
    hits.sort((a, b) => a.d - b.d)
    return hits[0] ?? null
  }, id)
}

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'
const boxOf = (page) => page.locator('[data-selection-box] > rect:not([data-box-handle])').boundingBox()
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol

/** Smooth handles: dragging one swings its partner round; Alt bends one alone. */
async function smoothChecks(page, label) {
  // A smooth node whose out-handle has clear space round it on screen.
  const pick = await page.evaluate(() => {
    const at = (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    const nodes = new Map([...document.querySelectorAll('[data-node]')].map((el) => [el.dataset.node, at(el)]))
    const handles = new Map([...document.querySelectorAll('[data-handle]')].map((el) => [el.dataset.handle, at(el)]))
    const all = [...nodes.values(), ...handles.values()]
    for (const [key, n] of nodes) {
      const i = handles.get(`${key}:in`)
      const o = handles.get(`${key}:out`)
      if (!i || !o) continue
      const a = { x: n.x - i.x, y: n.y - i.y }
      const b = { x: o.x - n.x, y: o.y - n.y }
      const la = Math.hypot(a.x, a.y)
      const lb = Math.hypot(b.x, b.y)
      if (la < 12 || lb < 12) continue
      if ((a.x * b.x + a.y * b.y) / (la * lb) < 0.995) continue
      if (all.filter((p) => Math.hypot(p.x - o.x, p.y - o.y) < 14).length > 1) continue
      return { key, n, o }
    }
    return null
  })
  if (!pick) {
    console.log(`         ${label}: no smooth node with room to drag; skipping the handle checks`)
    return
  }
  const inHandle = () =>
    page.locator(`[data-handle="${pick.key}:in"]`).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  const dragOut = async (alt) => {
    await page.mouse.move(pick.o.x, pick.o.y)
    if (alt) await page.keyboard.down('Alt')
    await page.mouse.down()
    for (let i = 1; i <= 5; i++) await page.mouse.move(pick.o.x + i * 3, pick.o.y - i * 5)
    await page.mouse.up()
    if (alt) await page.keyboard.up('Alt')
  }
  const before = await inHandle()
  await dragOut(false)
  const swung = await inHandle()
  const n = pick.n
  const a = { x: n.x - swung.x, y: n.y - swung.y }
  const o = { x: pick.o.x + 15 - n.x, y: pick.o.y - 25 - n.y }
  const cos = (a.x * o.x + a.y * o.y) / (Math.hypot(a.x, a.y) * Math.hypot(o.x, o.y))
  const kept = Math.abs(Math.hypot(a.x, a.y) - Math.hypot(n.x - before.x, n.y - before.y))
  check(Math.hypot(swung.x - before.x, swung.y - before.y) > 2 && cos > 0.999 && kept < 1, `${label}: dragging a smooth handle swings the other round, same length (cos ${cos.toFixed(4)})`)
  await page.keyboard.press(`${MOD}+z`)
  await dragOut(true)
  const alone = await inHandle()
  check(Math.hypot(alone.x - before.x, alone.y - before.y) < 0.5, `${label}: with Alt, only the dragged handle moves`)
  await page.keyboard.press(`${MOD}+z`)
}

/** Select tool: move, scale, typed size, nudge, multi-select, marquee, select all. */
async function selectChecks(page, label, id, n) {
  await page.getByRole('radio', { name: 'Select', exact: true }).click()
  const at = await pointOn(page, id)
  await page.mouse.click(at.x, at.y)
  check((await page.locator('[data-selection-box]').getAttribute('data-selection-box')) === '1', `${label}: Select tool puts a box round the clicked shape`)
  const b0 = await boxOf(page)
  const d0 = await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')

  // Move by dragging the shape.
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(at.x + i * 6, at.y + i * 4)
  await page.mouse.up()
  const b1 = await boxOf(page)
  check(near(b1.x - b0.x, 30) && near(b1.y - b0.y, 20), `${label}: dragging a shape moves it with the pointer (${(b1.x - b0.x).toFixed(1)}, ${(b1.y - b0.y).toFixed(1)})`)
  await page.keyboard.press(`${MOD}+z`)
  check((await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')) === d0, `${label}: one Undo puts the moved shape back`)

  // Scale from the bottom-right handle, then in proportion with Shift.
  const corner = await page.locator('[data-box-handle="1,1"]').boundingBox()
  const cx = corner.x + corner.width / 2
  const cy = corner.y + corner.height / 2
  const pastBefore = (await page.getByRole('button', { name: 'Undo' }).isEnabled())
  const editedBefore = await page.locator('[data-edited]').count()
  await page.mouse.click(cx, cy)
  check((await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')) === d0 && (await page.locator('[data-edited]').count()) === editedBefore && (await page.getByRole('button', { name: 'Undo' }).isEnabled()) === pastBefore, `${label}: clicking a scale handle without dragging changes nothing`)
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) await page.mouse.move(cx + i * 10, cy + i * 5)
  await page.mouse.up()
  const b2 = await boxOf(page)
  check(near(b2.width - b0.width, 40) && near(b2.height - b0.height, 20) && near(b2.x, b0.x) && near(b2.y, b0.y), `${label}: dragging a corner scales from the opposite corner`)
  await shot(page, `${n}e-${label}-scaled`)
  await page.keyboard.press(`${MOD}+z`)
  await page.mouse.move(cx, cy)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) await page.mouse.move(cx + i * 10, cy + i * 2)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const b3 = await boxOf(page)
  check(Math.abs(b3.width / b3.height - b0.width / b0.height) < 0.03, `${label}: Shift keeps proportions (${(b0.width / b0.height).toFixed(3)} → ${(b3.width / b3.height).toFixed(3)})`)
  await page.keyboard.press(`${MOD}+z`)

  // Typed width, then a Shift+arrow nudge read back from X.
  // Typed key by key, as a person would, so each digit is its own change.
  const width = page.getByLabel('Width')
  const w0 = Number(await width.inputValue())
  await width.selectText()
  await width.pressSequentially(String(Math.round(w0 * 2)))
  await width.press('Enter')
  const b4 = await boxOf(page)
  check(Math.abs(b4.width / b0.width - Math.round(w0 * 2) / w0) < 0.02, `${label}: typing a width resizes the shape (${w0} → ${Math.round(w0 * 2)})`)
  await page.keyboard.press(`${MOD}+z`)
  check((await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')) === d0, `${label}: one Undo reverts the typed width`)
  // Typed key by key, the digits on the way (W = 1, 10…) must not round the
  // shape: the result is exactly what setting the value in one go gives.
  const target = String(Math.round(w0 * 1.5))
  await width.selectText()
  await width.pressSequentially(target)
  await width.press('Enter')
  const typed = await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')
  await page.keyboard.press(`${MOD}+z`)
  await width.fill(target)
  await width.press('Enter')
  const once = await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')
  check(typed === once, `${label}: typing a width digit by digit gives exactly the same shape as setting it at once`)
  await page.keyboard.press(`${MOD}+z`)
  const x0 = Number(await page.getByLabel('X position').inputValue())
  await page.mouse.move(at.x, at.y) // focus back on the canvas, out of the field
  await page.locator('h1').click()
  await page.keyboard.press('Shift+ArrowRight')
  const x1 = Number(await page.getByLabel('X position').inputValue())
  check(near(x1 - x0, 10, 0.02), `${label}: Shift+→ nudges 10 px (${x0} → ${x1})`)
  await page.keyboard.press(`${MOD}+z`)

  // Shift-click adds a shape; a marquee from the margin takes every shape inside; ⌘A takes all.
  const other = await page.locator('path[data-path-id]').evaluateAll((els, id) => els.map((e) => e.dataset.pathId).filter((x) => x !== id), id)
  let added = false
  for (const o of other.slice(-8)) {
    const p = await pointOn(page, o)
    if (!p) continue
    await page.keyboard.down('Shift')
    await page.mouse.click(p.x, p.y)
    await page.keyboard.up('Shift')
    added = (await page.locator('[data-selection-box]').getAttribute('data-selection-box')) === '2'
    break
  }
  check(added, `${label}: Shift-click adds a second shape`)
  await page.keyboard.press('Escape')
  const total = await page.locator('path[data-path-id]').count()
  const sheet = await page.locator('svg[aria-label="Traced SVG"]').boundingBox()
  await page.mouse.move(sheet.x - 16, sheet.y - 16)
  await page.mouse.down()
  for (let i = 1; i <= 5; i++) await page.mouse.move(sheet.x - 16 + ((sheet.width + 32) * i) / 5, sheet.y - 16 + ((sheet.height + 32) * i) / 5)
  await page.mouse.up()
  const swept = Number((await page.locator('[data-selection-box]').getAttribute('data-selection-box')) ?? 0)
  check(swept === total, `${label}: a marquee round the whole image selects all ${total} shapes (${swept})`)
  await page.keyboard.press('Escape')
  await page.keyboard.press(`${MOD}+a`)
  check(Number(await page.locator('[data-selection-box]').getAttribute('data-selection-box')) === total, `${label}: ${MOD}+A selects every shape`)
  // A Shift-click that misses every shape keeps the selection.
  await page.keyboard.down('Shift')
  await page.mouse.click(sheet.x - 10, sheet.y - 10)
  await page.keyboard.up('Shift')
  check(Number(await page.locator('[data-selection-box]').getAttribute('data-selection-box')) === total, `${label}: a Shift-click on empty canvas keeps the selection`)
  // Switching to Nodes narrows to one shape, so Delete can't remove shapes you can't see.
  await page.keyboard.press('a')
  await page.keyboard.press('Delete')
  check((await page.locator('path[data-path-id]').count()) === total - 1, `${label}: Delete in Nodes after select-all removes only the shape shown`)
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press('v')
  await page.keyboard.press('Escape')
  check((await page.locator('[data-selection-box]').count()) === 0, `${label}: Esc clears the selection`)

  // Double-click goes into the shape's nodes.
  await page.mouse.dblclick(at.x, at.y)
  check((await page.getByRole('radio', { name: 'Nodes' }).getAttribute('aria-checked')) === 'true' && (await page.locator('[data-node]').count()) > 0, `${label}: double-clicking a shape edits its nodes`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.keyboard.press('v')
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

  // Select the largest shape with the Nodes tool by clicking its hit target, then drag a node.
  await page.keyboard.press('a')
  check((await page.getByRole('radio', { name: 'Nodes' }).getAttribute('aria-checked')) === 'true', `${label}: A picks the Nodes tool`)
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
  // Undo the drag again, so the checks below start from the traced shape.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  check((await page.locator(`svg[aria-label="Traced SVG"] path`).nth(best).getAttribute('d')) === dBefore, `${label}: and Undo takes it away again`)

  await smoothChecks(page, label)

  // A marquee from the margin selects the nodes inside it.
  const sheetBox = await page.locator('svg[aria-label="Traced SVG"]').boundingBox()
  await page.mouse.move(sheetBox.x - 12, sheetBox.y - 12)
  await page.mouse.down()
  for (let i = 1; i <= 4; i++) await page.mouse.move(sheetBox.x - 12 + ((sheetBox.width + 24) * i) / 4, sheetBox.y - 12 + ((sheetBox.height / 2 + 12) * i) / 4)
  await page.mouse.up()
  const picked = await page.locator('[data-node-selected]').count()
  const expected = await page.locator('[data-node]').evaluateAll((els, top) => els.filter((e) => e.getBoundingClientRect().y + e.getBoundingClientRect().height / 2 <= top).length, sheetBox.y + sheetBox.height / 2)
  check(picked > 1 && Math.abs(picked - expected) <= 1, `${label}: a marquee selects the nodes inside it (${picked} of ${expected} in the top half)`)
  await shot(page, `${n}b2-${label}-nodes-marquee`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  await selectChecks(page, label, id, n)

  // Mirror the left half onto the right.
  const before = await asymmetry(page, await exportSvg(page))
  await page.getByRole('radio', { name: 'Mirror' }).click()
  await page.locator('[data-overlay="axis"]').waitFor()
  await shot(page, `${n}c-${label}-mirror-tool`)
  await page.getByRole('button', { name: /Mirror left onto right/ }).click()
  await page.getByRole('radio', { name: 'Select', exact: true, checked: true }).waitFor({ timeout: 15000 })
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
await handle.blur()

// The shortcuts panel: ? opens it, Esc closes it.
await page.keyboard.press('Shift+Slash')
const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
await dialog.waitFor()
check((await dialog.locator('kbd').count()) > 15, `? opens the shortcuts panel (${await dialog.locator('kbd').count()} keys listed)`)
await shot(page, '04d-shortcuts')
await page.keyboard.press('Escape')
const closed = await dialog.waitFor({ state: 'hidden', timeout: 3000 }).then(() => true, () => false)
check(closed, 'Esc closes the shortcuts panel')

// Header icons: the keyboard opens the same panel; the tooltip shows on keyboard focus; sun/moon switches theme.
const kb = page.getByRole('button', { name: 'Keyboard shortcuts' })
await kb.click()
await dialog.waitFor()
await page.keyboard.press('Escape')
await dialog.waitFor({ state: 'hidden' })
await kb.focus()
await page.keyboard.press('Shift+Tab')
await page.keyboard.press('Tab')
await page.waitForTimeout(400)
const tipOpacity = await kb.locator('span').evaluate((el) => getComputedStyle(el).opacity)
check(tipOpacity === '1', `the keyboard icon opens the panel, and its tooltip shows on keyboard focus (opacity ${tipOpacity})`)
await page.getByRole('button', { name: 'Use dark theme' }).click()
const themed = await page.evaluate(() => document.documentElement.dataset.theme)
await shot(page, '04e-dark-header')
await page.getByRole('button', { name: 'Use light theme' }).click()
check(themed === 'dark' && (await page.evaluate(() => document.documentElement.dataset.theme)) !== 'dark', 'the moon switches to dark, then the sun back to light')
await kb.blur()

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
