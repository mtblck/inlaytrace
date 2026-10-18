#!/usr/bin/env node
/**
 * Serve dist/ the way Vercel will, from vercel.json: redirects, then files
 * (with directory index.html), then rewrites, then 404.html; and every header
 * block whose source matches, in order, later ones winning. So `npm run verify`
 * sees the landing page, the docs and the app under their real CSPs. /api/* goes
 * to the same handler as the Vercel Function (server/api.ts, loaded through Vite
 * so its TypeScript runs as is), with settings from the environment.
 *
 *   npm run preview [-- --port 4173]
 */
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, normalize, sep } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 4173
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json', '.xml': 'application/xml', '.png': 'image/png', '.txt': 'text/plain', '.pf_meta': 'application/octet-stream', '.pf_index': 'application/octet-stream', '.pf_fragment': 'application/octet-stream' }

/** Vercel's sources are path-to-regexp; the ones here are plain regex groups, so anchor them. */
const matches = (source, path) => new RegExp(`^${source}$`).exec(path)
const file = (path) => {
  let decoded
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null // a malformed % escape: a 404, as on Vercel, not a crash
  }
  const p = normalize(join(dist, decoded))
  if (p !== dist && !p.startsWith(dist + sep)) return null // not dist-old/ beside it
  if (existsSync(p) && statSync(p).isFile()) return p
  if (existsSync(join(p, 'index.html'))) return join(p, 'index.html')
  return null
}

/** server/node.ts, loaded on the first /api request. */
let api
const loadApi = async () => {
  if (!api) {
    const { createServer: vite } = await import('vite')
    const server = await vite({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' })
    api = await server.ssrLoadModule('/server/node.ts')
  }
  return api
}

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  if (path.startsWith('/api/')) {
    loadApi()
      .then((m) => m.serveApi(req, res))
      .catch((e) => {
        console.error(e)
        res.writeHead(500).end()
      })
    return
  }
  for (const r of config.redirects ?? []) {
    const m = matches(r.source, path)
    if (m) {
      res.writeHead(r.permanent ? 308 : 307, { Location: r.destination.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? '') })
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
