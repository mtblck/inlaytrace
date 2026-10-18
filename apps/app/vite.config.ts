import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// `vite preview` serves the production headers from vercel.json, so a CSP that
// would block the WebAssembly tracer fails locally instead of only on Vercel.
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))
// The headers every path gets, then the app's own CSP (the site has another).
type HeaderBlock = { source: string; headers: { key: string; value: string }[] }
const productionHeaders: Record<string, string> = Object.fromEntries(
  (vercel.headers as HeaderBlock[])
    .filter((b) => b.source === '/(.*)' || b.source === '/tools/img-to-svg/(.*)')
    .flatMap((b) => b.headers.map((h) => [h.key, h.value])),
)

/**
 * Until inlaytrace.com is live (#61) the app is served at
 * mattblack.space/tools/img-to-svg/ through a rewrite in the portfolio, and at
 * its own Vercel URL. Building into dist/tools/img-to-svg with a matching base
 * puts every file at the same path on both hosts, so the portfolio's rewrite
 * never has to translate paths. At the cutover this becomes '/app/'.
 */
export const BASE = '/tools/img-to-svg/'
const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  // Run from the repo root (npm scripts, vitest projects), so root is set explicitly.
  root: here,
  base: BASE,
  plugins: [react(), tailwindcss()],
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
  },
  preview: { headers: productionHeaders },
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
  },
})
