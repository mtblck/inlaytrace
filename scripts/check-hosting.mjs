/**
 * Guards the hosting config the tool depends on. Runs as part of the build.
 *
 * Two failure modes are invisible until production:
 *  - The CSP losing 'wasm-unsafe-eval' or the worker allowance. The tracer is
 *    WebAssembly running in a Web Worker; without them the page loads, the
 *    drop zone works, and nothing ever traces.
 *  - cleanUrls / trailingSlash / routes. In mb-portfolio, those keys made
 *    Vercel silently stop applying the rewrite while headers still worked.
 */
import { readFileSync } from 'node:fs'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const BASE = '/tools/img-to-svg'
const problems = []

if (config.outputDirectory !== 'dist') problems.push('outputDirectory must be "dist" (the build writes to dist/tools/img-to-svg).')

if (!(config.rewrites ?? []).some((r) => r.source === `${BASE}/(.*)` && r.destination === `${BASE}/index.html`))
  problems.push(`Missing the SPA fallback ${BASE}/(.*) → ${BASE}/index.html.`)

for (const key of ['cleanUrls', 'trailingSlash', 'routes'])
  if (key in config) problems.push(`"${key}" is set; it has been seen to stop rewrites applying.`)

const csp = (config.headers ?? [])
  .flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy')?.value
if (!csp) problems.push('No Content-Security-Policy header.')
else {
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? ''
  if (!scriptSrc.includes("'wasm-unsafe-eval'")) problems.push("CSP script-src lacks 'wasm-unsafe-eval'; the WebAssembly tracer cannot compile.")
  if (!/worker-src[^;]*'self'/.test(csp)) problems.push("CSP worker-src must allow 'self' for the tracing worker.")
}

if (problems.length) {
  console.error('\n  vercel.json\n')
  for (const p of problems) console.error(`    ${p}\n`)
  process.exit(1)
}
console.log('  Hosting config OK.  Fallback, CSP wasm + worker allowances present.')
