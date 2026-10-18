import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { handle } from './api'
import { verifySignature } from './paddle'

const ORIGIN = 'https://inlaytrace.com'
const SECRET = 'pdl_ntfset_test'
const USER = { id: '11111111-1111-1111-1111-111111111111', email: 'ada@example.com' }
const env = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
  PADDLE_API_KEY: 'pdl_sdbx_apikey_test',
  PADDLE_CLIENT_TOKEN: 'test_client_token',
  PADDLE_WEBHOOK_SECRET: SECRET,
}
const PACK_60 = 'pri_01m57wz8aj07enh29xt4wfptm6'

const sign = (body: string, ts = Math.floor(Date.now() / 1000), secret = SECRET) => `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`

/** Fake Supabase and Paddle behind one fetch. */
function fake(opts: { customer?: string | null; purchase?: { user_id: string; delta: number; details: Record<string, unknown> } | null; grantError?: { status: number; msg: string }; adjustment?: Record<string, unknown> } = {}) {
  const calls: { method: string; host: string; path: string; headers: Record<string, string>; body: any }[] = []
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input)
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]))
    const body = init.body ? JSON.parse(String(init.body)) : null
    calls.push({ method: init.method ?? 'GET', host: url.host, path: url.pathname + url.search, headers, body })
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    if (url.pathname === '/auth/v1/user') return headers.authorization === 'Bearer at-1' ? ok(USER) : ok({ msg: 'bad' }, 401)
    if (url.pathname === '/rest/v1/rpc/grant_purchase') return opts.grantError ? ok({ message: opts.grantError.msg }, opts.grantError.status) : ok(60)
    if (url.pathname === '/rest/v1/rpc/reverse_purchase') return ok(0)
    if (url.pathname === '/rest/v1/rpc/release_reversal') return ok(20)
    if (url.pathname === '/rest/v1/credit_ledger') return ok(opts.purchase ? [opts.purchase] : [])
    if (url.host === 'sandbox-api.paddle.com') {
      if (url.pathname === '/customers' && init.method !== 'POST') return ok({ data: opts.customer ? [{ id: opts.customer }] : [] })
      if (url.pathname === '/customers') return ok({ data: { id: 'ctm_new' } }, 201)
      if (url.pathname === '/transactions') return ok({ data: { id: 'txn_new' } }, 201)
      // Paddle's view of the adjustment now; without one, the webhook trusts the payload.
      if (url.pathname === '/adjustments') return ok({ data: opts.adjustment ? [opts.adjustment] : [] })
      if (url.pathname.endsWith('/portal-sessions')) return ok({ data: { urls: { general: { overview: 'https://sandbox-customer-portal.paddle.com/x' } } } }, 201)
    }
    return ok({ msg: 'unexpected' }, 500)
  }) as typeof fetch
  return { calls, fetchImpl }
}

const post = (route: string, body: unknown, cookie = '') =>
  new Request(`${ORIGIN}/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, cookie }, body: JSON.stringify(body) })
const hook = (event: unknown, signature?: string) => {
  const body = JSON.stringify(event)
  return new Request(`${ORIGIN}/api/paddle/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'paddle-signature': signature ?? sign(body) }, body })
}
const completed = (over: Record<string, unknown> = {}) => ({
  event_type: 'transaction.completed',
  data: { id: 'txn_1', customer_id: 'ctm_1', currency_code: 'USD', custom_data: { user_id: USER.id }, items: [{ price: { id: PACK_60 }, quantity: 1 }], details: { totals: { grand_total: '1200' } }, ...over },
})

describe('Paddle signatures', () => {
  it('accepts a signature over ts:body with the secret, and nothing else', async () => {
    const body = '{"a":1}'
    expect(await verifySignature(sign(body), body, SECRET)).toBe(true)
    expect(await verifySignature(sign(body), '{"a":2}', SECRET)).toBe(false)
    expect(await verifySignature(sign(body, undefined, 'other'), body, SECRET)).toBe(false)
    expect(await verifySignature(null, body, SECRET)).toBe(false)
    expect(await verifySignature('ts=abc;h1=00', body, SECRET)).toBe(false)
  })

  it('refuses old timestamps and accepts any h1 while secrets rotate', async () => {
    const body = '{}'
    expect(await verifySignature(sign(body, Math.floor(Date.now() / 1000) - 3600), body, SECRET)).toBe(false)
    const good = sign(body)
    expect(await verifySignature(`${good};h1=${'0'.repeat(64)}`, body, SECRET)).toBe(true)
  })
})

