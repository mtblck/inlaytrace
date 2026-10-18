/**
 * Inlay's API: accounts for HD credits. Web-standard Request → Response, so the
 * Vercel Function (api/server.ts) and the dev and preview servers run the same
 * code. The free app never calls it; only the account page and, later, HD do.
 *
 * Routes (under /api/):
 *   POST auth/start     { email }  email a sign-in link
 *   POST auth/exchange  { code }   the link's ?code= for a session (cookies)
 *   POST auth/signout
 *   GET  account                   { signedIn: false }, or email, balance and
 *                                  recent ledger
 *   POST account/delete { confirm: true }
 *   GET  keepalive                 Vercel cron: one query a day so the free
 *                                  Supabase project never pauses
 *
 * Sessions are HttpOnly cookies scoped to /api, so page scripts can't read
 * them. Every POST must come from this origin with a JSON body: SameSite=Lax
 * already keeps the cookies off cross-site posts, and a cross-site form can't
 * send JSON without a preflight this API never answers.
 */
import { supabase, SupabaseError, type Env, type Session, type Supabase, type User } from './supabase.js'

const AT = 'inlay_at'
const RT = 'inlay_rt'
const PKCE = 'inlay_pkce'
const REFRESH_DAYS = 30
/** Where sign-in links land. */
export const ACCOUNT_PAGE = '/app/account/'

export async function handle(req: Request, route: string, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  try {
    if (route === 'keepalive' && req.method === 'GET') return await keepalive(req, env, fetchImpl)
    const db = supabase(env, fetchImpl)
    if (!db) return json({ error: "Accounts aren't set up on this server." }, 503)
    if (req.method === 'POST') {
      const bad = checkPost(req)
      if (bad) return bad
    }
    const key = `${req.method} ${route}`
    switch (key) {
      case 'POST auth/start':
        return await start(req, db)
      case 'POST auth/exchange':
        return await exchange(req, db)
      case 'POST auth/signout':
        return await signOut(req, db)
      case 'GET account':
        return await account(req, db)
      case 'POST account/delete':
        return await deleteAccount(req, db)
    }
    return json({ error: 'Not found.' }, 404)
  } catch (e) {
    if (e instanceof SupabaseError && e.status === 429) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429)
    console.error(e)
    return json({ error: 'Something went wrong on the server. Try again in a moment.' }, 500)
  }
}

// ---- Routes -------------------------------------------------------------------

async function start(req: Request, db: Supabase) {
  const body = await readJson(req)
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.' }, 400)
  const verifier = randomString(48)
  const url = new URL(req.url)
  await db.sendLink(email, url.origin + ACCOUNT_PAGE, await challenge(verifier))
  // The verifier stays in this browser, so the link only signs in where it was asked for.
  return empty(204, [cookie(PKCE, verifier, { path: '/api/auth', maxAge: 60 * 60 })])
}

async function exchange(req: Request, db: Supabase) {
  const body = await readJson(req)
  const code = typeof body.code === 'string' ? body.code : ''
  const verifier = cookies(req)[PKCE]
  if (!code) return json({ error: 'That sign-in link is incomplete.' }, 400)
  if (!verifier) return json({ error: 'Open the sign-in link in the browser you asked for it in, or ask for a new link here.', code: 'other_browser' }, 400)
  let session: Session
  try {
    session = await db.exchangeCode(code, verifier)
  } catch (e) {
    // Rate limiting (429) goes to the outer handler's message; asking for a new link would make it worse.
    if (e instanceof SupabaseError && e.status < 500 && e.status !== 429) return json({ error: 'That sign-in link has expired or was already used. Ask for a new one.', code: 'expired' }, 400)
    throw e
  }
  return json({ email: session.user.email }, 200, [...sessionCookies(session), clear(PKCE, '/api/auth')])
}

async function signOut(req: Request, db: Supabase) {
  const at = cookies(req)[AT]
  if (at) await db.signOut(at)
  return empty(204, clearSession())
}

async function account(req: Request, db: Supabase) {
  const auth = await authenticate(req, db)
  // Signed out is an ordinary answer here, not an error: the page shows the sign-in form.
  if (!auth) return json({ signedIn: false }, 200, cookies(req)[AT] || cookies(req)[RT] ? clearSession() : [])
  const [balance, ledger] = await Promise.all([db.balance(auth.user.id), db.ledger(auth.user.id)])
  return json({ signedIn: true, email: auth.user.email, balance, ledger }, 200, auth.setCookies)
}

async function deleteAccount(req: Request, db: Supabase) {
  const body = await readJson(req)
  if (body.confirm !== true) return json({ error: 'Confirm to delete the account.' }, 400)
  const auth = await authenticate(req, db)
  if (!auth) return json({ error: 'Signed out.' }, 401, clearSession())
  await db.deleteUser(auth.user.id)
  return empty(204, clearSession())
}

async function keepalive(req: Request, env: Env, fetchImpl: typeof fetch) {
  // Vercel sends `Authorization: Bearer $CRON_SECRET` on cron requests; nobody else knows it.
  if (!env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return json({ error: 'Not found.' }, 404)
  const db = supabase(env, fetchImpl)
  if (!db) return json({ error: "Accounts aren't set up on this server." }, 503)
  await db.balance('00000000-0000-0000-0000-000000000000')
  return empty(204)
}

// ---- Sessions -----------------------------------------------------------------

/**
 * The signed-in user, refreshing an expired access token if there's a refresh
 * token. `setCookies` carries the new tokens when it refreshed.
 */
export async function authenticate(req: Request, db: Supabase): Promise<{ user: User; setCookies: string[] } | null> {
  const c = cookies(req)
  if (c[AT]) {
    const user = await db.user(c[AT])
    if (user) return { user, setCookies: [] }
  }
  if (!c[RT]) return null
  try {
    const session = await db.refresh(c[RT])
    return { user: session.user, setCookies: sessionCookies(session) }
  } catch (e) {
    if (e instanceof SupabaseError && e.status < 500) return null
    throw e
  }
}

const sessionCookies = (s: Session) => [cookie(AT, s.accessToken, { path: '/api', maxAge: s.expiresIn }), cookie(RT, s.refreshToken, { path: '/api', maxAge: REFRESH_DAYS * 86400 })]
const clearSession = () => [clear(AT, '/api'), clear(RT, '/api')]

// ---- HTTP helpers ---------------------------------------------------------------

/** POSTs come from this site, as JSON. */
function checkPost(req: Request): Response | null {
  const origin = req.headers.get('origin')
  if (origin && origin !== new URL(req.url).origin) return json({ error: 'Not allowed.' }, 403)
  if (!(req.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'Send JSON.' }, 415)
  return null
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json()
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function json(body: unknown, status = 200, setCookies: string[] = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  for (const c of setCookies) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}

function empty(status: number, setCookies: string[] = []) {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  for (const c of setCookies) headers.append('Set-Cookie', c)
  return new Response(null, { status, headers })
}

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = safeDecode(part.slice(i + 1).trim())
  }
  return out
}

/** Another cookie on the site with a stray % must not break every request. */
const safeDecode = (v: string) => {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

function cookie(name: string, value: string, o: { path: string; maxAge: number }) {
  return `${name}=${encodeURIComponent(value)}; Path=${o.path}; Max-Age=${Math.max(0, Math.floor(o.maxAge))}; HttpOnly; Secure; SameSite=Lax`
}
const clear = (name: string, path: string) => cookie(name, '', { path, maxAge: 0 })

const isEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

function randomString(bytes: number) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** PKCE S256: base64url(sha256(verifier)). */
export async function challenge(verifier: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

function base64url(b: Uint8Array) {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
