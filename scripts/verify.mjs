/**
 * End-to-end check in a real browser, against a running build.
 *
 *   npm run build && npm run preview &
 *   npm run verify                                   # local preview
 *   npm run verify -- https://inlaytrace.com/app/
 *
 * Checks the app at the URL, then the site (landing page and docs) at that
 * URL's origin. Under mattblack.space the origin is the portfolio, so the site
 * checks are skipped there; SITE=<origin> runs them against another host.
 *
 * Env: CHROME_PATH (use an installed Chromium), SHOTS (directory for
 * screenshots), FIXTURE (an image file to trace in addition to the sample).
 *
 * It fails on any console error or CSP violation. That matters more than it
 * sounds: a CSP that blocks WebAssembly leaves a page that looks fine and
 * never traces anything, and only a real browser with the real headers sees it.
 */
import { chromium } from 'playwright'
import { unzipSync } from 'fflate'
import { encode as encodePng } from 'fast-png'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:4173/app/'
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

/** A fixture SVG (scripts/fixtures) rasterised to a 480 px PNG, as a user would drop it. */
async function fixturePng(page, file) {
  const b64 = await page.evaluate(async (svg) => {
    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()
    const c = new OffscreenCanvas(480, 480)
    c.getContext('2d').drawImage(img, 0, 0, 480, 480)
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  }, readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
  return b64
}

async function exportSvg(page) {
  await page.getByText(/^(Traced in [\d,]+ ms|Opened the SVG)$/).waitFor()
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

/** Nodes tool: add a node on the outline, then smooth, sharpen and round corners. Leaves the shape as it was. */
async function nodeOpChecks(page, label) {
  const nodes = () => page.locator('[data-node]').count()
  const handlesOf = (key) => page.locator(`[data-handle^="${key}:"]`).count()
  const outlineLength = () => page.locator('[data-outline-hit]').evaluate((el) => el.getTotalLength())
  const n0 = await nodes()
  const len0 = await outlineLength()
  const d0 = await page.locator('[data-outline-hit]').getAttribute('d')
  // A point on the outline, 37% of the way round, clear of existing nodes and
  // with the selected shape under it: on an edge shared with a neighbour, a
  // press goes to whichever shape is under the pointer.
  const spot = await page.evaluate(() => {
    const el = document.querySelector('[data-outline-hit]')
    const id = document.querySelector('[data-selected]').getAttribute('data-selected')
    const ownAt = (p) => document.elementsFromPoint(p.x, p.y).find((e) => e.dataset?.pathId)?.dataset.pathId === id
    const total = el.getTotalLength()
    const m = el.getScreenCTM()
    const taken = [...document.querySelectorAll('[data-node]')].map((n) => n.getBoundingClientRect())
    // The usual spots first, then every 5% round, so a retrace that moves a node doesn't fail the run.
    for (const f of [0.37, 0.21, 0.63, 0.81, 0.12, 0.5, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20)]) {
      const q = el.getPointAtLength(total * f)
      const p = new DOMPoint(q.x, q.y).matrixTransform(m)
      if (taken.every((r) => Math.hypot(r.x + r.width / 2 - p.x, r.y + r.height / 2 - p.y) > 16) && ownAt(p)) return { x: p.x, y: p.y }
    }
    return null
  })
  if (!spot) return label === 'sample' ? check(false, 'sample: a clear spot on the outline for node operations') : console.log(`         ${label}: no clear spot on the outline; skipping node operations`)
  await page.mouse.dblclick(spot.x, spot.y)
  const n1 = await nodes()
  const len1 = await outlineLength()
  check(n1 === n0 + 1 && (await page.locator('[data-node-selected]').count()) === 1, `${label}: double-clicking the outline adds a node and selects it (${n0} → ${n1})`)
  check(Math.abs(len1 - len0) / len0 < 0.002, `${label}: adding a node leaves the outline where it was (length ${len0.toFixed(1)} → ${len1.toFixed(1)})`)
  await page.keyboard.press(`${MOD}+z`)

  // A corner (a node with no handles) and a curved node (one with both).
  const keys = await page.locator('[data-node]').evaluateAll((els) => els.map((e) => e.dataset.node))
  const isClear = async (key) => {
    const b = await page.locator(`[data-node="${key}"]`).boundingBox()
    const others = await page.locator('[data-node], [data-handle]').evaluateAll((els, k) => els.filter((e) => e.dataset.node !== k && !(e.dataset.handle ?? '').startsWith(k + ':')).map((e) => e.getBoundingClientRect().toJSON()), key)
    return others.every((o) => Math.hypot(o.x - b.x, o.y - b.y) > 14) ? b : null
  }
  let corner = null
  let curved = null
  for (const k of keys) {
    const h = await handlesOf(k)
    if (!corner && h === 0) corner = (await isClear(k)) && k
    if (!curved && h === 2) curved = (await isClear(k)) && k
    if (corner && curved) break
  }
  const press = async (key) => {
    const b = await page.locator(`[data-node="${key}"]`).boundingBox()
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
  }
  if (corner) {
    // The corner's angle, from the outline 4 units either side of it.
    const box = await page.locator(`[data-node="${corner}"]`).boundingBox()
    const angle = await page.evaluate(({ x, y }) => {
      const el = document.querySelector('[data-outline-hit]')
      const at = new DOMPoint(x, y).matrixTransform(el.getScreenCTM().inverse())
      const total = el.getTotalLength()
      let best = 0
      for (let l = 0, bd = Infinity; l < total; l += 0.25) {
        const q = el.getPointAtLength(l)
        const d = Math.hypot(q.x - at.x, q.y - at.y)
        if (d < bd) (bd = d), (best = l)
      }
      const c = el.getPointAtLength(best)
      const a = el.getPointAtLength((best - 4 + total) % total)
      const b = el.getPointAtLength((best + 4) % total)
      const u = [a.x - c.x, a.y - c.y]
      const v = [b.x - c.x, b.y - c.y]
      return Math.acos((u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)))
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await press(corner)
    await page.getByLabel('Corner radius').fill('3')
    await page.getByRole('button', { name: 'Round corner' }).click()
    const rounded = await outlineLength()
    // A 3 px arc in a corner of angle φ cuts 2 × 3 / tan(φ/2) of edge and adds 3 × (π − φ) of arc:
    // about 1.3 px at 90°, more at a sharper corner (at most: a short edge caps the radius).
    const cut = (6 / Math.tan(angle / 2) - 3 * (Math.PI - angle))
    check((await nodes()) === n0 + 1 && rounded < len0 && len0 - rounded < cut + 1, `${label}: Round corner replaces a corner with two nodes and an arc (outline ${len0.toFixed(1)} → ${rounded.toFixed(1)}, ${Math.round((angle * 180) / Math.PI)}° corner, at most about ${cut.toFixed(1)} shorter)`)
    await page.keyboard.press(`${MOD}+z`)
    await press(corner)
    await page.getByRole('button', { name: 'Smooth' }).click()
    check((await handlesOf(corner)) === 2, `${label}: Smooth gives a corner two handles`)
    await page.keyboard.press(`${MOD}+z`)
  } else if (label === 'sample') check(false, 'sample: a clear corner node for Round and Smooth')
  else console.log(`         ${label}: no clear corner node; skipping Round and Smooth`)
  if (curved) {
    await press(curved)
    await page.getByRole('button', { name: 'Sharpen' }).click()
    check((await handlesOf(curved)) === 0, `${label}: Sharpen drops a node's handles`)
    await page.keyboard.press(`${MOD}+z`)
  } else if (label === 'sample') check(false, 'sample: a clear curved node for Sharpen')
  else console.log(`         ${label}: no clear curved node; skipping Sharpen`)
  check((await page.locator('[data-outline-hit]').getAttribute('d')) === d0, `${label}: undo puts the shape back exactly after the node operations`)
}

/** Select tool: rotate by quarter turns and by the handle, and simplify. Leaves the shape as it was. */
async function shapeOpChecks(page, label, id) {
  const b0 = await boxOf(page)
  const d0 = await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')
  await page.getByRole('button', { name: 'Rotate 90° clockwise' }).click()
  const b1 = await boxOf(page)
  check(near(b1.width, b0.height) && near(b1.height, b0.width) && near(b1.x + b1.width / 2, b0.x + b0.width / 2), `${label}: ↻ 90° turns the shape a quarter about its centre`)
  await page.getByRole('button', { name: 'Rotate 90° anticlockwise' }).click()
  const b2 = await boxOf(page)
  check(near(b2.x, b0.x, 0.5) && near(b2.width, b0.width, 0.5), `${label}: ↺ 90° turns it back`)
  await page.keyboard.press(`${MOD}+z`)
  await page.keyboard.press(`${MOD}+z`)
  check((await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')) === d0, `${label}: two Undos restore it exactly`)

  // The rotate handle, swung a quarter of the way round the centre with Shift: snaps to a multiple of 15°.
  const knob = await page.locator('[data-rotate-handle]').boundingBox()
  const k = { x: knob.x + knob.width / 2, y: knob.y + knob.height / 2 }
  const c = { x: b0.x + b0.width / 2, y: b0.y + b0.height / 2 }
  const r = Math.hypot(k.x - c.x, k.y - c.y)
  await page.mouse.move(k.x, k.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2 - 0.12) // just short of 90°: snaps to 90°
    await page.mouse.move(c.x + r * Math.cos(a), c.y + r * Math.sin(a))
  }
  await page.mouse.up()
  await page.keyboard.up('Shift')
  const b3 = await boxOf(page)
  check(near(b3.width, b0.height) && near(b3.height, b0.width), `${label}: dragging the rotate handle with Shift snaps to 90°`)
  await shot(page, `rot-${label}`)
  await page.keyboard.press(`${MOD}+z`)

  // Simplify: the button says what it would leave, and that's what you get.
  await page.getByLabel('Simplify').fill('2')
  check(await page.getByText('±2.00 px').isVisible(), `${label}: the Simplify slider is at ±2 px`)
  await page.waitForTimeout(400) // the count is worked out once the selection settles
  const button = page.getByRole('button', { name: /Simplify:|Already as simple/ })
  let text = await button.innerText()
  // A shape drawn exactly (a true circle) may already be as simple at ±2: try looser.
  for (const t of ['3', '4']) {
    if (/→/.test(text)) break
    await page.getByLabel('Simplify').fill(t)
    await page.waitForTimeout(200)
    text = await button.innerText()
  }
  const m = text.match(/(\d+) → (\d+)/)
  if (m) {
    await button.click()
    const after = await button.innerText()
    check(after.includes(`(${m[2]} nodes)`) || after.includes(`${m[2]} →`), `${label}: Simplify does what it says (${m[1]} → ${m[2]} nodes; now "${after}")`)
    await page.keyboard.press(`${MOD}+z`)
    check((await page.locator(`path[data-path-id="${id}"]`).getAttribute('d')) === d0, `${label}: one Undo reverts Simplify`)
  } else if (label === 'sample') check(false, `sample: Simplify has something to remove by ±4 px ("${text}")`)
  else console.log(`         ${label}: shape already as simple at ±4 px ("${text}")`)
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
  const width = page.getByLabel('Width', { exact: true })
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
  await page.locator('header').click({ position: { x: 700, y: 28 } }) // empty header space: blurs the field without following a link
  await page.keyboard.press('Shift+ArrowRight')
  const x1 = Number(await page.getByLabel('X position').inputValue())
  check(near(x1 - x0, 10, 0.02), `${label}: Shift+→ nudges 10 px (${x0} → ${x1})`)
  await page.keyboard.press(`${MOD}+z`)

  await shapeOpChecks(page, label, id)

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
  // The largest shape with plenty of fitted nodes (an exact circle has four, and nothing to simplify).
  const drawn = page.locator(`svg[aria-label="Traced SVG"] path`)
  for (let i = 0; i < (await hits.count()); i++) {
    const b = await hits.nth(i).boundingBox()
    const nodes = ((await drawn.nth(i).getAttribute('d')) ?? '').match(/[LC]/g)?.length ?? 0
    if (b && b.width * b.height > bestArea && b.width < sheet.width * 0.9 && nodes >= 24) [best, bestArea] = [i, b.width * b.height]
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
  await nodeOpChecks(page, label)

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
check(!csp.includes("'wasm-unsafe-eval'"), "the app page's CSP allows no WebAssembly (only the AI worker may)")
check(/worker-src[^;]*'self'/.test(csp) && !csp.includes("'sha256-"), "the app gets its own CSP (workers allowed), not the site's")
check((await page.getByRole('link', { name: 'Inlay', exact: true }).getAttribute('href')) === '/', 'the Inlay wordmark leads to the landing page')
check((await page.getByRole('navigation', { name: 'About Inlay' }).getByRole('link', { name: 'Privacy' }).getAttribute('href')) === '/privacy/', 'the app links to the privacy page')
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
await retrace(page, () => page.getByRole('radio', { name: /Pixel art/ }).click())
{
  // Pixel art goes through Inlay's staircase: every coordinate a whole pixel, only straight lines.
  const ds = await page.locator(VECTOR).evaluateAll((els) => els.map((e) => e.getAttribute('d')))
  const fractional = ds.join(' ').match(/\d+\.\d+/g) ?? []
  check(ds.length > 3 && fractional.length === 0 && !ds.some((d) => /[CQSA]/i.test(d)), `pixel art is drawn on whole pixels with straight lines (${ds.length} paths)`)
}
await retrace(page, () => page.getByRole('radio', { name: /^Poster/ }).click())
{
  // Poster is Inlay too (#53): a quantized palette, stacked by default; Cut out re-traces with holes cut.
  const stacked = await page.locator(VECTOR).count()
  check(stacked > 3, `Poster traces with Inlay, no WebAssembly (${stacked} paths)`)
  const shapes = page.getByRole('radiogroup', { name: 'Shapes' })
  check((await shapes.getByRole('radio', { name: 'Stacked' }).getAttribute('aria-checked')) === 'true', 'Poster stacks shapes by default')
  await retrace(page, () => shapes.getByRole('radio', { name: 'Cut out' }).click())
  const subpaths = await page.locator(VECTOR).evaluateAll((els) => els.reduce((n, e) => n + (e.getAttribute('d').match(/M/g) ?? []).length, 0))
  check(subpaths > stacked, `Cut out gives shapes with holes (${subpaths} subpaths in ${await page.locator(VECTOR).count()} paths)`)
}
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

// ---- Eyedropper and merge ------------------------------------------------------
{
  const hexOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const apart = (a, b) => Math.max(...hexOf(a).map((v, i) => Math.abs(v - hexOf(b)[i])))
  // Pick, for ink 3, the colour under the middle of an ink-4 shape.
  const target = page.locator(INKS).nth(2)
  const targetHex = await target.getAttribute('data-ink')
  const sourceHex = await page.locator(INKS).nth(3).getAttribute('data-ink')
  const sourceId = await page.locator(`${VECTOR}[fill="${sourceHex}"]`).first().evaluate((el) => {
    const i = [...el.parentNode.querySelectorAll('path')].indexOf(el)
    return document.querySelectorAll('path[data-path-id]')[i].dataset.pathId
  })
  const spot = await pointOn(page, sourceId)
  await target.getByRole('button', { name: /Pick a colour/ }).click()
  await page.locator('[data-picking]').waitFor()
  await page.keyboard.press('Escape')
  check((await page.locator('[data-picking]').count()) === 0, 'Esc puts the eyedropper away')
  await target.getByRole('button', { name: /Pick a colour/ }).click()
  await page.mouse.click(spot.x, spot.y)
  const shown = (await target.locator('.font-mono').first().innerText()).trim()
  check(shown !== targetHex && apart(shown, sourceHex) <= 24, `the eyedropper picks from the original: ${targetHex} → ${shown} (the ${sourceHex} area)`)
  await page.keyboard.press('Control+z')
  check((await target.locator('.font-mono').first().innerText()).trim() === targetHex, 'one Undo takes the picked colour back')

  // Merge ink 4 into ink 3: one fewer colour, listed as merged, and Unmerge brings it back.
  const before = await page.locator(INKS).count()
  await retrace(page, async () => {
    await page.locator(INKS).nth(3).getByRole('button', { name: /^Merge/ }).click()
    await page.getByRole('button', { name: `Merge into ${targetHex}` }).click()
  })
  const after = await page.locator(INKS).count()
  check(after === before - 1 && (await page.locator(`[data-merged="${sourceHex}"]`).count()) === 1, `merging re-traces with one colour fewer (${before} → ${after})`)
  check((await page.locator(`${VECTOR}[fill="${sourceHex}"]`).count()) === 0, 'and no shape keeps the merged colour')
  await shot(page, '04f-merged')
  await retrace(page, () => page.getByRole('button', { name: `Unmerge ${sourceHex}` }).click())
  check((await page.locator(INKS).count()) === before, 'Unmerge brings the colour back')
}
await page.getByRole('radio', { name: 'Split' }).click()

// ---- Export size and formats ------------------------------------------------------
{
  await page.getByText('Size and other formats').click()
  await shot(page, '04g-export-options')
  await page.getByLabel('Export unit').selectOption('mm')
  const w = page.getByLabel('Export width')
  const h = page.getByLabel('Export height')
  check(Math.abs(Number(await w.inputValue()) - (640 * 25.4) / 96) < 0.02, `switching to mm converts the size (${await w.inputValue()} mm for 640 px)`)
  await w.fill('100')
  check(Number(await h.inputValue()) === 100, 'height follows the drawing’s proportions (100 × 100 mm)')
  const svgMm = await exportSvg(page)
  check(/^<svg[^>]* width="100mm" height="100mm"/.test(svgMm) && /viewBox="0 0 640 640"/.test(svgMm), 'the SVG opens at 100 mm and keeps its viewBox')
  const grab = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()])
    const buf = readFileSync(await dl.path())
    if (shots) writeFileSync(join(shots, dl.suggestedFilename()), buf)
    return { buf, name: dl.suggestedFilename() }
  }
  const pdf = await grab('PDF')
  const pdfText = pdf.buf.toString('latin1')
  const pt = Math.round(((100 * 72) / 25.4) * 1000) / 1000
  check(pdf.name === 'sample-badge.pdf' && pdfText.startsWith('%PDF-1.4') && pdfText.includes(`/MediaBox [0 0 ${pt} ${pt}]`), `PDF downloads as a ${pt} pt page (100 mm)`)
  const eps = await grab('EPS')
  check(eps.name === 'sample-badge.eps' && eps.buf.toString().startsWith('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 284 284'), 'EPS downloads with a 100 mm bounding box')
  const dxf = await grab('DXF')
  const dxfText = dxf.buf.toString()
  check(dxf.name === 'sample-badge.dxf' && dxfText.includes('$ACADVER\n1\nAC1009') && dxfText.includes('$INSUNITS\n70\n4') && /\nLAYER\n2\nINK_[0-9A-F]{6}\n/.test(dxfText) && dxfText.trimEnd().endsWith('EOF'), 'DXF downloads in mm, one layer per colour')
  await page.getByLabel('PNG resolution').selectOption('150')
  const png = await grab(/^PNG/)
  const dims = [png.buf.readUInt32BE(16), png.buf.readUInt32BE(20)]
  check(png.buf.subarray(1, 4).toString() === 'PNG' && dims[0] === 591 && dims[1] === 591, `PNG renders at 150 dpi: ${dims.join(' × ')} px for 100 mm`)
  await page.getByRole('button', { name: 'Reset to the traced size' }).click()
  check((await w.inputValue()) === '640' && (await page.getByLabel('Export unit').inputValue()) === 'px', 'Reset goes back to the traced size')
  await page.getByText('Size and other formats').click()
}

// ---- The session survives a reload ------------------------------------------------
{
  // A change, then a reload straight away: the save that waits 600 ms for
  // more changes is written as the page unloads (a quick reload lost it).
  await page.getByRole('tab', { name: /Edit/ }).click()
  await page.locator(INKS).nth(2).locator('input[type=color]').fill('#654321')
  await page.reload()
  await traced(page)
  check((await page.locator('[data-session]').getAttribute('data-session')) === 'restored', 'a reload restores the session, and says so')
  check((await page.locator('aside .truncate').first().innerText()) === 'sample-badge' && (await page.locator(`${VECTOR}[fill="#123456"]`).count()) > 0, 'with the same image and its colour edits')
  check((await page.locator(`${VECTOR}[fill="#654321"]`).count()) > 0, 'including a change made just before the reload')
  await page.getByRole('radio', { name: 'Split' }).click()
}

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

// Each preset's description shows in full under its name (side by side, they were cut off).
const cut = await page.getByRole('radiogroup', { name: 'Image type' }).locator('.field-hint').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent))
check(cut.length === 0, `every preset's description fits (${cut.join(', ') || 'none cut off'})`)

