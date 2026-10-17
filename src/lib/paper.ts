/**
 * paper.js is nearly as big as the rest of the app (72 vs 89 KB gzipped) and
 * only the Mirror tool needs it, so it is fetched the first time the tool is
 * opened (or applied) rather than with the page. The core build has no PaperScript and no eval, so it runs
 * under the CSP's `script-src 'self'` without 'unsafe-eval'.
 */
import type PaperNS from 'paper/dist/paper-core'

let loading: Promise<typeof PaperNS> | undefined

export function loadPaper() {
  loading ??= import('paper/dist/paper-core').then((m) => (m.default ?? m) as typeof PaperNS)
  // A failed fetch (deploy mid-session, offline) should be retryable.
  loading.catch(() => (loading = undefined))
  return loading
}
