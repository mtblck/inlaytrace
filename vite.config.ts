import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'

// `vite preview` serves the production headers from vercel.json, so a CSP that
// would block the WebAssembly tracer fails locally instead of only on Vercel.
const vercel = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'))
const productionHeaders: Record<string, string> = Object.fromEntries(
  vercel.headers[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]),
)

/**
 * The tool is served at mattblack.space/tools/img-to-svg/ through a rewrite in
 * the portfolio, and also at its own Vercel URL. Building into
 * dist/tools/img-to-svg with a matching base puts every file at the same path
 * on both hosts, so the portfolio's rewrite never has to translate paths.
 */
const BASE = '/tools/img-to-svg/'

export default defineConfig({
  base: BASE,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: `dist${BASE}`,
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
