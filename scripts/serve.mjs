#!/usr/bin/env node
/**
 * Serve dist/ the way Vercel will, from vercel.json: redirects, then files
 * (with directory index.html), then rewrites, then 404.html; and every header
 * block whose source matches, in order, later ones winning. So `npm run verify`
 * sees the landing page, the docs and the app under their real CSPs.
 *
 *   npm run preview [-- --port 4173]
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, normalize } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4173
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.xml': 'application/xml', '.png': 'image/png', '.txt': 'text/plain', '.pf_meta': 'application/octet-stream', '.pf_index': 'application/octet-stream', '.pf_fragment': 'application/octet-stream' }

/** Vercel's sources are path-to-regexp; the ones here are plain regex groups, so anchor them. */
const matches = (source, path) => new RegExp(`^${source}$`).exec(path)
const file = (path) => {
  const p = normalize(join(dist, decodeURIComponent(path)))
  if (!p.startsWith(dist)) return null
  if (existsSync(p) && statSync(p).isFile()) return p
  if (existsSync(join(p, 'index.html'))) return join(p, 'index.html')
  return null
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  for (const r of config.redirects ?? []) {
    if (matches(r.source, path)) {
      res.writeHead(r.permanent ? 308 : 307, { Location: r.destination })
      return res.end()
    }
  }
  let found = file(path)
  if (!found)
    for (const r of config.rewrites ?? []) {
      const m = matches(r.source, path)
      if (m) {
        found = file(r.destination.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? ''))
        break
      }
    }
  let status = 200
  if (!found) {
    found = join(dist, '404.html')
    status = 404
  }
  const headers = { 'Content-Type': TYPES[extname(found)] ?? 'application/octet-stream' }
  for (const block of config.headers ?? []) if (matches(block.source, path)) for (const h of block.headers) headers[h.key] = h.value
  res.writeHead(status, headers)
  res.end(readFileSync(found))
}).listen(port, () => console.log(`  dist/ on http://localhost:${port}/ with vercel.json's headers, redirects and rewrites`))
