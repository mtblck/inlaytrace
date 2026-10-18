/**
 * Paddle.js, the checkout overlay. Loaded only on this page, which is the only
 * one whose CSP allows Paddle (vercel.json); the app and the account page
 * never load it.
 */

type PaddleEvent = { name?: string; data?: unknown }
type PaddleJs = {
  Environment: { set(env: 'sandbox'): void }
  Initialize(o: { token: string; eventCallback?: (e: PaddleEvent) => void }): void
  Checkout: { open(o: { transactionId: string; settings?: Record<string, unknown> }): void; close(): void }
}

declare global {
  interface Window {
    Paddle?: PaddleJs
  }
}

export const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js'

const listeners = new Set<(e: PaddleEvent) => void>()
let ready: Promise<PaddleJs> | null = null

/** Load and initialise Paddle.js once. */
export function loadPaddle(environment: 'sandbox' | 'production', token: string): Promise<PaddleJs> {
  ready ??= new Promise<PaddleJs>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = PADDLE_JS
    s.onload = () => {
      const P = window.Paddle
      if (!P) return reject(new Error("Paddle's checkout didn't load."))
      if (environment === 'sandbox') P.Environment.set('sandbox')
      P.Initialize({ token, eventCallback: (e) => listeners.forEach((l) => l(e)) })
      resolve(P)
    }
    s.onerror = () => {
      ready = null
      reject(new Error("Paddle's checkout didn't load. Check your connection, or turn off a blocker for this page, and try again."))
    }
    document.head.append(s)
  })
  return ready
}

/** Hear Paddle's checkout events (checkout.completed, checkout.closed, …). */
export function onPaddleEvent(fn: (e: PaddleEvent) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