// The header offers sign-in to someone with no session (or when /api isn't set up).
const signIn = page.locator('header [data-account="signed-out"]')
const signInShown = await signIn.waitFor({ timeout: 5000 }).then(() => true, () => false)
check(signInShown && (await signIn.getAttribute('href')) === '/app/account/', 'the header shows Sign in, linking to the account page')

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
  console.log(`         fixture: ${await fx.locator('aside [data-image-info]').innerText()}, light ink auto-selected: ${light}`)
  await shot(fx, '06-fixture')
  await editorChecks(fx, 'fixture', '07')
}

// ---- Exact shapes: on by default for flat art, and can be turned off -------
{
  const ex = await newPage({ width: 1440, height: 900 })
  await ex.goto(url)
  await ex.getByRole('button', { name: 'Try a sample' }).click()
  await traced(ex)
  const circle = async () => (await ex.locator(`${VECTOR}`).evaluateAll((ps) => ps.map((p) => p.getAttribute('d')))).some((d) => /^M[\d. ]+(C[\d. ]+){4}Z/.test(d) || /Z\s*M[\d. ]+(C[\d. ]+){4}Z/.test(d))
  check((await ex.getByRole('radiogroup', { name: 'Exact shapes' }).getByRole('radio', { name: 'On' }).getAttribute('aria-checked')) === 'true', 'Exact shapes is on for Logo')
  check(await circle(), "the sample's big disc is drawn as an exact circle (four curves)")
  await retrace(ex, () => ex.getByRole('radiogroup', { name: 'Exact shapes' }).getByRole('radio', { name: 'Off' }).click())
  check(!(await circle()), 'turning Exact shapes off fits it as traced')
  await ex.close()
}

