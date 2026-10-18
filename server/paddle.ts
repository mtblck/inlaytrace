/**
 * Paddle, which sells the credit packs as merchant of record: the packs, the
 * few API calls the server makes, and webhook signature checks.
 */

import { PACKS as PRICES, usd } from './pricing.js'

export type PaddleEnv = {
  PADDLE_API_KEY?: string
  PADDLE_CLIENT_TOKEN?: string
  PADDLE_WEBHOOK_SECRET?: string
  /** `sandbox` (the default) or `production`. */
  PADDLE_ENV?: string
}

export type Pack = { priceId: string; credits: number; price: string }

/**
 * One product, "Inlay HD credits", three one-time prices: Paddle's id for each
 * pack in pricing.ts. Credits come from these tables, never from anything the
 * browser or Paddle's payload says about amounts, so a price id we don't know
 * grants nothing.
 */
const PRICE_IDS: Record<'sandbox' | 'production', Record<number, string>> = {
  sandbox: {
    20: 'pri_01m57wybp0tek7qeg1ge41smc3',
    60: 'pri_01m57wz8aj07enh29xt4wfptm6',
    200: 'pri_01m57x08gaqsn896bvgsp0j0mr',
  },
  // Filled in when the live Paddle account is approved.
  production: {},
}

/** The packs on sale in this environment: pricing.ts's packs that have a Paddle price. */
const PACKS = (environment: 'sandbox' | 'production'): Pack[] =>
  PRICES.flatMap((p) => (PRICE_IDS[environment][p.credits] ? [{ priceId: PRICE_IDS[environment][p.credits], credits: p.credits, price: usd(p.usd) }] : []))

export const paddleEnvironment = (env: PaddleEnv): 'sandbox' | 'production' => (env.PADDLE_ENV === 'production' ? 'production' : 'sandbox')
export const packs = (env: PaddleEnv) => PACKS(paddleEnvironment(env))
export const creditsFor = (env: PaddleEnv, priceId: string) => packs(env).find((p) => p.priceId === priceId)?.credits ?? 0

export class PaddleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function paddle(env: PaddleEnv, fetchImpl: typeof fetch = fetch) {
  const key = env.PADDLE_API_KEY
  if (!key) return null
  const base = paddleEnvironment(env) === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com'

  async function call(path: string, init: RequestInit = {}) {
    const res = await fetchImpl(base + path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } })
    const body = (await res.json().catch(() => ({}))) as { data?: unknown; error?: { detail?: string; code?: string } }
    if (!res.ok) throw new PaddleError(res.status, body.error?.detail ?? body.error?.code ?? `Paddle ${res.status}`)
    return body.data
  }

  return {
    /** The Paddle customer for an email, if they've bought before. */
    async findCustomer(email: string): Promise<string | null> {
      const list = (await call(`/customers?email=${encodeURIComponent(email)}`)) as { id: string }[]
      return list[0]?.id ?? null
    },
    async createCustomer(email: string): Promise<string> {
      return ((await call('/customers', { method: 'POST', body: JSON.stringify({ email }) })) as { id: string }).id
    },
    /** A transaction for one pack, tagged with the Supabase user it credits. */
    async createTransaction(priceId: string, customerId: string, userId: string): Promise<string> {
      const t = (await call('/transactions', {
        method: 'POST',
        body: JSON.stringify({ items: [{ price_id: priceId, quantity: 1 }], customer_id: customerId, custom_data: { user_id: userId } }),
      })) as { id: string }
      return t.id
    },
    /** An adjustment (refund, chargeback) as Paddle has it now. */
    async adjustment(id: string): Promise<{ status: string; type?: string; totals?: { total?: string } } | null> {
      const list = (await call(`/adjustments?id=${encodeURIComponent(id)}`)) as { status: string; type?: string; totals?: { total?: string } }[]
      return list[0] ?? null
    },
    /** A link to Paddle's customer portal: receipts, invoices, billing details. */
    async portalUrl(customerId: string): Promise<string> {
      const s = (await call(`/customers/${encodeURIComponent(customerId)}/portal-sessions`, { method: 'POST', body: '{}' })) as { urls: { general: { overview: string } } }
      return s.urls.general.overview
    },
  }
}

export type Paddle = NonNullable<ReturnType<typeof paddle>>

/**
 * Check a webhook's Paddle-Signature header: `ts=…;h1=…`, where h1 is the hex
 * HMAC-SHA256 of `${ts}:${rawBody}` with the destination's secret. Any h1 may
 * match (Paddle may send several while rotating secrets). Replays are harmless
 * (every grant is once per transaction), so the window is generous.
 */
export async function verifySignature(header: string | null, rawBody: string, secret: string, now = Date.now(), toleranceSeconds = 300) {
  if (!header || !secret) return false
  const parts = header.split(';').map((p) => p.split('='))
  const ts = parts.find(([k]) => k === 'ts')?.[1]
  const sigs = parts.filter(([k]) => k === 'h1').map(([, v]) => v)
  if (!ts || !/^\d+$/.test(ts) || !sigs.length) return false
  if (Math.abs(now / 1000 - Number(ts)) > toleranceSeconds) return false
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${ts}:${rawBody}`)))
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')
  return sigs.some((s) => timingSafeEqual(s, hex))
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
