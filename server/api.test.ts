import { describe, expect, it } from 'vitest'
import { challenge, handle } from './api'

const ORIGIN = 'https://inlaytrace.com'
const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test', CRON_SECRET: 'cron-secret' }
const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'ada@example.com' }

/** A fake Supabase: records every call and answers like Auth and PostgREST. */
function fakeSupabase(opts: { validAccess?: string[]; refreshOk?: boolean; otpStatus?: number } = {}) {
  const calls: { method: string; path: string; headers: Record<string, string>; body: any }[] = []
  const valid = new Set(opts.validAccess ?? ['at-1'])
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const body = init.body ? JSON.parse(String(init.body)) : null
    const path = url.pathname + url.search
    calls.push({ method: init.method ?? 'GET', path, headers, body })
    const ok = (b: unknown, status = 200) => new Response(b === null ? '' : JSON.stringify(b), { status })
    const session = (n: number) => ({ access_token: `at-${n}`, refresh_token: `rt-${n}`, expires_in: 3600, user: USER })
    if (url.pathname === '/auth/v1/otp') return opts.otpStatus ? ok({ msg: 'rate limited' }, opts.otpStatus) : ok({})
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce')
      return body.auth_code === 'good-code' && body.code_verifier ? ok(session(1)) : ok({ msg: 'invalid flow state' }, 400)
    if (url.pathname === '/auth/v1/token') return opts.refreshOk && body.refresh_token === 'rt-1' ? (valid.add('at-2'), ok(session(2))) : ok({ msg: 'Invalid Refresh Token' }, 400)
    if (url.pathname === '/auth/v1/user') return valid.has(headers.authorization?.replace('Bearer ', '') ?? '') ? ok(USER) : ok({ msg: 'invalid JWT' }, 401)
    if (url.pathname === '/auth/v1/logout') return ok(null, 204)
    if (url.pathname.startsWith('/auth/v1/admin/users/')) return ok({})
    if (url.pathname === '/rest/v1/rpc/credit_balance') return ok(45)
    if (url.pathname === '/rest/v1/credit_ledger') return ok([{ id: 2, delta: -2, reason: 'use', details: {}, created_at: '2026-10-18T12:00:00Z' }])
    return ok({ msg: 'unexpected' }, 500)
  }) as typeof fetch
  return { calls, fetchImpl }
}

const post = (route: string, body: unknown, cookie = '', headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie, ...headers }, body: JSON.stringify(body) })
const get = (route: string, cookie = '', headers: Record<string, string> = {}) => new Request(`${ORIGIN}/api/${route}`, { headers: { cookie, ...headers } })
const setCookies = (r: Response) => r.headers.getSetCookie()
const cookieValue = (r: Response, name: string) => setCookies(r).find((c) => c.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1)

describe('sign in by email link', () => {
  it('emails a link back to the account page, with a PKCE challenge, and keeps the verifier in an HttpOnly cookie', async () => {
    const sb = fakeSupabase()
    const r = await handle(post('auth/start', { email: ' Ada@Example.com ' }), 'auth/start', env, sb.fetchImpl)
    expect(r.status).toBe(204)
    const otp = sb.calls.find((c) => c.path.startsWith('/auth/v1/otp'))!
    expect(otp.body.email).toBe('ada@example.com')
    expect(otp.path).toContain(`redirect_to=${encodeURIComponent(`${ORIGIN}/app/account/`)}`)
    const verifier = decodeURIComponent(cookieValue(r, 'inlay_pkce')!)
    expect(otp.body.code_challenge).toBe(await challenge(verifier))
    expect(otp.body.code_challenge_method).toBe('s256')
    const c = setCookies(r).find((x) => x.startsWith('inlay_pkce='))!
    expect(c).toMatch(/HttpOnly/)
    expect(c).toMatch(/Secure/)
    expect(c).toMatch(/SameSite=Lax/)
    expect(c).toMatch(/Path=\/api\/auth/)
    // A secret key only goes in apikey, never as a bearer token.
    expect(otp.headers.apikey).toBe('sb_secret_test')
    expect(otp.headers.authorization).toBeUndefined()
  })

  it('refuses a bad address without calling Supabase', async () => {
    const sb = fakeSupabase()
    const r = await handle(post('auth/start', { email: 'not an email' }), 'auth/start', env, sb.fetchImpl)
    expect(r.status).toBe(400)
    expect(sb.calls).toHaveLength(0)
  })

  it('passes on rate limiting as a 429 with a plain message', async () => {
    const r = await handle(post('auth/start', { email: 'ada@example.com' }), 'auth/start', env, fakeSupabase({ otpStatus: 429 }).fetchImpl)
    expect(r.status).toBe(429)
    expect((await r.json()).error).toMatch(/wait a minute/i)
  })

  it('exchanges the code for session cookies and clears the verifier', async () => {
    const sb = fakeSupabase()
    const r = await handle(post('auth/exchange', { code: 'good-code' }, 'inlay_pkce=v123'), 'auth/exchange', env, sb.fetchImpl)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ email: USER.email })
    expect(cookieValue(r, 'inlay_at')).toBe('at-1')
    expect(cookieValue(r, 'inlay_rt')).toBe('rt-1')
    expect(cookieValue(r, 'inlay_pkce')).toBe('')
    expect(sb.calls.find((c) => c.path.includes('grant_type=pkce'))!.body).toEqual({ auth_code: 'good-code', code_verifier: 'v123' })
  })

  it('explains a link opened in another browser, or one that expired', async () => {
    const other = await handle(post('auth/exchange', { code: 'good-code' }), 'auth/exchange', env, fakeSupabase().fetchImpl)
    expect(other.status).toBe(400)
    expect((await other.json()).code).toBe('other_browser')
    const expired = await handle(post('auth/exchange', { code: 'used-code' }, 'inlay_pkce=v123'), 'auth/exchange', env, fakeSupabase().fetchImpl)
    expect(expired.status).toBe(400)
    expect((await expired.json()).code).toBe('expired')
  })
})

