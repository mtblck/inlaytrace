/**
 * Runs the API handler inside a Node http server: `vite dev` (a plugin in the
 * app's Vite config) and `npm run preview` (scripts/serve.mjs), so local
 * behaviour matches the Vercel Function. Settings come from process.env.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handle } from './api.js'

export const PREFIX = '/api/'

async function toRequest(req: IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
    else if (v !== undefined) headers.set(k, v)
  }
  let body: Uint8Array<ArrayBuffer> | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    body = new Uint8Array(Buffer.concat(chunks))
  }
  return new Request(url, { method: req.method, headers, body })
}

async function send(res: ServerResponse, r: Response) {
  res.statusCode = r.status
  const cookies = r.headers.getSetCookie()
  r.headers.forEach((v, k) => k !== 'set-cookie' && res.setHeader(k, v))
  if (cookies.length) res.setHeader('Set-Cookie', cookies)
  res.end(Buffer.from(await r.arrayBuffer()))
}

/** Handle /api/* and return true, or return false for anything else. */
export async function serveApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const path = (req.url ?? '').split('?')[0]
  if (!path.startsWith(PREFIX)) return false
  await send(res, await handle(await toRequest(req), decodeURIComponent(path.slice(PREFIX.length)), process.env))
  return true
}
