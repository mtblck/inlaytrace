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
  if (!base || !key) return null
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
    async ledger(userId: string, limit = 100) {
      const q = `select=id,delta,reason,details,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${limit}`
      return (await call(`/rest/v1/credit_ledger?${q}`)) as LedgerEntry[]
    },
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
