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
const pathCount = await page.locator('.vector path').count()
check(pathCount > 3, `sample traced into ${pathCount} paths`)
const inkCount = await page.locator('aside li').count()
check(inkCount >= 5 && inkCount <= 8, `logo preset found ${inkCount} inks (5 in the art, cap 8)`)
await shot(page, '02-split')

for (const mode of ['Difference', 'Outlines']) {
  await page.getByRole('radio', { name: mode }).click()
  await shot(page, `03-${mode.toLowerCase()}`)
}
await page.getByRole('radio', { name: 'Split' }).click()

// Preset change re-traces.
await retrace(page, () => page.getByRole('radio', { name: /Line art/ }).click())
check((await page.locator('aside li').count()) === 1, 'line art traces to a single ink')
await retrace(page, () => page.getByRole('radio', { name: /^Logo/ }).click())

// Recolour an ink and hide another; both must reach the preview.
const firstInk = page.locator('aside li').first()
await firstInk.locator('input[type=color]').fill('#123456')
check((await page.locator('.vector path[fill="#123456"]').count()) > 0, 'recolouring an ink updates the preview')
await page.locator('aside li').nth(1).getByRole('button', { name: /Hide ink/ }).click()
await page.getByText('Restore all').waitFor()
await shot(page, '04-inks-edited')

// Export.
await page.getByText(/Traced in [\d,]+ ms$/).waitFor() // optimised numbers are in
const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download SVG' }).click()])
const svg = readFileSync(await download.path(), 'utf8')
check(download.suggestedFilename() === 'sample-badge.svg', `download named ${download.suggestedFilename()}`)
check(/<svg[^>]*viewBox="0 0 640 640"/.test(svg), 'exported SVG has a viewBox')
check(svg.includes('#123456'), 'export carries the recolour')
const sizeShown = await page.locator('dd').nth(2).innerText()
console.log(`         exported ${svg.length.toLocaleString()} bytes, panel shows ${sizeShown}`)

const [zip] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Layers (.zip)' }).click()])
check(zip.suggestedFilename() === 'sample-badge-layers.zip', 'layers download is a zip')

// Keyboard: the split handle is a real slider.
const handle = page.getByRole('slider', { name: /Comparison split/ })
await handle.focus()
await page.keyboard.press('End')
check((await handle.getAttribute('aria-valuenow')) === '100', 'split handle responds to the keyboard')

// ---- Optional real-world fixture ------------------------------------------
if (process.env.FIXTURE) {
  await retrace(page, () => page.locator('input[type=file]').setInputFiles(process.env.FIXTURE))
  await retrace(page, () => page.getByRole('radio', { name: /Illustration/ }).click())
  const ms = await page.getByText(/Traced in/).innerText()
  check(true, `fixture traced (${ms.replace(/.*Traced in /, '')})`)
  await shot(page, '05-fixture')
}

// ---- Dark theme and mobile ------------------------------------------------
const dark = await newPage({ width: 1440, height: 900 }, 'dark')
await dark.goto(url)
check((await dark.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark preference applied before paint')
await dark.getByRole('button', { name: 'Try a sample' }).click()
await traced(dark)
await shot(dark, '06-dark')

const mobile = await newPage({ width: 390, height: 844 })
await mobile.goto(url)
await mobile.getByRole('button', { name: 'Try a sample' }).click()
await traced(mobile)
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
check(overflow <= 0, `no horizontal scroll on a phone (${overflow}px)`)
await shot(mobile, '07-mobile')

await browser.close()

const unexpected = failures.filter((f) => f.startsWith('console') || f.startsWith('pageerror'))
for (const f of unexpected) console.log(`  FAIL  ${f}`)
console.log(failures.length ? `\n  ${failures.length} problem(s).\n` : '\n  All checks passed.\n')
process.exit(failures.length ? 1 : 0)
