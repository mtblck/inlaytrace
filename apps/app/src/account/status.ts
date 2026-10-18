import { useSyncExternalStore } from 'react'
import { api } from './api'

/**
 * Who's signed in, for the app's header: one small request on load (no cookies
 * means the server asks no one), again when the tab comes back into view (after
 * buying credits in another tab, say) or back online, and after anything that spends credits.
 * `unknown` only until the first answer, so a signed-in person doesn't see
 * "Sign in" flash first; if /api can't be reached it falls back to signed out,
 * so the header still offers sign-in rather than nothing.
 */
export type AccountStatus = { kind: 'unknown' } | { kind: 'signedOut' } | { kind: 'signedIn'; email: string; balance: number }

let status: AccountStatus = { kind: 'unknown' }
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null

function set(next: AccountStatus) {
  status = next
  for (const l of listeners) l()
}

export function refreshAccount(): Promise<void> {
  // The installed app works offline; don't knock on a door that isn't there.
  if (!navigator.onLine) {
    if (status.kind === 'unknown') set({ kind: 'signedOut' })
    return Promise.resolve()
  }
  inflight ??= api
    .accountSummary()
    .then((a) => set(a.signedIn ? { kind: 'signedIn', email: a.email, balance: a.balance } : { kind: 'signedOut' }))
    .catch(() => {
      if (status.kind === 'unknown') set({ kind: 'signedOut' })
    })
    .finally(() => (inflight = null))
  return inflight
}

/** Set the balance from an answer already in hand, without asking again. */
export function setBalance(email: string, balance: number) {
  set({ kind: 'signedIn', email, balance })
}

function subscribe(l: () => void) {
  if (listeners.size === 0) {
    void refreshAccount()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
  }
  listeners.add(l)
  return () => {
    listeners.delete(l)
    if (listeners.size === 0) {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void refreshAccount()
}

export function useAccountStatus(): AccountStatus {
  return useSyncExternalStore(subscribe, () => status)
}
