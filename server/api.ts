/**
 * Inlay's API: accounts and credits for HD mode. Web-standard Request → Response, so the
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
 *   POST account/portal            a link to Paddle's portal (receipts, invoices)
 *   GET  checkout/config           Paddle client token, environment and packs
 *   POST checkout       { priceId } a Paddle transaction for one pack, tagged
 *                                  with the signed-in user
 *   POST paddle/webhook            Paddle notifications (signed): completed
 *                                  purchases add credits; refunds hold them while
 *                                  pending, take them back, or release them
 *   POST hd/start, hd/upload, hd/run; GET hd/result   HD jobs (server/hd.ts)
 *   GET  keepalive                 Vercel cron: one query a day so the free
 *                                  Supabase project never pauses
 *
 * Sessions are HttpOnly cookies scoped to /api, so page scripts can't read
 * them. Every POST must come from this origin with a JSON body: SameSite=Lax
 * already keeps the cookies off cross-site posts, and a cross-site form can't
 * send JSON without a preflight this API never answers.
 */
import { cleanup, resultPart, runJob, startRun, uploadPart, type HdEnv } from './hd.js'
import { creditsFor, fromPaddle, packs, paddle, paddleEnvironment, PaddleError, verifySignature, type PaddleEnv } from './paddle.js'
import { isSecretKey, supabase, SupabaseError, type Env as SupabaseEnv, type Session, type Supabase, type User } from './supabase.js'

export type Env = SupabaseEnv & PaddleEnv & HdEnv

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
    if (!db) {
      // The app's header asks on every load; with no accounts here, nobody is signed in.
      if (route === 'account/summary' && req.method === 'GET') return json({ signedIn: false })
      if (env.SUPABASE_SERVICE_ROLE_KEY && !isSecretKey(env.SUPABASE_SERVICE_ROLE_KEY)) console.error('SUPABASE_SERVICE_ROLE_KEY is a publishable (anon) key; it needs the secret (service_role) key.')
      return json({ error: "Accounts aren't set up on this server." }, 503)
    }
    // HD jobs (server/hd.ts): the upload route takes raw bytes, so it has its own check.
    if (route.startsWith('hd/')) return await hdRoute(req, route, db, env)
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
      case 'GET account/summary':
        return await account(req, db, false)
      case 'POST account/delete':
        return await deleteAccount(req, db)
      case 'POST account/portal':
        return await portal(req, db, env, fetchImpl)
      case 'GET checkout/config':
        return checkoutConfig(env)
      case 'POST checkout':
        return await checkout(req, db, env, fetchImpl)
      case 'POST paddle/webhook':
        return await webhook(req, db, env, fetchImpl)
    }
    return json({ error: 'Not found.' }, 404)
  } catch (e) {
    if ((e instanceof SupabaseError || e instanceof PaddleError) && e.status === 429) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429)
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

