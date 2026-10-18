/**
 * Guards the hosting config the site and the app depend on. Runs twice in the
 * build: before (the config) and after, with --dist (the built pages).
 *
 * Failure modes that are invisible until production:
 *  - The app's CSP losing the worker allowance: tracing runs in a Web Worker,
 *    and without it the page loads, the drop zone works, and nothing traces.
 *    (It no longer allows 'wasm-unsafe-eval': the app runs no WebAssembly.)
 *  - The site's CSP not allowing an inline script the docs framework (Starlight)
 *    writes: theme, search and sidebar quietly stop working. It's
 *    script-src 'self' plus each script's sha256; --dist hashes every inline
 *    script in the built pages and fails on any that isn't listed, so a
 *    Starlight update that changes one fails the build instead of the docs.
 *  - The two CSPs overlapping: Vercel applies every matching header block, so
 *    the site's must exclude the app's path.
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
const problems = []

if (config.outputDirectory !== 'dist') problems.push('outputDirectory must be "dist" (the site and the app both build into it).')
if (!(config.rewrites ?? []).some((r) => r.source === `${APP}/(.*)` && r.destination === `${APP}/index.html`))
  problems.push(`Missing the app's SPA fallback ${APP}/(.*) → ${APP}/index.html.`)
for (const key of ['cleanUrls', 'trailingSlash', 'routes']) if (key in config) problems.push(`"${key}" is set; it has been seen to stop rewrites applying.`)
if ((config.redirects ?? []).some((r) => r.source === '/')) problems.push('"/" redirects somewhere; it is the landing page.')
const redirectTo = (source) => (config.redirects ?? []).find((r) => r.source === source && r.permanent)?.destination
if (redirectTo(`${OLD}/(.*)`) !== `https://inlaytrace.com${APP}/$1` || redirectTo(OLD) !== `https://inlaytrace.com${APP}/`)
  problems.push(`The old app address must redirect permanently to the new one, with an absolute URL (the portfolio proxies it): ${OLD}(/…) → https://inlaytrace.com${APP}/(…).`)

const cspOf = (source) => (config.headers ?? []).find((b) => b.source === source)?.headers.find((h) => h.key === 'Content-Security-Policy')?.value
const directive = (csp, name) => (csp ?? '').split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? ''
const blocksWithCsp = (config.headers ?? []).filter((b) => b.headers.some((h) => h.key === 'Content-Security-Policy')).map((b) => b.source)
if (blocksWithCsp.sort().join() !== [SITE_SOURCE, `${APP}/(.*)`].sort().join())
  problems.push(`CSP must be set by exactly two blocks, "${SITE_SOURCE}" (site) and "${APP}/(.*)" (app), so they never stack. Found: ${blocksWithCsp.join(', ')}`)

const appCsp = cspOf(`${APP}/(.*)`)
// The app has run no WebAssembly since Poster moved to Inlay (#53), so it doesn't get to compile any.
if (directive(appCsp, 'script-src').includes("'wasm-unsafe-eval'")) problems.push("The app's CSP allows 'wasm-unsafe-eval', but the app runs no WebAssembly; take it out.")
if (!/worker-src[^;]*'self'/.test(appCsp ?? '')) problems.push("The app's CSP worker-src must allow 'self' for the tracing worker.")
const siteCsp = cspOf(SITE_SOURCE)
const siteScripts = directive(siteCsp, 'script-src')
if (siteScripts.includes("'unsafe-inline'")) problems.push("The site's CSP allows 'unsafe-inline' scripts; list each inline script's hash instead.")
if (!siteScripts.includes("'wasm-unsafe-eval'")) problems.push("The site's CSP script-src lacks 'wasm-unsafe-eval'; docs search (Pagefind) is WebAssembly.")

if (process.argv.includes('--dist')) {
  const dist = new URL('../dist/', import.meta.url).pathname
  if (!existsSync(join(dist, 'index.html'))) problems.push('dist/index.html is missing: the landing page did not build.')
  if (!existsSync(join(dist, APP.slice(1), 'index.html'))) problems.push(`dist${APP}/index.html is missing: the app did not build.`)
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
