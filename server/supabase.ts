/**
 * The few Supabase calls the server makes, over plain fetch: Auth (sign-in
 * links, sessions, deleting a user) and the credit ledger's functions. Only
 * the server holds the secret key; the browser never talks to Supabase.
 */

export type Env = {
  SUPABASE_URL?: string
  /** The secret (service-role) key: a legacy JWT or a newer `sb_secret_…` key. */
  SUPABASE_SERVICE_ROLE_KEY?: string
  /** Vercel sends it as a bearer token on cron requests. */
  CRON_SECRET?: string
}

export type Session = { accessToken: string; refreshToken: string; expiresIn: number; user: User }
export type User = { id: string; email: string }
export type LedgerEntry = { id: number; delta: number; reason: string; details: Record<string, unknown>; created_at: string }

export type HdRun = {
  id: string
  user_id: string
  kind: 'trace' | 'background' | 'upscale'
  width: number
  height: number
  credits: number
  parts_in: number
  content_type: string
  options: Record<string, unknown>
  status: 'uploading' | 'running' | 'done' | 'failed'
  use_id: number | null
  parts_out: number | null
  result_type: string | null
  error: string | null
  created_at: string
  finished_at: string | null
  cleaned_at: string | null
}

export class SupabaseError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function supabase(env: Env, fetchImpl: typeof fetch = fetch) {
  const base = env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key || !isSecretKey(key)) return null
  // A legacy key is a JWT and goes in Authorization too; a newer secret key only
  // goes in apikey, and the gateway turns it into the service role.
  const service: Record<string, string> = key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key }

  async function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const res = await fetchImpl(base + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...service, ...init.headers },
    })
    const text = await res.text()
    const body = text ? safeJson(text) : null
    if (!res.ok) {
      const b = (body ?? {}) as Record<string, unknown>
      throw new SupabaseError(res.status, String(b.msg ?? b.message ?? b.error_description ?? b.error ?? `Supabase ${res.status}`))
    }
    return body
  }

  const toSession = (b: unknown): Session => {
    const s = b as { access_token: string; refresh_token: string; expires_in: number; user: { id: string; email: string } }
    return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresIn: s.expires_in, user: { id: s.user.id, email: s.user.email } }
  }

  return {
    /** Email a sign-in link (creating the account if it's new). The link returns to `redirectTo` with ?code=. */
    async sendLink(email: string, redirectTo: string, codeChallenge: string) {
      await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirectTo)}`, {
        method: 'POST',
        body: JSON.stringify({ email, create_user: true, code_challenge: codeChallenge, code_challenge_method: 's256' }),
      })
    },
    /** The ?code= from a sign-in link, plus the verifier this browser kept, for a session. */
    async exchangeCode(code: string, verifier: string) {
      return toSession(await call('/auth/v1/token?grant_type=pkce', { method: 'POST', body: JSON.stringify({ auth_code: code, code_verifier: verifier }) }))
    },
    async refresh(refreshToken: string) {
      return toSession(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }))
    },
    /** The user an access token belongs to, or null if it's expired or revoked. */
    async user(accessToken: string): Promise<User | null> {
      try {
        const u = (await call('/auth/v1/user', { headers: { Authorization: `Bearer ${accessToken}` } })) as { id: string; email: string }
        return { id: u.id, email: u.email }
      } catch (e) {
        if (e instanceof SupabaseError && (e.status === 401 || e.status === 403)) return null
        throw e
      }
    },
    async signOut(accessToken: string) {
      await call('/auth/v1/logout?scope=local', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {})
    },
    /** Delete the user; their ledger goes with them (on delete cascade). */
    async deleteUser(id: string) {
      await call(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    async balance(userId: string) {
      return Number(await call('/rest/v1/rpc/credit_balance', { method: 'POST', body: JSON.stringify({ p_user: userId }) }))
    },
    /** Credit a Paddle purchase, once per transaction. Returns the balance afterwards. */
    async grantPurchase(userId: string, transactionId: string, credits: number, details: Record<string, unknown>) {
      return Number(await call('/rest/v1/rpc/grant_purchase', { method: 'POST', body: JSON.stringify({ p_user: userId, p_transaction: transactionId, p_credits: credits, p_details: details }) }))
    },
    /**
     * Take back up to `credits` of a purchase for one Paddle adjustment (refund or
     * chargeback): once per adjustment, never more in total than the purchase gave.
     * Null if there's no such purchase.
     */
    async reversePurchase(transactionId: string, adjustmentId: string, credits: number, details: Record<string, unknown>) {
      const b = await call('/rest/v1/rpc/reverse_purchase', { method: 'POST', body: JSON.stringify({ p_transaction: transactionId, p_adjustment: adjustmentId, p_credits: credits, p_details: details }) })
      return b === null ? null : Number(b)
    },
    /** Cancel the hold for a refund Paddle rejected: the credits come back, once. Null if nothing was held. */
    async releaseReversal(adjustmentId: string, details: Record<string, unknown>) {
      const b = await call('/rest/v1/rpc/release_reversal', { method: 'POST', body: JSON.stringify({ p_adjustment: adjustmentId, p_details: details }) })
      return b === null ? null : Number(b)
    },
    /** The purchase row for a Paddle transaction, if any. */
    async purchase(transactionId: string) {
      const rows = (await call(`/rest/v1/credit_ledger?select=user_id,delta,details&reason=eq.purchase&paddle_transaction_id=eq.${encodeURIComponent(transactionId)}`)) as { user_id: string; delta: number; details: Record<string, unknown> }[]
      return rows[0] ?? null
    },
    /** Pay for an HD run: the ledger row's id, or null when the balance is too low. Serialised per user. */
    async spendCredits(userId: string, credits: number, details: Record<string, unknown>): Promise<number | null> {
      const b = await call('/rest/v1/rpc/spend_credits', { method: 'POST', body: JSON.stringify({ p_user: userId, p_credits: credits, p_details: details }) })
      return b === null ? null : Number(b)
    },
    /** Give back an HD run's credits when it failed. Once per use. */
    async refundUse(useId: number) {
      return Number(await call('/rest/v1/rpc/refund_use', { method: 'POST', body: JSON.stringify({ p_use: useId }) }))
    },

    // ---- HD runs (public.hd_runs) and their files (storage bucket "hd") ----
    async createRun(run: Omit<HdRun, 'id' | 'status' | 'use_id' | 'parts_out' | 'result_type' | 'error' | 'created_at' | 'finished_at' | 'cleaned_at'>): Promise<HdRun> {
      const rows = (await call('/rest/v1/hd_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(run) })) as HdRun[]
      return rows[0]
    },
    async run(id: string): Promise<HdRun | null> {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return null
      const rows = (await call(`/rest/v1/hd_runs?id=eq.${id}&select=*`)) as HdRun[]
      return rows[0] ?? null
    },
    /** Update a run; with `from`, only if its status is still `from` (so two requests can't both start it). Returns whether a row changed. */
    async updateRun(id: string, patch: Partial<HdRun>, from?: HdRun['status']): Promise<boolean> {
      const rows = (await call(`/rest/v1/hd_runs?id=eq.${id}${from ? `&status=eq.${from}` : ''}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) })) as HdRun[]
      return rows.length > 0
    },
    /** How many HD runs started since `since` (ISO), for everyone or one user, optionally only those in some statuses. */
    async countRuns(since: string, userId?: string, statuses?: HdRun['status'][]): Promise<number> {
      const q = [`created_at=gte.${encodeURIComponent(since)}`, userId ? `user_id=eq.${userId}` : '', statuses ? `status=in.(${statuses.join(',')})` : '', 'select=id'].filter(Boolean).join('&')
      const res = await fetchImpl(`${base}/rest/v1/hd_runs?${q}`, { method: 'HEAD', headers: { ...service, Prefer: 'count=exact' } })
      if (!res.ok) throw new SupabaseError(res.status, `Supabase ${res.status}`)
      return Number(res.headers.get('content-range')?.split('/')[1] ?? 0)
    },
    /** Runs whose files may still be in storage and that started before `before`. */
    async staleRuns(before: string): Promise<HdRun[]> {
      return (await call(`/rest/v1/hd_runs?cleaned_at=is.null&created_at=lt.${encodeURIComponent(before)}&select=*&limit=200`)) as HdRun[]
    },
    async putFile(path: string, bytes: Uint8Array, contentType: string) {
      const res = await fetchImpl(`${base}/storage/v1/object/hd/${path}`, { method: 'POST', headers: { ...service, 'Content-Type': contentType, 'x-upsert': 'true' }, body: bytes as unknown as BodyInit })
      if (!res.ok) throw new SupabaseError(res.status, `Storage ${res.status}: ${(await res.text()).slice(0, 200)}`)
    },
    async getFile(path: string): Promise<Uint8Array | null> {
      const res = await fetchImpl(`${base}/storage/v1/object/hd/${path}`, { headers: service })
      if (res.status === 404 || res.status === 400) return null
      if (!res.ok) throw new SupabaseError(res.status, `Storage ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    async deleteFiles(paths: string[]) {
      if (!paths.length) return
      await call('/storage/v1/object/hd', { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) })
    },
    async ledger(userId: string, limit = 100) {
      const q = `select=id,delta,reason,details,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`
      return (await call(`/rest/v1/credit_ledger?${q}`)) as LedgerEntry[]
    },
  }
}

/**
 * A secret key, not a publishable one: `sb_secret_…`, or a legacy JWT whose role
 * is service_role. The anon/publishable key signs people in fine but can't
 * touch the ledger, which fails later and less clearly ("permission denied").
 */
export function isSecretKey(key: string) {
  if (key.startsWith('sb_secret_')) return true
  if (!key.startsWith('eyJ')) return false
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'))
    return payload.role === 'service_role'
  } catch {
    return false
  }
}

export type Supabase = NonNullable<ReturnType<typeof supabase>>

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 200) }
  }
}
