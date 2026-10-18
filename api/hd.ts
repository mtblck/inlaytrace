/**
 * The Vercel Function behind /api/hd/* (HD jobs: long runs and more memory, set
 * in vercel.json). vercel.json rewrites /api/hd/<route> to /api/hd?__route=hd/<route>
 * (the query string is kept), and this hands the request to the same
 * framework-free handler as api/server.ts.
 */
import { handle } from '../server/api.js'

async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const route = url.searchParams.get('__route') ?? ''
  url.searchParams.delete('__route')
  return handle(new Request(url, req), route, process.env)
}

export const GET = dispatch
export const POST = dispatch
