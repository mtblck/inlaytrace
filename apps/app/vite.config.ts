import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import type { Plugin } from 'vite'
import { fileURLToPath } from 'node:url'
import { serveApi } from '../../server/node'

// `vite preview` serves the production headers from vercel.json, so a CSP that
// would block the WebAssembly tracer fails locally instead of only on Vercel.
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
// The headers every path gets, then the app's own CSP (the site has another).
type HeaderBlock = { source: string; headers: { key: string; value: string }[] }
const productionHeaders: Record<string, string> = Object.fromEntries(
  (vercel.headers as HeaderBlock[])
    .filter((b) => b.source === '/(.*)' || b.source === '/app/((?!assets/prep-|buy/).*)')
    .flatMap((b) => b.headers.map((h) => [h.key, h.value])),
)

/**
 * The app lives at inlaytrace.com/app/, beside the landing page and docs
 * (apps/site, at the root). Its old address, mattblack.space/tools/img-to-svg/,
 * redirects here (vercel.json, and the portfolio's own redirect).
 */
export const BASE = '/app/'
const here = fileURLToPath(new URL('.', import.meta.url))

/**
 * Writes sw.js (from sw.template.js) after the build, listing every built
 * file as the app shell except the AI models and runtime, which the worker
 * caches on first use instead. The version is a hash of the list's contents,
 * so any change to the app makes a new cache and the old one is cleared.
 */
function serviceWorker(): Plugin {
  let outDir = ''
  return {
    name: 'inlay-service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir
    },
    closeBundle() {
      const files: string[] = []
      const walk = (d: string) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f)
          if (statSync(p).isDirectory()) walk(p)
          else files.push(relative(outDir, p).split('\\').join('/'))
        }
      }
      walk(outDir)
      const onUse = (f: string) => /\.(onnx|wasm)$/.test(f) || f.startsWith('models/')
      const shell = files.filter((f) => f !== 'sw.js' && !onUse(f)).sort()
      const hash = createHash('sha256')
      for (const f of shell) hash.update(f).update(readFileSync(join(outDir, f)))
      const models = createHash('sha256')
      for (const f of files.filter(onUse).sort()) models.update(f).update(readFileSync(join(outDir, f)))
      const urls = [BASE, ...shell.filter((f) => f !== 'index.html').map((f) => BASE + f)]
      const sw = readFileSync(join(here, 'sw.template.js'), 'utf8')
        .replace("'__VERSION__'", JSON.stringify(hash.digest('hex').slice(0, 12)))
        .replace('__SHELL__', JSON.stringify(urls))
        .replace("'__BASE__'", JSON.stringify(BASE))
        .replace("'__ON_USE_VERSION__'", JSON.stringify(models.digest('hex').slice(0, 12)))
      writeFileSync(join(outDir, 'sw.js'), sw)
    },
  }
}

/** /api/* (accounts for HD credits) in `vite dev`, as the Vercel Function serves it. */
function api(): Plugin {
  return {
    name: 'inlay-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void serveApi(req, res).then((done) => done || next(), next))
    },
  }
}

export default defineConfig({
  // Run from the repo root (npm scripts, vitest projects), so root is set explicitly.
  root: here,
  base: BASE,
  plugins: [react(), tailwindcss(), serviceWorker(), api()],
  // In this repo the app uses the tracer's TypeScript source, so there's no
  // package build in the dev loop; npm users get the built dist/.
  resolve: { alias: [{ find: /^inlaytrace$/, replacement: `${here}../../packages/inlay/src/index.ts` }] },
  build: {
    // The repo root's dist/, which Vercel serves.
    outDir: `${here}../../dist${BASE}`,
    emptyOutDir: true,
    target: 'es2022',
    // The two large chunks are SVGO (lazy, only fetched for export/stats) and
    // nothing else; the app shell is ~80 KB gzipped.
    chunkSizeWarningLimit: 600,
    // The app, plus two pages of their own for HD credits: the account page and
    // the buy page (the only one whose CSP allows Paddle's checkout).
    rolldownOptions: { input: { main: `${here}index.html`, account: `${here}account/index.html`, buy: `${here}buy/index.html` } },
  },
  preview: { headers: productionHeaders },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
  },
})