// ---- Groups and paint order ------------------------------------------------
{
  const gp = await newPage({ width: 1440, height: 900 })
  await gp.goto(url)
  await gp.getByRole('button', { name: 'Try a sample' }).click()
  await traced(gp)
  await gp.getByRole('tab', { name: /Edit/ }).click()
  const ids = await gp.locator('path[data-path-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-path-id')))
  // Select two shapes with shift-click, via their hit targets.
  for (const [i, id] of [ids[1], ids[2]].entries()) {
    const at = await pointOn(gp, id)
    if (i) await gp.keyboard.down('Shift')
    await gp.mouse.click(at.x, at.y)
    if (i) await gp.keyboard.up('Shift')
  }
  check((await gp.locator('[data-selection-box]').getAttribute('data-selection-box')) === '2', 'two shapes selected')
  await gp.keyboard.press(`${MOD}+g`)
  await gp.keyboard.press('Escape')
  const one = await pointOn(gp, ids[1])
  await gp.mouse.click(one.x, one.y)
  check((await gp.locator('[data-selection-box]').getAttribute('data-selection-box')) === '2', 'after grouping, clicking one shape selects the group')
  check(/<g id="g\d+">/.test(await exportSvg(gp)), 'the group exports as a <g>')
  const before = await gp.locator(`${VECTOR}`).evaluateAll((els) => els.map((e) => e.getAttribute('d')))
  await gp.getByRole('button', { name: 'To front' }).click()
  const after = await gp.locator(`${VECTOR}`).evaluateAll((els) => els.map((e) => e.getAttribute('d')))
  check(after.slice(-2).join() === [before[1], before[2]].join() || after.slice(-2).sort().join() === [before[1], before[2]].sort().join(), 'To front paints the group last')
  await gp.keyboard.press(`${MOD}+z`)
  check((await gp.locator(`${VECTOR}`).evaluateAll((els) => els.map((e) => e.getAttribute('d')))).join() === before.join(), 'one Undo puts the order back')
  await gp.close()
}

