/**
 * Guards the hosting config the site and the app depend on. Runs twice in the
 * build: before (the config) and after, with --dist (the built pages).
 *
 * Failure modes that are invisible until production:
 *  - The app's CSP losing the worker allowance: tracing runs in a Web Worker,
 *    and without it the page loads, the drop zone works, and nothing traces.
 *  - WebAssembly reaching further than it needs to. Only the AI worker
 *    (assets/prep-*.js, background removal and upscaling) compiles any, so
 *    only its own response carries 'wasm-unsafe-eval'; the page's CSP, which
 *    governs everything else the app runs, doesn't allow it.
 *  - The site's CSP not allowing an inline script the docs framework (Starlight)
 *    writes: theme, search and sidebar quietly stop working. It's
 *    script-src 'self' plus each script's sha256; --dist hashes every inline
 *    script in the built pages and fails on any that isn't listed, so a
 *    Starlight update that changes one fails the build instead of the docs.
 *  - Paddle's checkout reaching further than the buy page: only /app/buy/ may
 *    load cdn.paddle.com and frame Paddle's checkout; the app and site never.
 *  - The two CSPs overlapping: Vercel applies every matching header block, so
 *    the site's must exclude the app's path.
 *  - The API (accounts for HD credits) not reaching its function: /api/* must
 *    rewrite to api/server.ts before the app's fallback, and the daily cron that
 *    keeps the free Supabase project awake must point at it.
 *  - The app reaching another origin: it talks only to its own /api, so its CSP
 *    keeps connect-src 'self' and no Supabase or Paddle script loads in it.
 *  - cleanUrls / trailingSlash / routes. In mb-portfolio, those keys made
 *    Vercel silently stop applying the rewrite while headers still worked.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const APP = '/app'
/** The app's address before inlaytrace.com; links to it are out there, so it must keep redirecting. */
const OLD = '/tools/img-to-svg'
const SITE_SOURCE = `/((?!${APP.slice(1)}/).*)`
/** The app's CSP covers everything under it except the AI worker and the buy page, which get their own. */
const APP_SOURCE = `${APP}/((?!assets/prep-|buy/).*)`
const PREP_SOURCE = `${APP}/assets/prep-(.*)`
/** The buy page: the only page that may load Paddle's checkout. */
const BUY_SOURCE = `${APP}/buy/(.*)`
const PADDLE_SCRIPT = 'https://cdn.paddle.com'
const PADDLE_FRAMES = ['https://buy.paddle.com', 'https://sandbox-buy.paddle.com']
const problems = []

if (config.outputDirectory !== 'dist') problems.push('outputDirectory must be "dist" (the site and the app both build into it).')
if (!(config.rewrites ?? []).some((r) => r.source === `${APP}/(.*)` && r.destination === `${APP}/index.html`))
  problems.push(`Missing the app's SPA fallback ${APP}/(.*) → ${APP}/index.html.`)
for (const key of ['cleanUrls', 'trailingSlash', 'routes']) if (key in config) problems.push(`"${key}" is set; it has been seen to stop rewrites applying.`)
if ((config.redirects ?? []).some((r) => r.source === '/')) problems.push('"/" redirects somewhere; it is the landing page.')
const redirectTo = (source) => (config.redirects ?? []).find((r) => r.source === source && r.permanent)?.destination
if (redirectTo(`${OLD}/(.*)`) !== `https://inlaytrace.com${APP}/$1` || redirectTo(OLD) !== `https://inlaytrace.com${APP}/`)
  problems.push(`The old app address must redirect permanently to the new one, with an absolute URL (the portfolio proxies it): ${OLD}(/…) → https://inlaytrace.com${APP}/(…).`)

// The API: one function behind /api/*, rewritten before the app's fallback, and a daily keep-alive.
const rewrites = config.rewrites ?? []
const apiAt = rewrites.findIndex((r) => r.source === '/api/(.*)' && r.destination === '/api/server?__route=$1')
if (apiAt < 0) problems.push('Missing the API rewrite /api/(.*) → /api/server?__route=$1.')
else if (apiAt > rewrites.findIndex((r) => r.source === `${APP}/(.*)`)) problems.push("The API rewrite must come before the app's fallback.")
if (!config.functions?.['api/server.ts']) problems.push('vercel.json functions must configure api/server.ts (the API).')
// HD jobs run in their own function, with time and memory for full-size images.
const hdAt = rewrites.findIndex((r) => r.source === '/api/hd/(.*)' && r.destination === '/api/hd?__route=hd/$1')
if (hdAt < 0 || hdAt > apiAt) problems.push('Missing the HD rewrite /api/hd/(.*) → /api/hd?__route=hd/$1, before the general /api/(.*) one.')
if (!(config.functions?.['api/hd.ts']?.maxDuration >= 120)) problems.push('vercel.json functions must give api/hd.ts (HD jobs) a maxDuration of at least 120 s.')
if (!(config.crons ?? []).some((c) => c.path === '/api/keepalive')) problems.push('Missing the daily cron to /api/keepalive; without it the free Supabase project pauses after a week.')