describe('checkout', () => {
  it('gives the page the client token and the packs, without the API key', async () => {
    const r = await handle(new Request(`${ORIGIN}/api/checkout/config`), 'checkout/config', env, fake().fetchImpl)
    const b = await r.json()
    expect(b.environment).toBe('sandbox')
    expect(b.token).toBe('test_client_token')
    expect(b.packs.map((p: { credits: number }) => p.credits)).toEqual([20, 60, 200])
    expect(JSON.stringify(b)).not.toContain('apikey')
  })

  it('creates a transaction for the signed-in user, reusing their Paddle customer', async () => {
    const f = fake({ customer: 'ctm_1' })
    const r = await handle(post('checkout', { priceId: PACK_60 }, 'inlay_at=at-1'), 'checkout', env, f.fetchImpl)
    expect(await r.json()).toEqual({ transactionId: 'txn_new' })
    const t = f.calls.find((c) => c.path === '/transactions')!
    expect(t.body).toEqual({ items: [{ price_id: PACK_60, quantity: 1 }], customer_id: 'ctm_1', custom_data: { user_id: USER.id } })
    expect(t.headers.authorization).toBe('Bearer pdl_sdbx_apikey_test')
    expect(f.calls.some((c) => c.path === '/customers' && c.method === 'POST')).toBe(false)
  })

  it('creates the Paddle customer on a first purchase', async () => {
    const f = fake({ customer: null })
    await handle(post('checkout', { priceId: PACK_60 }, 'inlay_at=at-1'), 'checkout', env, f.fetchImpl)
    expect(f.calls.find((c) => c.path === '/customers' && c.method === 'POST')!.body).toEqual({ email: USER.email })
    expect(f.calls.find((c) => c.path === '/transactions')!.body.customer_id).toBe('ctm_new')
  })

  it('refuses unknown prices and signed-out buyers', async () => {
    const f = fake()
    expect((await handle(post('checkout', { priceId: 'pri_free' }, 'inlay_at=at-1'), 'checkout', env, f.fetchImpl)).status).toBe(400)
    expect((await handle(post('checkout', { priceId: PACK_60 }), 'checkout', env, f.fetchImpl)).status).toBe(401)
    expect(f.calls.some((c) => c.path === '/transactions')).toBe(false)
  })

  it('links to the Paddle portal once there are purchases', async () => {
    const r = await handle(post('account/portal', {}, 'inlay_at=at-1'), 'account/portal', env, fake({ customer: 'ctm_1' }).fetchImpl)
    expect((await r.json()).url).toMatch(/customer-portal/)
    expect((await handle(post('account/portal', {}, 'inlay_at=at-1'), 'account/portal', env, fake({ customer: null }).fetchImpl)).status).toBe(404)
  })
})