// ---- Opening an SVG to edit ---------------------------------------------------
{
  const sv = await newPage({ width: 1440, height: 900 })
  await sv.goto(url)
  const file = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <defs><linearGradient id="sky"><stop offset="0" stop-color="#3366cc"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>
  <rect width="200" height="100" fill="url(#sky)"/>
  <g transform="translate(100 50)"><circle r="30" fill="#e0a030"/><path d="M-10 -10a10 10 0 0 1 20 0z" fill="#202020"/></g>
  <text x="10" y="90">Hello</text>
  <script>window.__ran = true</script>
</svg>`
  await sv.locator('input[type=file]').setInputFiles({ name: 'drawing.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(file) })
  await sv.locator('[data-svg-opened]').waitFor({ state: 'attached', timeout: 15_000 })
  check((await sv.getByRole('tab', { name: /Edit/ }).getAttribute('aria-selected')) === 'true', 'an SVG opens straight into the Edit tab')
  check((await sv.locator(VECTOR).count()) === 3, `its three shapes are the drawing (${await sv.locator(VECTOR).count()})`)
  await sv.getByRole('tab', { name: /Trace/ }).click()
  const notes = await sv.locator('[data-svg-opened]').innerText()
  check(/gradient \(drawn in its first colour\)/.test(notes) && /text/.test(notes), 'what it couldn’t keep is listed (a gradient, text)')
  check((await sv.evaluate(() => window.__ran)) !== true, 'the SVG’s own script never runs')
  const exported = await exportSvg(sv)
  check((exported.match(/<path/g) ?? []).length === 3 && /#36c|#3366cc/i.test(exported), 'the export has its shapes, the gradient in its first colour')
  await retrace(sv, () => sv.getByRole('button', { name: 'Trace it as an image instead' }).click())
  check((await sv.locator('[data-svg-opened]').count()) === 0, 'and it can be traced as an image instead')
  await sv.close()
}

// ---- Soft shading as gradients -------------------------------------------------
{
  const gr = await newPage({ width: 1440, height: 900 })
  await gr.goto(url)
  await gr.locator('input[type=file]').setInputFiles({ name: 'shaded.png', mimeType: 'image/png', buffer: Buffer.from(await fixturePng(gr, 'shaded.svg'), 'base64') })
  await traced(gr)
  await retrace(gr, () => gr.getByRole('radio', { name: /^Illustration/ }).click())
  const shaded = () => gr.locator(VECTOR).evaluateAll((ps) => ps.filter((p) => /^url\(#/.test(p.getAttribute('fill') ?? '')).length)
  check((await shaded()) === 3, `Illustration draws the sky, hill and ball with gradients (${await shaded()})`)
  const exported = await exportSvg(gr)
  check((exported.match(/<(linear|radial)Gradient/g) ?? []).length === 3 && /fill="url\(#[\w-]+\) #[0-9a-f]{3,6}"/.test(exported), 'the export keeps them, each with its colour as the fallback')
  await retrace(gr, () => gr.getByRole('radiogroup', { name: 'Shapes' }).getByRole('radio', { name: 'Cut out' }).click())
  check((await shaded()) === 0, 'cut out, every fill is flat')
  await gr.close()
}

// ---- A photo gets the Poster suggestion -----------------------------------------
{
  const ph = await newPage({ width: 1440, height: 900 })
  await ph.goto(url)
  await ph.locator('input[type=file]').setInputFiles({ name: 'emblem.png', mimeType: 'image/png', buffer: Buffer.from(await fixturePng(ph, 'emblem.svg'), 'base64') })
  await ph.getByText(/Traced in [\d,]+ ms/).waitFor({ timeout: 30_000 })
  check((await ph.locator('[data-photo-hint]').count()) === 0, 'a logo gets no Poster suggestion')
  await ph.locator('input[type=file]').setInputFiles(new URL('./fixtures/photos/rocket.jpg', import.meta.url).pathname)
  await ph.locator('[data-photo-hint]').waitFor({ timeout: 15_000 })
  check(true, 'a photo on Logo suggests Poster')
  await ph.getByRole('button', { name: 'Use Poster' }).click()
  check((await ph.getByRole('radio', { name: /^Poster/ }).getAttribute('aria-checked')) === 'true' && (await ph.locator('[data-photo-hint]').count()) === 0, 'Use Poster picks it, and the suggestion goes')
  await ph.getByRole('radio', { name: /^Logo/ }).click()
  check((await ph.locator('[data-photo-hint]').count()) === 0, 'a preset picked by hand is left alone: no suggestion comes back')
  await ph.close()
}

// ---- Batch: several images, one zip --------------------------------------------
{
  const bt = await newPage({ width: 1440, height: 900 })
  await bt.goto(url)
  const a = Buffer.from(await fixturePng(bt, 'emblem.svg'), 'base64')
  const b = Buffer.from(await fixturePng(bt, 'pinwheel.svg'), 'base64')
  await bt.locator('input[type=file]').setInputFiles([
    { name: 'emblem.png', mimeType: 'image/png', buffer: a },
    { name: 'pinwheel.png', mimeType: 'image/png', buffer: b },
    { name: 'emblem.png', mimeType: 'image/png', buffer: b },
    { name: 'drawing.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>') },
  ])
  const dialog = bt.locator('[data-batch]')
  await dialog.waitFor()
  check((await dialog.getByRole('listitem').count()) === 4, 'dropping several images opens the batch, one row each')
  await dialog.getByRole('button', { name: 'Trace all' }).click()
  await dialog.getByRole('button', { name: 'Download zip' }).and(bt.locator(':enabled')).waitFor({ timeout: 60_000 })
  check((await dialog.locator('[data-batch-item="done"]').count()) === 3 && (await dialog.locator('[data-batch-item="skipped"]').count()) === 1, 'three traced, the SVG skipped')
  const [dl] = await Promise.all([bt.waitForEvent('download'), dialog.getByRole('button', { name: 'Download zip' }).click()])
  const names = Object.keys(unzipSync(readFileSync(await dl.path())))
  check(names.sort().join() === 'emblem-2.svg,emblem.svg,pinwheel.svg', `the zip has an SVG per image, same names kept apart (${names.join(', ')})`)
  check((await bt.getByRole('button', { name: 'Try a sample' }).count()) === 1, 'and nothing opened on the page meanwhile')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await bt.close()
}

// ---- Target size: search the settings for a file that fits -------------------
{
  const ts = await newPage({ width: 1440, height: 900 })
  await ts.goto(url)
  await ts.getByRole('button', { name: 'Try a sample' }).click()
  await traced(ts)
  const sizeNow = async () => {
    await ts.getByText(/Traced in [\d,]+ ms$/).waitFor()
    const t = await ts.locator('dt', { hasText: /^Size$/ }).locator('xpath=following-sibling::dd').innerText()
    return parseFloat(t) * (/KB/.test(t) ? 1024 : 1)
  }
  await ts.waitForTimeout(800) // the size shown is the optimised file's, worked out just after the trace
  const before = await sizeNow()
  const target = Math.floor((before * 0.92) / 102.4) / 10 // a little under the current size, in KB
  await ts.getByLabel('Target size in KB').fill(String(target))
  await ts.getByRole('button', { name: 'Find settings' }).click()
  const result = ts.locator('[data-size-result]')
  await result.waitFor({ timeout: 60_000 })
  const text = await result.innerText()
  check(/\(from [\d.]+ KB\)/.test(text), `Target size finds settings under ${target} KB (“${text.split('\n')[0]}”)`)
  await retrace(ts, () => ts.getByRole('button', { name: 'Use these settings' }).click())
  await ts.waitForTimeout(800)
  const after = await sizeNow()
  check(after <= target * 1024 + 51, `and using them gives that size (${(before / 1024).toFixed(1)} → ${(after / 1024).toFixed(1)} KB)`)
  await ts.close()
}

// ---- Symmetry: detected, offered, enforced ---------------------------------
{
  const sym = await newPage({ width: 1440, height: 900 })
  await sym.goto(url)
  const png = (file) => fixturePng(sym, file)

  await sym.locator('input[type=file]').setInputFiles({ name: 'pinwheel.png', mimeType: 'image/png', buffer: Buffer.from(await png('pinwheel.svg'), 'base64') })
  await traced(sym)
  await sym.getByRole('tab', { name: /Edit/ }).click()
  await sym.getByRole('radio', { name: 'Mirror' }).click()
  const note = sym.locator('[data-detected]')
  await note.waitFor({ timeout: 15000 })
  check(/repeats 5 times/.test(await note.innerText()), `a five-fold mark is detected as one (“${(await note.innerText()).trim()}”)`)
  check((await sym.getByRole('radio', { name: 'Turn' }).getAttribute('aria-checked')) === 'true', 'the detected turn is set up in the Mirror tool')
  await shot(sym, '07s-turn-detected')
  const svgBefore = await exportSvg(sym)
  await sym.getByRole('button', { name: 'Repeat the top slice 5 times' }).click()
  await sym.getByRole('radio', { name: 'Select', exact: true, checked: true }).waitFor({ timeout: 15000 })
  const svgAfter = await exportSvg(sym)
  check(svgAfter !== svgBefore && (svgAfter.match(/<path\b/g) ?? []).length >= 2, 'repeating the slice replaces the drawing with turned copies')
  await shot(sym, '07t-turned')

  // A mirror-symmetric mark: the detected axis, and a way back to it after moving it.
  const emblem = Buffer.from(await png('emblem.svg'), 'base64')
  await sym.locator('input[type=file]').setInputFiles({ name: 'emblem.png', mimeType: 'image/png', buffer: emblem })
  const discard = sym.getByRole('button', { name: /Discard/ })
  if (await discard.isVisible().catch(() => false)) await discard.click()
  await traced(sym)
  await sym.getByRole('tab', { name: /Edit/ }).click()
  await sym.getByRole('radio', { name: 'Mirror' }).click()
  const found = sym.locator('[data-detected]', { hasText: 'vertical axis' })
  await found.waitFor({ timeout: 15000 })
  // The trace may be upscaled, so the middle is half the traced width, not 240.
  const at = Number(/x = ([\d.]+)/.exec(await found.innerText())[1])
  const middle = Number(await sym.locator('#axis-pos').getAttribute('max')) / 2
  check(Math.abs(at - middle) <= 1, `a mirror-symmetric mark is detected as one, at its middle (x = ${at} of ${middle * 2})`)
  await sym.locator('#axis-pos').fill('100')
  await sym.getByRole('button', { name: 'Use this axis' }).click()
  check(Number(await sym.locator('#axis-pos').inputValue()) === at, `Use this axis puts the detected axis back (${await sym.locator('#axis-pos').inputValue()})`)
  await sym.close()
}

// ---- Centerline: single strokes ----------------------------------------------
{
  const cl = await newPage({ width: 1440, height: 900 })
  await cl.goto(url)
  await cl.locator('input[type=file]').setInputFiles({ name: 'drawing.png', mimeType: 'image/png', buffer: Buffer.from(await fixturePng(cl, 'strokes.svg'), 'base64') })
  await traced(cl)
  await retrace(cl, () => cl.getByRole('radio', { name: /Centerline/ }).click())
  const strokes = cl.locator(`${VECTOR}[fill="none"][stroke]`)
  const n = await strokes.count()
  const subpaths = n ? ((await strokes.first().getAttribute('d')).match(/M/g) ?? []).length : 0
  check(n > 0 && subpaths >= 5 && subpaths <= 8, `Centerline draws the pen drawing as single strokes (${subpaths} strokes for 6 drawn)`)
  const auto = await cl.getByText(/^Auto \([\d.]+ px\)$/).innerText()
  const measured = Number(/([\d.]+)/.exec(auto)[1])
  // Drawn 3 units wide on a 200-unit drawing; small images are upscaled to trace, so in trace pixels:
  const drawn = (3 / 200) * Number(/width="([\d.]+)"/.exec(await exportSvg(cl))[1])
  check(Math.abs(measured - drawn) < 0.15 * drawn, `the stroke width is measured from the ink (${auto}; drawn ${drawn.toFixed(1)} px)`)
  await retrace(cl, () => cl.getByLabel('Stroke width').fill('2'))
  check((await strokes.first().getAttribute('stroke-width')) === '2', 'a set stroke width is what gets drawn')
  const svg = await exportSvg(cl)
  check(/fill="none"/.test(svg) && /stroke-width="2"/.test(svg) && /stroke-linecap="round"/.test(svg), 'the exported SVG keeps the strokes, round-capped')
  await cl.getByRole('tab', { name: /Edit/ }).click()
  check(await cl.getByRole('radio', { name: 'Mirror' }).isDisabled(), 'Mirror is off for strokes (its booleans work on filled shapes)')
  await shot(cl, '07c-centerline')
  await cl.close()
}

// ---- AI preparation: background removal and upscaling, in the browser -------
{
  const ai = await newPage({ width: 1440, height: 900 })
  const requests = []
  ai.on('request', (r) => requests.push(new URL(r.url())))
  await ai.goto(url)
  await ai.locator('input[type=file]').setInputFiles(new URL('./fixtures/photos/coffee.jpg', import.meta.url).pathname)
  await traced(ai)
  check((await alphaAt(ai, await exportSvg(ai), 2, 2)) === 255, 'before removing the background, the corner is drawn')
  await retrace(ai, async () => {
    await ai.getByLabel('Remove the background').check()
    await ai.locator('[data-prep-status]').waitFor({ state: 'detached', timeout: 120_000 })
  })
  check((await ai.getByRole('alert').count()) === 0, 'background removal runs (U²-Net, in the browser)')
  check((await alphaAt(ai, await exportSvg(ai), 2, 2)) === 0, 'and the background is gone from the trace (the corner is transparent)')
  const prep = requests.find((u) => /\/assets\/prep-.*\.js$/.test(u.pathname))
  const prepCsp = prep ? (await ai.request.get(prep.href)).headers()['content-security-policy'] ?? '' : ''
  check(prep && /script-src 'self' 'wasm-unsafe-eval';/.test(prepCsp), "the AI worker's own CSP allows WebAssembly")
  check(requests.every((u) => u.origin === new URL(url).origin || u.protocol === 'blob:' || u.protocol === 'data:'), 'everything the AI step loads comes from this site; nothing else is contacted')

  // Upscaling is for small images: a 120 px mark.
  const small = await ai.evaluate(async () => {
    const c = new OffscreenCanvas(120, 80)
    const x = c.getContext('2d')
    x.fillStyle = '#fff'
    x.fillRect(0, 0, 120, 80)
    x.fillStyle = '#c33'
    x.beginPath()
    x.arc(40, 40, 25, 0, 7)
    x.fill()
    const u = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const v of u) s += String.fromCharCode(v)
    return btoa(s)
  })
  await ai.locator('input[type=file]').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(small, 'base64') })
  await traced(ai)
  await ai.getByLabel('Remove the background').uncheck()
  await retrace(ai, async () => {
    await ai.getByLabel('Upscale 4× with AI').check()
    await ai.locator('[data-prep-status]').waitFor({ state: 'detached', timeout: 120_000 })
  })
  check((await ai.getByRole('alert').count()) === 0, 'AI upscaling runs on a small image (Real-ESRGAN, in the browser)')
  await shot(ai, '07u-upscaled')

  // Recognising text: a line of type comes back as outlined shapes in a matched font.
  const poster = await ai.evaluate(async () => {
    const c = new OffscreenCanvas(720, 260)
    const x = c.getContext('2d')
    x.fillStyle = '#fff'
    x.fillRect(0, 0, 720, 260)
    x.fillStyle = '#1d3557'
    x.font = 'bold 56px sans-serif'
    x.fillText('Summer sale ends Sunday', 30, 110)
    x.font = '28px serif'
    x.fillText('Quality you can trust, every day', 30, 190)
    const u = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
    let s = ''
    for (const v of u) s += String.fromCharCode(v)
    return btoa(s)
  })
  await ai.getByLabel('Upscale 4× with AI').uncheck()
  await ai.locator('input[type=file]').setInputFiles({ name: 'poster.png', mimeType: 'image/png', buffer: Buffer.from(poster, 'base64') })
  await traced(ai)
  const textRequests = requests.length
  await retrace(ai, async () => {
    await ai.getByLabel(/Recognise text/).check()
    await ai.locator('[data-prep-status]').waitFor({ state: 'detached', timeout: 120_000 })
  })
  check((await ai.getByRole('alert').count()) === 0, 'text recognition runs (Tesseract, in the browser)')
  const found = (await ai.locator('[data-text-found]').textContent()) ?? ''
  check(/^Set as type: .+ \d+ px/.test(found), `and sets the text in a matched font (${found})`)
  check(requests.slice(textRequests).every((u) => u.origin === new URL(url).origin || u.protocol === 'blob:' || u.protocol === 'data:'), 'its engine, model and fonts all come from this site')
  await shot(ai, '07t-text')
  await ai.close()
}

// ---- Installable, and works offline -----------------------------------------
{
  const off = await newPage({ width: 1280, height: 800 })
  await off.goto(url)
  const manifestHref = await off.locator('link[rel="manifest"]').getAttribute('href')
  const manifest = await (await off.request.get(new URL(manifestHref, url).href)).json()
  check(manifest.start_url === '/app/' && manifest.display === 'standalone' && manifest.icons.some((i) => i.sizes === '512x512'), 'the app has a manifest to install from')
  await off.evaluate(() => navigator.serviceWorker.ready)
  await off.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15_000 }).catch(() => {})
  await off.context().setOffline(true)
  await off.reload()
  await off.getByRole('button', { name: 'Try a sample' }).click()
  await traced(off)
  check(true, 'offline after one visit, the app loads from its cache and traces')
  await off.context().setOffline(false)
  await off.close()
}

// ---- Dark theme and mobile ------------------------------------------------
const dark = await newPage({ width: 1440, height: 900 }, 'dark')
await dark.goto(url)
check((await dark.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark preference applied before paint')
await dark.getByRole('button', { name: 'Try a sample' }).click()
await traced(dark)
await shot(dark, '08-dark')
// Start over forgets the session: empty now, and still empty after a reload.
await dark.waitForTimeout(800)
await dark.reload()
await traced(dark)
check((await dark.locator('[data-session]').getAttribute('data-session')) === 'restored', 'the restored note shows after a reload')
await dark.getByRole('button', { name: 'Start over' }).click()
check((await dark.getByRole('alertdialog').innerText()).includes('can’t be undone'), 'Start over asks first')
await dark.getByRole('alertdialog').getByRole('button', { name: 'Start over' }).click()
await dark.getByRole('button', { name: 'Try a sample' }).waitFor()
await dark.reload()
// Long enough for a restore to have landed, if there were anything to restore.
await dark.waitForTimeout(2500)
check((await dark.getByRole('button', { name: 'Try a sample' }).count()) === 1, 'Start over clears the saved session: a reload stays empty')
// A file opened while a restore is still loading wins over the restore.
await dark.getByRole('button', { name: 'Try a sample' }).click()
await traced(dark)
await dark.waitForTimeout(800)
await dark.reload()
await dark.locator('input[type=file]').setInputFiles({ name: 'dropped.png', mimeType: 'image/png', buffer: await dark.screenshot({ clip: { x: 0, y: 0, width: 200, height: 120 } }) })
await traced(dark)
await dark.waitForTimeout(1500)
check((await dark.locator('aside .truncate').first().innerText()) === 'dropped', `an image opened during a restore isn't replaced by it (${await dark.locator('aside .truncate').first().innerText()})`)

const mobile = await newPage({ width: 390, height: 844 })
await mobile.goto(url)
await mobile.getByRole('button', { name: 'Try a sample' }).click()
await traced(mobile)
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check(overflow <= 0, `no horizontal scroll on a phone (${overflow}px)`)
await shot(mobile, '09-mobile')
await mobile.getByRole('tab', { name: /Edit/ }).click()
await shot(mobile, '10-mobile-edit')

// ---- The site: landing page and docs ----------------------------------------
const siteOrigin = process.env.SITE ?? (new URL(url).hostname.endsWith('mattblack.space') ? null : new URL('/', url).href)
if (siteOrigin) {
  console.log(`\n  site ${siteOrigin}\n`)
  const landing = await newPage({ width: 1440, height: 900 })
  const res = await landing.goto(siteOrigin)
  check(res?.ok(), `landing page loads (${res?.status()})`)
  const siteCsp = res?.headers()['content-security-policy'] ?? ''
  check(siteCsp.includes("'sha256-") && !siteCsp.includes('worker-src'), "the landing page gets the site's CSP, not the app's")
  // The hero: the badge as pixels and as shapes, split by a line the range input and a drag both move.
  const pos = () => landing.locator('#compare').evaluate((el) => parseFloat(el.style.getPropertyValue('--pos')))
  await landing.waitForFunction(() => parseFloat(document.getElementById('compare')?.style.getPropertyValue('--pos')) === 50, null, { timeout: 5000 }).catch(() => {})
  check((await pos()) === 50 && (await landing.locator('#compare circle.node').count()) > 50, `the hero sweeps to the middle and marks Inlay's nodes (${await landing.locator('#compare circle.node').count()})`)
  const range = landing.getByRole('slider', { name: 'Pixels or shapes' })
  await range.focus()
  for (let i = 0; i < 10; i++) await landing.keyboard.press('ArrowRight')
  check((await pos()) === 60, `the arrow keys move the line (${await pos()}%)`)
  const box = await landing.locator('#compare').boundingBox()
  await landing.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2)
  await landing.mouse.down()
  await landing.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2)
  await landing.mouse.up()
  check(Math.abs((await pos()) - 25) < 1.5 && Math.abs(Number(await range.inputValue()) - 25) <= 1, `dragging the picture moves the line and the slider with it (${(await pos()).toFixed(1)}%)`)
  const trace = await landing.getByRole('link', { name: 'Trace an image' }).getAttribute('href')
  check((await landing.request.get(new URL(trace, siteOrigin).href)).ok(), `"Trace an image" leads to the app (${trace})`)
  // Every same-site link on the page resolves.
  const hrefs = [...new Set(await landing.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href'))))]
  const broken = []
  for (const h of hrefs) if (!(await landing.request.get(new URL(h, siteOrigin).href)).ok()) broken.push(h)
  check(!broken.length, `the landing page's ${hrefs.length} links resolve${broken.length ? ` (broken: ${broken.join(', ')})` : ''}`)
  await shot(landing, '11-landing')

  const still = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const quiet = await still.newPage()
  await quiet.goto(siteOrigin)
  await quiet.waitForTimeout(300)
  check((await quiet.locator('#compare').evaluate((el) => el.style.getPropertyValue('--pos'))) === '50%', 'with reduced motion the hero starts still, at the middle')
  await still.close()

  // The app's old address (mattblack.space/tools/img-to-svg/ before inlaytrace.com) keeps working.
  const old = await landing.request.get(new URL('tools/img-to-svg/some/deep/link', siteOrigin).href, { maxRedirects: 0 })
  check(old.status() === 308 && old.headers().location === 'https://inlaytrace.com/app/some/deep/link', `the old app address redirects to inlaytrace.com/app/ (${old.status()} → ${old.headers().location})`)
  const privacy = await landing.request.get(new URL('privacy/', siteOrigin).href)
  check(privacy.ok() && (await privacy.text()).includes('your images never leave your device'), 'the privacy page loads')
  // Paddle's review: pricing, terms (seller and Merchant of Record), refunds (14–90 days) and privacy, all linked from every page.
  for (const [path, must] of [['pricing/', 'Credit packs'], ['terms/', 'Paddle.com is the Merchant of Record for all our orders'], ['refunds/', 'within 30 days'], ['privacy/', 'Paddle']]) {
    const r = await landing.request.get(new URL(path, siteOrigin).href)
    check(r.ok() && (await r.text()).includes(must), `/${path} loads and says “${must}”`)
  }
  const footer = await landing.locator('footer a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  check(['/pricing/', '/terms/', '/refunds/', '/privacy/'].every((h) => footer.includes(h)), 'the footer links to pricing, terms, refunds and privacy')
  const guessed = await landing.request.get(new URL('docs/', siteOrigin).href)
  check(guessed.ok() && guessed.url().endsWith('/docs/overview/'), `/docs/ leads to the docs (${guessed.url()})`)
  const docs = await newPage({ width: 1440, height: 900 })
  const docsRes = await docs.goto(new URL('docs/package/getting-started/', siteOrigin).href)
  check(docsRes?.ok() && (await docs.locator('h1').first().innerText()) === 'Getting started', 'a docs page loads')
  // Search is Pagefind: WebAssembly plus a hashed inline script, both of which the CSP must allow.
  await docs.getByRole('button', { name: 'Search' }).click()
  await docs.locator('dialog[open] input').fill('palette')
  const found = await docs.locator('dialog[open] .pagefind-ui__result-link').first().waitFor({ timeout: 15_000 }).then(() => true, () => false)
  check(found, 'docs search finds results under the CSP')
  await shot(docs, '12-docs-search')
  await docs.keyboard.press('Escape')

  const docsDark = await newPage({ width: 1440, height: 900 }, 'dark')
  await docsDark.goto(new URL('docs/overview/', siteOrigin).href)
  check((await docsDark.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'docs follow a dark preference')
  const landingDark = await newPage({ width: 1440, height: 900 }, 'dark')
  await landingDark.goto(siteOrigin)
  const bg = await landingDark.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
  check(bg !== 'rgb(245, 246, 242)', `the landing page follows a dark preference (${bg})`)

  for (const path of ['', 'docs/package/getting-started/']) {
    const phone = await newPage({ width: 390, height: 844 })
    await phone.goto(new URL(path, siteOrigin).href)
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(over <= 0, `no horizontal scroll on a phone at /${path} (${over}px)`)
    if (!path) await shot(phone, '13-landing-mobile')
  }
}

// ---- HD trace (beta) ---------------------------------------------------------------
// A 2600 × 1800 image: bigger than the app traces, so HD is offered. The server
// is a stand-in (server/hd.test.ts tests the real one); this checks the app's
// side: nothing is sent until the cost is confirmed, then the parts flow.
{
  console.log('\n  hd trace\n')
  const W = 2600
  const H = 1800
  const data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) data.set(Math.hypot(x - 1300, y - 900) < 600 ? [30, 60, 140, 255] : [250, 248, 240, 255], (y * W + x) * 4)
  const big = Buffer.from(encodePng({ width: W, height: H, data, channels: 4, depth: 8 }))
  const hd = await newPage({ width: 1440, height: 900 })
  const apiCalls = []
  let uploaded = 0
  await hd.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/', '')
    apiCalls.push(path)
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === 'account') return json({ signedIn: true, email: 'ada@example.com', balance: 10, ledger: [] })
    if (path === 'account/summary') return json({ signedIn: true, email: 'ada@example.com', balance: uploaded ? 8 : 10 })
    if (path === 'hd/start') return json({ run: '00000000-0000-0000-0000-000000000001', credits: 2, partBytes: 4194304 })
    if (path === 'hd/upload') return (uploaded++, route.fulfill({ status: 204 }))
    if (path === 'hd/run') return json({ parts: 1, contentType: 'image/svg+xml', bytes: 120, credits: 2 })
    if (path === 'hd/result') return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><path fill="#1e3c8c" d="M700 900a600 600 0 1 0 1200 0a600 600 0 1 0-1200 0Z"/></svg>` })
    return json({ error: 'Not found.' }, 404)
  })
  await hd.goto(url)
  await hd.locator('input[type=file]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: big })
  await traced(hd)
  const summary = hd.locator('[data-hd="trace"] summary')
  check((await summary.innerText()).includes('2,600 × 1,800, 2 credits'), `a big image offers HD with its size and cost (${(await summary.innerText()).replace(/\s+/g, ' ')})`)
  // The header asks who's signed in; nothing else, and nothing about the image, goes out.
  check(apiCalls.every((p) => p === 'account/summary'), `nothing is sent to the server just for opening a big image (${apiCalls.join(', ') || 'no calls'})`)
  check((await hd.locator('header [data-balance]').innerText()) === '10 credits', 'the header shows the balance when signed in')
  await summary.click()
  await hd.getByRole('button', { name: 'Trace in HD for 2 credits' }).click()
  await hd.getByRole('button', { name: 'Start HD trace' }).click()
  await hd.getByRole('button', { name: 'Download HD' }).waitFor({ timeout: 60_000 })
  check(uploaded >= 1 && apiCalls.includes('hd/run') && apiCalls.includes('hd/result'), `confirming uploads the image in parts, runs, and fetches the result (${uploaded} part(s))`)
  const after = await hd.locator('header [data-balance]').filter({ hasText: '8 credits' }).waitFor({ timeout: 5000 }).then(() => true, () => false)
  check(after, 'the header balance updates after an HD run')
  await shot(hd, '19-hd-done')
  const small = await newPage({ width: 1440, height: 900 })
  await small.goto(url)
  await small.getByRole('button', { name: 'Try a sample' }).click()
  await traced(small)
  const offers = await small.locator('[data-hd]').evaluateAll((els) => els.map((e) => e.getAttribute('data-hd')))
  const dims = await small.evaluate(() => document.querySelector('aside')?.innerText.match(/(\d+) × (\d+)/)?.slice(1).map(Number))
  const smallEnough = dims && dims[0] * dims[1] <= 500_000
  check(!offers.includes('trace') && (smallEnough ? offers.includes('upscale') : offers.length === 0), `a small image offers no HD trace${smallEnough ? ', and offers HD upscale (2 credits)' : ''} (${offers.join(', ') || 'none'})`)
}

// ---- The account page (sign-in and credits for HD) ----------------------------
// The page's own behaviour, against a stand-in /api (server/api.ts has its own
// tests against a fake Supabase), plus one real request to the API.
{
  const accountUrl = new URL('account/', url).href
  console.log(`\n  account ${accountUrl}\n`)
  const real = await (await newPage({ width: 1280, height: 800 })).request.get(new URL('/api/account', url).href)
  const realBody = await real.json().catch(() => null)
  check(
    (real.status() === 200 && realBody?.signedIn === false) || (real.status() === 503 && /set up/.test(realBody?.error ?? '')),
    `the API answers /api/account without a session (${real.status()}${real.status() === 503 ? ', no Supabase settings here' : ''})`,
  )

  const ledger = [
    { id: 3, delta: -2, reason: 'use', details: { what: 'background removal' }, created_at: '2026-10-18T15:00:00Z' },
    { id: 2, delta: 2, reason: 'refund_use', details: {}, created_at: '2026-10-18T14:00:00Z' },
    { id: 1, delta: 60, reason: 'purchase', details: {}, created_at: '2026-10-17T12:00:00Z' },
  ]
  /** A stand-in /api: signed out until a code is exchanged. */
  async function fakeApi(page) {
    const seen = []
    let signedIn = false
    await page.route('**/api/**', async (route) => {
      const req = route.request()
      const path = new URL(req.url()).pathname.replace('/api/', '')
      seen.push({ path, method: req.method(), type: req.headers()['content-type'], body: req.postDataJSON?.() ?? null })
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      if (path === 'account') return json(200, signedIn ? { signedIn: true, email: 'ada@example.com', balance: 60, ledger } : { signedIn: false })
      if (path === 'auth/start') return route.fulfill({ status: 204 })
      if (path === 'auth/exchange') return req.postDataJSON().code === 'good' ? ((signedIn = true), json(200, { email: 'ada@example.com' })) : json(400, { error: 'That sign-in link has expired or was already used. Ask for a new one.', code: 'expired' })
      if (path === 'auth/signout' || path === 'account/delete') return (signedIn = false), route.fulfill({ status: 204 })
      return json(404, { error: 'Not found.' })
    })
    return seen
  }

  const acct = await newPage({ width: 1280, height: 800 })
  const seen = await fakeApi(acct)
  const res = await acct.goto(accountUrl)
  const acctCsp = res?.headers()['content-security-policy'] ?? ''
  check(res?.ok() && /connect-src 'self'/.test(acctCsp) && /worker-src/.test(acctCsp), "the account page loads under the app's CSP (connect-src 'self')")
  await acct.getByLabel('Email').waitFor()
  check(await acct.getByText('You only need an account to buy credits for HD mode').isVisible(), 'signed out: it says an account is only for buying HD credits')
  const legal = await acct.getByRole('navigation', { name: 'Legal' }).locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  check(['/terms/', '/privacy/', '/refunds/'].every((h) => legal.includes(h)), `the account page links the terms, privacy notice and refund policy (${legal.join(', ')})`)
  await acct.getByLabel('Email').fill('ada@example.com')
  await acct.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await acct.getByText('Check your email.').waitFor()
  const start = seen.find((s) => s.path === 'auth/start')
  check(start?.method === 'POST' && start.type === 'application/json' && start.body.email === 'ada@example.com', 'asking for a link posts the email as JSON to /api/auth/start')
  await shot(acct, '14-account-sent')

  await acct.goto(`${accountUrl}?code=good`)
  await acct.getByText('Signed in as').waitFor()
  check(!acct.url().includes('code='), 'the sign-in code is taken out of the address bar')
  check((await acct.locator('[data-balance]').innerText()) === '60', 'signed in: the balance shows')
  const rows = await acct.locator('tbody tr').allInnerTexts()
  check(rows.length === 3 && rows[0].includes('HD: background removal') && rows[0].includes('−2') && rows[2].includes('Bought 60 credits') && rows[2].includes('+60'), 'the history lists uses, refunds and purchases with signed amounts')
  await shot(acct, '15-account-signed-in')
  await acct.getByRole('button', { name: 'Delete account…' }).click()
  await acct.getByRole('button', { name: 'Delete my account' }).click()
  await acct.getByText('Your account is deleted.').waitFor()
  check(seen.some((s) => s.path === 'account/delete' && s.body?.confirm === true), 'deleting asks again, then posts a confirmation')

  const expired = await newPage({ width: 1280, height: 800 })
  await fakeApi(expired)
  // A stand-in 400 is a resource error in the console; that one is expected here.
  const before = failures.length
  await expired.goto(`${accountUrl}?code=used`)
  await expired.getByRole('alert').waitFor()
  check((await expired.getByRole('alert').innerText()).includes('expired'), 'an expired link says so and offers the form again')
  failures.splice(before, failures.length - before, ...failures.slice(before).filter((f) => !/status of 400/.test(f)))

  const phone = await newPage({ width: 390, height: 844 }, 'dark')
  await fakeApi(phone)
  await phone.goto(`${accountUrl}?code=good`)
  await phone.getByText('Signed in as').waitFor()
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(over <= 0 && (await phone.evaluate(() => document.documentElement.dataset.theme)) === 'dark', `the account page fits a phone and follows dark mode (${over}px)`)
  await shot(phone, '16-account-phone-dark')
}

// ---- The buy page (Paddle checkout) -------------------------------------------
// Paddle.js is replaced by a stand-in that records what the page asks of it, so
// this runs offline; the stand-in is served from cdn.paddle.com, so the buy
// page's CSP is what lets it in.
{
  const buyUrl = new URL('buy/', url).href
  console.log(`\n  buy ${buyUrl}\n`)
  const packs = [
    { priceId: 'pri_20', credits: 20, price: '$5' },
    { priceId: 'pri_60', credits: 60, price: '$12' },
    { priceId: 'pri_200', credits: 200, price: '$30' },
  ]
  const page = await newPage({ width: 1280, height: 800 })
  let balance = 60
  const seen = []
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname.replace('/api/', '')
    seen.push({ path, body: req.postDataJSON?.() ?? null })
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (path === 'account') return json({ signedIn: true, email: 'ada@example.com', balance, ledger: [] })
    if (path === 'checkout/config') return json({ environment: 'sandbox', token: 'test_token', packs })
    if (path === 'checkout') return json({ transactionId: 'txn_test' })
    return route.fulfill({ status: 404 })
  })
  await page.route('https://cdn.paddle.com/paddle/v2/paddle.js', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.__paddle = { env: null, init: null, opened: [], closed: 0 };
        window.Paddle = {
          Environment: { set: (e) => { window.__paddle.env = e } },
          Initialize: (o) => { window.__paddle.init = { token: o.token }; window.__paddle.cb = o.eventCallback },
          Checkout: { open: (o) => window.__paddle.opened.push(o), close: () => { window.__paddle.closed++ } },
        }`,
    }),
  )
  const res = await page.goto(buyUrl)
  const csp = res?.headers()['content-security-policy'] ?? ''
  check(res?.ok() && csp.includes('https://cdn.paddle.com') && csp.includes('frame-src https://buy.paddle.com https://sandbox-buy.paddle.com'), 'the buy page has its own CSP, allowing Paddle')
  const appCsp = (await page.request.get(url)).headers()['content-security-policy'] ?? ''
  check(!appCsp.includes('paddle'), "the app's CSP doesn't mention Paddle")
  await page.getByRole('button', { name: 'Buy 60' }).waitFor()
  check(await page.getByText('Test mode: no real payment is taken.').isVisible(), 'sandbox: the page says no real payment is taken')
  check((await page.getByRole('listitem').allInnerTexts()).some((t) => t.includes('$0.20 a credit')), 'each pack shows its price per credit')
  check((await page.evaluate(() => !!window.Paddle)) === false, "Paddle.js isn't loaded until someone buys")
  await shot(page, '17-buy')
  await page.getByRole('button', { name: 'Buy 60' }).click()
  await page.waitForFunction(() => window.__paddle?.opened.length === 1)
  const p = await page.evaluate(() => ({ env: window.__paddle.env, init: window.__paddle.init, opened: window.__paddle.opened[0] }))
  check(p.env === 'sandbox' && p.init.token === 'test_token', 'Paddle.js starts in sandbox with the client token')
  check(p.opened.transactionId === 'txn_test' && seen.some((s) => s.path === 'checkout' && s.body?.priceId === 'pri_60'), "the checkout opens on the server's transaction for the chosen pack")
  balance = 120
  await page.evaluate(() => window.__paddle.cb({ name: 'checkout.completed', data: {} }))
  await page.getByText('Added 60 credits.').waitFor({ timeout: 10_000 })
  check((await page.getByRole('status').innerText()).includes('120'), 'after paying, the page waits for the credits and shows the new balance')
  await page.waitForFunction(() => window.__paddle.closed > 0, null, { timeout: 5000 }).catch(() => {})
  check((await page.evaluate(() => window.__paddle.closed)) > 0, "Paddle's overlay is closed after payment, so the page underneath shows")
  check((await page.getByRole('link', { name: 'Back to the app' }).last().getAttribute('href')) === '/app/', 'after paying, there is a way back to the app')
  await shot(page, '18-buy-added')

  const out = await newPage({ width: 390, height: 844 })
  await out.route('**/api/account', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"signedIn":false}' }))
  await out.goto(buyUrl)
  await out.getByRole('link', { name: 'Sign in' }).waitFor()
  check((await out.getByRole('link', { name: 'Sign in' }).getAttribute('href')) === '/app/account/', 'signed out, the buy page sends you to sign in')
  const slash = await out.request.get(new URL('/app/buy', url).href, { maxRedirects: 0 })
  check(slash.status() === 308 && slash.headers().location === '/app/buy/', `/app/buy redirects to /app/buy/ (${slash.status()})`)
}

await browser.close()

const unexpected = failures.filter((f) => f.startsWith('console') || f.startsWith('pageerror'))
for (const f of unexpected) console.log(`  FAIL  ${f}`)
console.log(failures.length ? `\n  ${failures.length} problem(s).\n` : '\n  All checks passed.\n')
// On GitHub Actions each problem is also an annotation, readable on the PR and from the API without the log.
if (process.env.GITHUB_ACTIONS) for (const f of failures) console.log(`::error title=verify::${f.replace(/\r?\n/g, ' ').slice(0, 900)}`)
process.exit(failures.length ? 1 : 0)