const cspOf = (source) => (config.headers ?? []).find((b) => b.source === source)?.headers.find((h) => h.key === 'Content-Security-Policy')?.value
const directive = (csp, name) => (csp ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''
const blocksWithCsp = (config.headers ?? []).filter((b) => b.headers.some((h) => h.key === 'Content-Security-Policy')).map((b) => b.source)
if (blocksWithCsp.sort().join() !== [SITE_SOURCE, APP_SOURCE, PREP_SOURCE, BUY_SOURCE].sort().join())
  problems.push(`CSP must be set by exactly four blocks, "${SITE_SOURCE}" (site), "${APP_SOURCE}" (app), "${PREP_SOURCE}" (the AI worker) and "${BUY_SOURCE}" (the buy page), so they never stack. Found: ${blocksWithCsp.join(', ')}`)

const appCsp = cspOf(APP_SOURCE)
// Tracing is plain JavaScript; only the AI worker compiles WebAssembly, under its own CSP.
if (directive(appCsp, 'script-src').includes("'wasm-unsafe-eval'")) problems.push("The app's CSP allows 'wasm-unsafe-eval'; only the AI worker (its own block) should.")
if (!/worker-src[^;]*'self'/.test(appCsp ?? '')) problems.push("The app's CSP worker-src must allow 'self' for the tracing worker.")
// The app only talks to itself; Supabase and Paddle are reached through /api or a page of their own.
if (directive(appCsp, 'connect-src') !== "connect-src 'self'") problems.push("The app's CSP connect-src must stay 'self': it talks only to its own /api.")
// Paddle reaches only the buy page, and only Paddle's own hosts.
for (const [name, csp] of [['app', appCsp], ['site', cspOf(SITE_SOURCE)]]) if ((csp ?? '').includes('paddle.com')) problems.push(`The ${name}'s CSP mentions paddle.com; only the buy page (${BUY_SOURCE}) may load Paddle.`)
const buyCsp = cspOf(BUY_SOURCE)
if (directive(buyCsp, 'script-src') !== `script-src 'self' ${PADDLE_SCRIPT}`) problems.push(`The buy page's script-src must be exactly 'self' ${PADDLE_SCRIPT} (no inline scripts, no WebAssembly).`)
if (directive(buyCsp, 'frame-src') !== `frame-src ${PADDLE_FRAMES.join(' ')}`) problems.push(`The buy page's frame-src must be exactly Paddle's checkout (${PADDLE_FRAMES.join(' ')}).`)
if (!/frame-ancestors 'none'/.test(buyCsp ?? '')) problems.push("The buy page's CSP must keep frame-ancestors 'none'.")
for (const page of ['account', 'buy']) if (redirectTo(`${APP}/${page}`) !== `${APP}/${page}/`) problems.push(`${APP}/${page} must redirect to ${APP}/${page}/ (without the slash it would fall under the app's CSP, or miss its page).`)
const prepCsp = cspOf(PREP_SOURCE)
// The worker's CSP is the app's plus WebAssembly, nothing else.
if (prepCsp !== appCsp?.replace("script-src 'self';", "script-src 'self' 'wasm-unsafe-eval';"))
  problems.push(`The AI worker's CSP (${PREP_SOURCE}) must be the app's with 'wasm-unsafe-eval' added to script-src, and nothing else.`)
const siteCsp = cspOf(SITE_SOURCE)
const siteScripts = directive(siteCsp, 'script-src')
if (siteScripts.includes("'unsafe-inline'")) problems.push("The site's CSP allows 'unsafe-inline' scripts; list each inline script's hash instead.")
if (!siteScripts.includes("'wasm-unsafe-eval'")) problems.push("The site's CSP script-src lacks 'wasm-unsafe-eval'; docs search (Pagefind) is WebAssembly.")

if (process.argv.includes('--dist')) {
  const dist = new URL('../dist/', import.meta.url).pathname
  if (!existsSync(join(dist, 'index.html'))) problems.push('dist/index.html is missing: the landing page did not build.')
  if (!existsSync(join(dist, APP.slice(1), 'index.html'))) problems.push(`dist${APP}/index.html is missing: the app did not build.`)
  if (!existsSync(join(dist, APP.slice(1), 'account', 'index.html'))) problems.push(`dist${APP}/account/index.html is missing: the account page did not build (sign-in links land there).`)
  if (!existsSync(join(dist, APP.slice(1), 'buy', 'index.html'))) problems.push(`dist${APP}/buy/index.html is missing: the buy page did not build.`)
  // The AI worker's CSP is matched by file name: if the chunk is renamed, it would load under the app's and fail.
  const assets = existsSync(join(dist, APP.slice(1), 'assets')) ? readdirSync(join(dist, APP.slice(1), 'assets')) : []
  if (!assets.some((f) => /^prep-.*\.js$/.test(f))) problems.push(`No dist${APP}/assets/prep-*.js: the AI worker chunk was renamed, so ${PREP_SOURCE}'s CSP no longer reaches it.`)
  // The service worker caches the app shell; it must exist and leave the AI models to first use.
  const sw = join(dist, APP.slice(1), 'sw.js')
  if (!existsSync(sw)) problems.push(`dist${APP}/sw.js is missing: the app won't work offline.`)
  else if (/\.(onnx|wasm)"/.test(readFileSync(sw, 'utf8'))) problems.push(`dist${APP}/sw.js precaches AI models or WebAssembly; those are cached on first use.`)
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : f.endsWith('.html') ? [join(d, f)] : []))
  const missing = new Map()
  for (const f of walk(dist)) {
    const inApp = f.includes(`${APP}/`)
    for (const m of readFileSync(f, 'utf8').matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (/type="application\/(ld\+)?json"/.test(m[1])) continue
      const hash = `'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`
      if (inApp) problems.push(`${f.slice(dist.length)} has an inline script; the app's CSP allows none.`)
      else if (!siteScripts.includes(hash)) missing.set(hash, f.slice(dist.length))
    }
  }
  for (const [hash, f] of missing) problems.push(`Inline script in ${f} isn't allowed by the site's CSP. Add ${hash} to script-src in vercel.json (after checking what it is).`)
}

if (problems.length) {
  console.error('\n  vercel.json\n')
  for (const p of problems) console.error(`    ${p}\n`)
  process.exit(1)
}
console.log(`  Hosting config OK${process.argv.includes('--dist') ? ', and every inline script in the built site is allowed by hash' : ''}.`)
