/** The account page's calls to Inlay's own /api (server/api.ts). Cookies carry the session. */

export type LedgerEntry = { id: number; delta: number; reason: string; details: Record<string, unknown>; created_at: string }
export type AccountData = { email: string; balance: number; ledger: LedgerEntry[] }
type AccountResponse = ({ signedIn: true } & AccountData) | { signedIn: false }

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/${path}`, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new ApiError(0, "Couldn't reach Inlay. Check your connection and try again.")
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Something went wrong (${res.status}).`, data.code)
  return data as T
}

export const api = {
  account: () => call<AccountResponse>('account'),
  start: (email: string) => call<void>('auth/start', { email }),
  exchange: (code: string) => call<{ email: string }>('auth/exchange', { code }),
  signOut: () => call<void>('auth/signout', {}),
  deleteAccount: () => call<void>('account/delete', { confirm: true }),
  portal: () => call<{ url: string }>('account/portal', {}),
  checkoutConfig: () => call<CheckoutConfig>('checkout/config'),
  checkout: (priceId: string) => call<{ transactionId: string }>('checkout', { priceId }),
}

export type Pack = { priceId: string; credits: number; price: string }
export type CheckoutConfig = { environment: 'sandbox' | 'production'; token: string; packs: Pack[] }

/** A ledger row in words. */
export function describe(e: LedgerEntry): string {
  switch (e.reason) {
    case 'purchase':
      return `Bought ${e.delta} credits`
    case 'use':
      return typeof e.details.what === 'string' ? `HD: ${e.details.what}` : 'HD run'
    case 'refund_use':
      return 'Credits back for an HD run that failed'
    case 'reversal':
      return 'Refund: credits taken back'
    case 'adjustment':
      return e.details.released_adjustment ? 'Refund declined: credits returned' : 'Adjustment'
    default:
      return 'Adjustment'
  }
}