describe('account', () => {
  it('shows email, balance and ledger to a signed-in user', async () => {
    const sb = fakeSupabase()
    const r = await handle(get('account', 'inlay_at=at-1; inlay_rt=rt-1'), 'account', env, sb.fetchImpl)
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b.signedIn).toBe(true)
    expect(b.email).toBe(USER.email)
    expect(b.balance).toBe(45)
    expect(b.ledger).toHaveLength(1)
    expect(sb.calls.find((c) => c.path.startsWith('/rest/v1/credit_ledger'))!.path).toContain(`user_id=eq.${USER.id}`)
    expect(r.headers.get('cache-control')).toBe('no-store')
  })

  it('refreshes an expired access token and sets the new cookies', async () => {
    const sb = fakeSupabase({ validAccess: [], refreshOk: true })
    const r = await handle(get('account', 'inlay_at=stale; inlay_rt=rt-1'), 'account', env, sb.fetchImpl)
    expect(r.status).toBe(200)
    expect(cookieValue(r, 'inlay_at')).toBe('at-2')
    expect(cookieValue(r, 'inlay_rt')).toBe('rt-2')
  })

  it('answers signedIn: false when signed out or the refresh token is dead, and clears stale cookies', async () => {
    const none = await handle(get('account'), 'account', env, fakeSupabase().fetchImpl)
    expect(none.status).toBe(200)
    expect(await none.json()).toEqual({ signedIn: false })
    expect(setCookies(none)).toEqual([])
    const r = await handle(get('account', 'inlay_at=stale; inlay_rt=dead'), 'account', env, fakeSupabase({ validAccess: [] }).fetchImpl)
    expect(await r.json()).toEqual({ signedIn: false })
    expect(cookieValue(r, 'inlay_at')).toBe('')
  })

  it('deletes the signed-in user only with confirmation', async () => {
    const sb = fakeSupabase()
    expect((await handle(post('account/delete', {}, 'inlay_at=at-1'), 'account/delete', env, sb.fetchImpl)).status).toBe(400)
    expect(sb.calls.some((c) => c.method === 'DELETE')).toBe(false)
    const r = await handle(post('account/delete', { confirm: true }, 'inlay_at=at-1'), 'account/delete', env, sb.fetchImpl)
    expect(r.status).toBe(204)
    expect(sb.calls.find((c) => c.method === 'DELETE')!.path).toBe(`/auth/v1/admin/users/${USER.id}`)
    expect(cookieValue(r, 'inlay_rt')).toBe('')
  })

  it('signs out and clears the cookies', async () => {
    const sb = fakeSupabase()
    const r = await handle(post('auth/signout', {}, 'inlay_at=at-1'), 'auth/signout', env, sb.fetchImpl)
    expect(r.status).toBe(204)
    expect(sb.calls.some((c) => c.path.startsWith('/auth/v1/logout'))).toBe(true)
    expect(cookieValue(r, 'inlay_at')).toBe('')
  })
})

describe('guards', () => {
  it('rejects posts from another origin and posts that are not JSON', async () => {
    const sb = fakeSupabase()
    expect((await handle(post('auth/start', { email: 'ada@example.com' }, '', { origin: 'https://evil.example' }), 'auth/start', env, sb.fetchImpl)).status).toBe(403)
    const form = new Request(`${ORIGIN}/api/account/delete`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'inlay_at=at-1' }, body: 'confirm=true' })
    expect((await handle(form, 'account/delete', env, sb.fetchImpl)).status).toBe(415)
    expect(sb.calls).toHaveLength(0)
  })

  it('is 503 without Supabase settings, and 404 for unknown routes', async () => {
    expect((await handle(get('account'), 'account', {}, fakeSupabase().fetchImpl)).status).toBe(503)
    expect((await handle(get('nope'), 'nope', env, fakeSupabase().fetchImpl)).status).toBe(404)
  })

  it('runs the keepalive only for Vercel cron', async () => {
    const sb = fakeSupabase()
    expect((await handle(get('keepalive'), 'keepalive', env, sb.fetchImpl)).status).toBe(404)
    expect((await handle(get('keepalive', '', { authorization: 'Bearer wrong' }), 'keepalive', env, sb.fetchImpl)).status).toBe(404)
    expect((await handle(get('keepalive', '', { authorization: 'Bearer x' }), 'keepalive', { ...env, CRON_SECRET: undefined }, sb.fetchImpl)).status).toBe(404)
    expect(sb.calls).toHaveLength(0)
    expect((await handle(get('keepalive', '', { authorization: 'Bearer cron-secret' }), 'keepalive', env, sb.fetchImpl)).status).toBe(204)
    expect(sb.calls.map((c) => c.path)).toEqual(['/rest/v1/rpc/credit_balance'])
  })

  it('sends a legacy JWT key as a bearer token too', async () => {
    const sb = fakeSupabase()
    await handle(get('account', 'inlay_at=at-1'), 'account', { ...env, SUPABASE_SERVICE_ROLE_KEY: 'eyJlegacy' }, sb.fetchImpl)
    const rpc = sb.calls.find((c) => c.path === '/rest/v1/rpc/credit_balance')!
    expect(rpc.headers.authorization).toBe('Bearer eyJlegacy')
  })
})
