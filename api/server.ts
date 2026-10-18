/**
 * The single Vercel Function behind /api/*. vercel.json rewrites /api/<route>
 * to /api/server?__route=<route> (the query string is kept), and this hands the
 * request to the framework-free handler in server/api.ts.
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