/** Who's signed in and their balance; with the ledger for the account page, without for the app's header. */
async function account(req: Request, db: Supabase, withLedger = true) {
  const auth = await authenticate(req, db)
  // Signed out is an ordinary answer here, not an error: the page shows the sign-in form.
  if (!auth) return json({ signedIn: false }, 200, cookies(req)[AT] || cookies(req)[RT] ? clearSession() : [])
  if (!withLedger) return json({ signedIn: true, email: auth.user.email, balance: await db.balance(auth.user.id) }, 200, auth.setCookies)
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

// ---- Buying credits (Paddle) ----------------------------------------------------

const PADDLE_MISSING = { error: "Payments aren't set up on this server." }

async function portal(req: Request, db: Supabase, env: Env, fetchImpl: typeof fetch) {
  const pd = paddle(env, fetchImpl)
  if (!pd) return json(PADDLE_MISSING, 503)
  const auth = await authenticate(req, db)
  if (!auth) return json({ error: 'Sign in first.' }, 401, clearSession())
  const customer = await pd.findCustomer(auth.user.email)
  if (!customer) return json({ error: 'No purchases yet, so there are no receipts to show.' }, 404, auth.setCookies)
  return json({ url: await pd.portalUrl(customer) }, 200, auth.setCookies)
}

/** What the buy page needs to open Paddle's checkout. The client token is public by design. */
function checkoutConfig(env: Env) {
  if (!env.PADDLE_CLIENT_TOKEN || !env.PADDLE_API_KEY) return json(PADDLE_MISSING, 503)
  return json({ environment: paddleEnvironment(env), token: env.PADDLE_CLIENT_TOKEN, packs: packs(env) })
}

async function checkout(req: Request, db: Supabase, env: Env, fetchImpl: typeof fetch) {
  const pd = paddle(env, fetchImpl)
  if (!pd) return json(PADDLE_MISSING, 503)
  const body = await readJson(req)
  const priceId = typeof body.priceId === 'string' ? body.priceId : ''
  if (!creditsFor(env, priceId)) return json({ error: "That pack isn't for sale." }, 400)
  const auth = await authenticate(req, db)
  if (!auth) return json({ error: 'Sign in to buy credits.' }, 401, clearSession())
  // The transaction, not the browser, says whose credits these are.
  const customer = (await pd.findCustomer(auth.user.email)) ?? (await pd.createCustomer(auth.user.email))
  const transactionId = await pd.createTransaction(priceId, customer, auth.user.id)
  return json({ transactionId }, 200, auth.setCookies)
}

type PaddleEvent = { event_type?: string; data?: Record<string, any> }

/**
 * Paddle's notifications. Everything here is idempotent (once per transaction
 * in the ledger), so retries and replays change nothing. Answers 200 to events
 * it can't act on, so Paddle stops retrying them; problems are logged.
 */
async function webhook(req: Request, db: Supabase, env: Env, fetchImpl: typeof fetch) {
  const raw = await req.text()
  if (!env.PADDLE_WEBHOOK_SECRET) return json(PADDLE_MISSING, 503)
  // Only Paddle's own addresses, from its live list; the signature is checked as well.
  const source = await fromPaddle(req, env, fetchImpl)
  if (source === null) return json({ error: "Couldn't check the sender. Try again." }, 503)
  if (!source) return json({ error: 'Not from Paddle.' }, 403)
  if (!(await verifySignature(req.headers.get('paddle-signature'), raw, env.PADDLE_WEBHOOK_SECRET))) return json({ error: 'Bad signature.' }, 401)
  let event: PaddleEvent
  try {
    event = JSON.parse(raw)
  } catch {
    return json({ error: 'Bad JSON.' }, 400)
  }
  const d = event.data ?? {}
  if (event.event_type === 'transaction.completed') {
    const userId = d.custom_data?.user_id
    const items: { price?: { id?: string }; price_id?: string; quantity?: number }[] = d.items ?? []
    const credits = items.reduce((n, i) => n + creditsFor(env, i.price?.id ?? i.price_id ?? '') * (i.quantity ?? 1), 0)
    if (typeof userId !== 'string' || !credits) {
      console.error(`Paddle ${d.id}: completed, but no user (${userId}) or no known pack (${items.map((i) => i.price?.id ?? i.price_id).join(', ')}); no credits granted.`)
      return json({ ok: true, granted: 0 })
    }
    try {
      await db.grantPurchase(userId, d.id, credits, { price_id: items[0]?.price?.id ?? items[0]?.price_id, customer_id: d.customer_id, total: d.details?.totals?.grand_total ?? d.details?.totals?.total, currency: d.currency_code })
    } catch (e) {
      // The account was deleted between paying and the notification: nothing to credit.
      if (e instanceof SupabaseError && /foreign key|violates/.test(e.message)) {
        console.error(`Paddle ${d.id}: user ${userId} no longer exists; refund by hand if needed.`)
        return json({ ok: true, granted: 0 })
      }
      throw e
    }
    return json({ ok: true, granted: credits })
  }
  if (event.event_type === 'adjustment.created' || event.event_type === 'adjustment.updated') {
    // Refunds and chargebacks. Credits are held (taken back) as soon as a refund
    // is requested, so they can't be spent while Paddle reviews it; approval
    // keeps them taken back, rejection gives them back.
    if (d.action === 'chargeback_reverse') console.error(`Paddle ${d.id}: chargeback on ${d.transaction_id} reversed in the merchant's favour; restore the credits by hand if they were taken back.`)
    if (!['refund', 'chargeback'].includes(d.action) || !d.transaction_id || !d.id) return json({ ok: true, reversed: 0 })
    // Notifications can arrive out of order, so ask Paddle for the adjustment as it is now.
    const pd = paddle(env, fetchImpl)
    if (!pd) return json(PADDLE_MISSING, 503)
    const adjustment = await pd.adjustment(d.id)
    // Not visible through the API yet: have Paddle send it again later.
    if (!adjustment) return json({ error: 'Adjustment not found yet; retry.' }, 503)
    const status: string = adjustment.status
    if (status === 'rejected') {
      const balance = await db.releaseReversal(d.id, { action: d.action })
      return json({ ok: true, released: balance !== null })
    }
    if (status !== 'pending_approval' && status !== 'approved') return json({ ok: true, reversed: 0 })
    const purchase = await db.purchase(d.transaction_id)
    if (!purchase) return json({ ok: true, reversed: 0 })
    // A full refund takes everything back (less anything already reversed; the
    // database caps it); a partial one, its share. Several adjustments on one
    // purchase each count once.
    let credits = purchase.delta
    if (adjustment.type === 'partial') {
      const paid = Number(purchase.details.total)
      const refunded = Number(adjustment.totals?.total)
      if (!(paid > 0 && refunded > 0)) {
        console.error(`Paddle ${d.id}: partial ${d.action} on ${d.transaction_id}, but the amounts (paid ${purchase.details.total}, refunded ${adjustment.totals?.total}) don't allow a share; nothing reversed, adjust by hand.`)
        return json({ ok: true, reversed: 0 })
      }
      credits = Math.ceil((purchase.delta * refunded) / paid)
    }
    await db.reversePurchase(d.transaction_id, d.id, credits, { action: d.action, type: adjustment.type })
    return json({ ok: true, reversed: credits })
  }
  return json({ ok: true })
}

// ---- HD (server/hd.ts) ----------------------------------------------------------------

async function hdRoute(req: Request, route: string, db: Supabase, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const origin = req.headers.get('origin')
  if (req.method === 'POST' && origin && origin !== url.origin) return json({ error: 'Not allowed.' }, 403)
  const auth = await authenticate(req, db)
  if (!auth) return json({ error: 'Sign in to use HD.' }, 401, clearSession())
  const send = (r: { status: number; body?: unknown; bytes?: Uint8Array; contentType?: string }) => {
    if (r.bytes) {
      const headers = new Headers({ 'Content-Type': r.contentType ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      for (const c of auth.setCookies) headers.append('Set-Cookie', c)
      return new Response(r.bytes as unknown as BodyInit, { status: r.status, headers })
    }
    return r.body === undefined ? empty(r.status, auth.setCookies) : json(r.body, r.status, auth.setCookies)
  }
  const isJson = (req.headers.get('content-type') ?? '').startsWith('application/json')
  switch (`${req.method} ${route}`) {
    case 'POST hd/start':
      return isJson ? send(await startRun(db, auth.user, await readJson(req), env)) : json({ error: 'Send JSON.' }, 415)
    case 'POST hd/upload':
      if ((req.headers.get('content-type') ?? '') !== 'application/octet-stream') return json({ error: 'Send the part as application/octet-stream.' }, 415)
      return send(await uploadPart(db, auth.user, url.searchParams.get('run') ?? '', url.searchParams.get('part'), new Uint8Array(await req.arrayBuffer())))
    case 'POST hd/run': {
      if (!isJson) return json({ error: 'Send JSON.' }, 415)
      const body = await readJson(req)
      return send(await runJob(db, auth.user, String(body.run ?? ''), env))
    }
    case 'GET hd/result':
      return send(await resultPart(db, auth.user, url.searchParams.get('run') ?? '', url.searchParams.get('part')))
  }
  return json({ error: 'Not found.' }, 404)
}

async function keepalive(req: Request, env: Env, fetchImpl: typeof fetch) {
  // Vercel sends `Authorization: Bearer $CRON_SECRET` on cron requests; nobody else knows it.
  if (!env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${env.CRON_SECRET}`) return json({ error: 'Not found.' }, 404)
  const db = supabase(env, fetchImpl)
  if (!db) return json({ error: "Accounts aren't set up on this server." }, 503)
  await db.balance('00000000-0000-0000-0000-000000000000')
  // Also the daily sweep of HD files: nothing stays in storage more than an hour or so past its run.
  const cleaned = await cleanup(db)
  if (cleaned) console.log(`keepalive: cleaned ${cleaned} HD run(s)`)
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