describe('webhook', () => {
  it('grants the pack credits to the user on the transaction, once per transaction', async () => {
    const f = fake()
    const r = await handle(hook(completed()), 'paddle/webhook', env, f.fetchImpl)
    expect(await r.json()).toEqual({ ok: true, granted: 60 })
    const g = f.calls.find((c) => c.path === '/rest/v1/rpc/grant_purchase')!
    expect(g.body).toMatchObject({ p_user: USER.id, p_transaction: 'txn_1', p_credits: 60 })
    expect(g.body.p_details).toMatchObject({ price_id: PACK_60, customer_id: 'ctm_1', total: '1200', currency: 'USD' })
  })

  it('rejects a bad or missing signature without touching the ledger', async () => {
    const f = fake()
    expect((await handle(hook(completed(), 'ts=1;h1=00'), 'paddle/webhook', env, f.fetchImpl)).status).toBe(401)
    const unsigned = new Request(`${ORIGIN}/api/paddle/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(completed()) })
    expect((await handle(unsigned, 'paddle/webhook', env, f.fetchImpl)).status).toBe(401)
    expect(f.calls).toHaveLength(0)
  })

  it('grants nothing for unknown prices or a missing user, and says so (200, so Paddle stops retrying)', async () => {
    for (const ev of [completed({ items: [{ price: { id: 'pri_other' }, quantity: 1 }] }), completed({ custom_data: null })]) {
      const f = fake()
      const r = await handle(hook(ev), 'paddle/webhook', env, f.fetchImpl)
      expect(r.status).toBe(200)
      expect((await r.json()).granted).toBe(0)
      expect(f.calls.some((c) => c.path.includes('grant_purchase'))).toBe(false)
    }
  })

  it('answers 200 when the account was deleted before the notification arrived', async () => {
    const f = fake({ grantError: { status: 409, msg: 'insert or update on table "credit_ledger" violates foreign key constraint' } })
    const r = await handle(hook(completed()), 'paddle/webhook', env, f.fetchImpl)
    expect(r.status).toBe(200)
    expect((await r.json()).granted).toBe(0)
  })

  it('takes credits back on an approved refund: all of them, or a partial refund’s share', async () => {
    const purchase = { user_id: USER.id, delta: 60, details: { total: '1200' } }
    const adj = (over: Record<string, unknown>) => ({ event_type: 'adjustment.updated', data: { id: 'adj_1', action: 'refund', status: 'approved', type: 'full', transaction_id: 'txn_1', totals: { total: '1200' }, ...over } })
    const full = fake({ purchase })
    expect(await (await handle(hook(adj({})), 'paddle/webhook', env, full.fetchImpl)).json()).toEqual({ ok: true, reversed: 60 })
    expect(full.calls.find((c) => c.path === '/rest/v1/rpc/reverse_purchase')!.body).toMatchObject({ p_transaction: 'txn_1', p_adjustment: 'adj_1', p_credits: 60 })
    const partial = fake({ purchase })
    expect(await (await handle(hook(adj({ type: 'partial', totals: { total: '300' } })), 'paddle/webhook', env, partial.fetchImpl)).json()).toEqual({ ok: true, reversed: 15 })
    // A partial refund whose share can't be worked out reverses nothing (logged), not everything.
    const unknown = fake({ purchase: { ...purchase, details: {} } })
    expect(await (await handle(hook(adj({ type: 'partial', totals: { total: '300' } })), 'paddle/webhook', env, unknown.fetchImpl)).json()).toEqual({ ok: true, reversed: 0 })
    expect(unknown.calls.some((c) => c.path.includes('reverse_purchase'))).toBe(false)
  })

  it('holds the credits as soon as a refund is requested, so they cannot be spent while Paddle reviews it', async () => {
    const purchase = { user_id: USER.id, delta: 60, details: { total: '1200' } }
    const pending = { event_type: 'adjustment.created', data: { id: 'adj_1', action: 'refund', status: 'pending_approval', type: 'full', transaction_id: 'txn_1', totals: { total: '1200' } } }
    const f = fake({ purchase })
    expect(await (await handle(hook(pending), 'paddle/webhook', env, f.fetchImpl)).json()).toEqual({ ok: true, reversed: 60 })
    expect(f.calls.find((c) => c.path === '/rest/v1/rpc/reverse_purchase')!.body).toMatchObject({ p_adjustment: 'adj_1', p_credits: 60 })
  })

  it('gives held credits back when Paddle rejects the refund', async () => {
    const rejected = { event_type: 'adjustment.updated', data: { id: 'adj_1', action: 'refund', status: 'rejected', type: 'full', transaction_id: 'txn_1' } }
    const f = fake({ purchase: { user_id: USER.id, delta: 60, details: {} } })
    expect(await (await handle(hook(rejected), 'paddle/webhook', env, f.fetchImpl)).json()).toEqual({ ok: true, released: true })
    expect(f.calls.find((c) => c.path === '/rest/v1/rpc/release_reversal')!.body).toMatchObject({ p_adjustment: 'adj_1' })
    expect(f.calls.some((c) => c.path.includes('reverse_purchase'))).toBe(false)
  })

  it("goes by Paddle's current status, not the notification's, when they arrive out of order", async () => {
    // The 'requested' notification arrives after the refund was already rejected: nothing is held.
    const late = { event_type: 'adjustment.created', data: { id: 'adj_1', action: 'refund', status: 'pending_approval', type: 'full', transaction_id: 'txn_1' } }
    const f = fake({ purchase: { user_id: USER.id, delta: 60, details: {} }, adjustment: { id: 'adj_1', status: 'rejected', type: 'full' } })
    expect(await (await handle(hook(late), 'paddle/webhook', env, f.fetchImpl)).json()).toEqual({ ok: true, released: true })
    expect(f.calls.some((c) => c.path.includes('reverse_purchase'))).toBe(false)
    expect(f.calls.find((c) => c.host === 'sandbox-api.paddle.com')!.path).toBe('/adjustments?id=adj_1')
  })

  it('ignores other events', async () => {
    const r = await handle(hook({ event_type: 'customer.updated', data: {} }), 'paddle/webhook', env, fake().fetchImpl)
    expect(await r.json()).toEqual({ ok: true })
  })
})
