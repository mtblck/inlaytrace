import { LegalLinks } from '../account/LegalLinks'
import { useEffect, useRef, useState } from 'react'
import { api, type CheckoutConfig, type Pack } from '../account/api'
import { loadPaddle, onPaddleEvent } from './paddle'

type View =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'unavailable'; error: string }
  | { kind: 'choose'; email: string; balance: number; config: CheckoutConfig }
  | { kind: 'adding'; pack: Pack; before: number }
  | { kind: 'added'; pack: Pack; balance: number }
  | { kind: 'slow'; pack: Pack }

/**
 * The buy page (/app/buy/): pick a pack, pay in Paddle's overlay, see the
 * credits arrive. The server creates each Paddle transaction for the signed-in
 * user; credits are added by Paddle's webhook, so this page waits for them.
 */
export default function Buy() {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const buying = useRef<{ pack: Pack; before: number } | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const account = await api.account()
        if (!account.signedIn) return setView({ kind: 'signedOut' })
        setView({ kind: 'choose', email: account.email, balance: account.balance, config: await api.checkoutConfig() })
      } catch (e) {
        setView({ kind: 'unavailable', error: e instanceof Error ? e.message : String(e) })
      }
    })()
  }, [])

  useEffect(
    () =>
      onPaddleEvent((e) => {
        if (e.name === 'checkout.closed') setBusy(null)
        if (e.name === 'checkout.completed' && buying.current) {
          const { pack, before } = buying.current
          buying.current = null
          setBusy(null)
          // Paddle's overlay would otherwise sit on top with its own "completed"
          // screen and no way back; close it so this page carries on from here.
          setTimeout(() => window.Paddle?.Checkout.close(), 1500)
          setView({ kind: 'adding', pack, before })
          void waitForCredits(before).then((balance) => setView(balance === null ? { kind: 'slow', pack } : { kind: 'added', pack, balance }))
        }
      }),
    [],
  )

  async function buy(pack: Pack, config: CheckoutConfig, balance: number) {
    setBusy(pack.priceId)
    setError(undefined)
    try {
      const [paddle, { transactionId }] = await Promise.all([loadPaddle(config.environment, config.token), api.checkout(pack.priceId)])
      buying.current = { pack, before: balance }
      const dark = document.documentElement.dataset.theme === 'dark'
      paddle.Checkout.open({ transactionId, settings: { displayMode: 'overlay', theme: dark ? 'dark' : 'light', allowLogout: false } })
    } catch (e) {
      setBusy(null)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between border-b border-rule px-5 py-3">
        <a href="/app/" className="wordmark">
          Inlay
        </a>
        <nav className="flex gap-4 text-[13px] text-ink-muted">
          <a href="/app/" className="hover:text-ink">
            Back to the app
          </a>
          <a href="/app/account/" className="hover:text-ink">
            Account
          </a>
        </nav>
      </header>
      <main className="mx-auto w-[min(640px,calc(100vw-32px))] py-10">
        <h1 className="font-display text-[34px] leading-tight">Buy credits</h1>
        {view.kind === 'loading' && <p className="mt-6 text-ink-muted">Loading…</p>}
        {view.kind === 'unavailable' && (
          <p className="mt-6" role="alert">
            {view.error}
          </p>
        )}
        {view.kind === 'signedOut' && (
          <div className="mt-6">
            <p>Sign in to buy credits. You'll get an email with a link, no password.</p>
            <a href="/app/account/" className="btn btn-primary mt-6">
              Sign in
            </a>
          </div>
        )}
        {view.kind === 'choose' && (
          <>
            <p className="mt-3 text-ink-muted">
              Credits pay for HD mode. Each HD run uses 1 to 4 credits, depending on the image's size, and the app shows the cost before it runs. Credits never expire. You have{' '}
              <span className="text-ink">{view.balance}</span>.
            </p>
            {view.config.environment === 'sandbox' && (
              <p className="mt-4 rounded-md border border-rule bg-paper-sunk px-3 py-2 text-[13px]">
                Test mode: no real payment is taken. Pay with card 4242 4242 4242 4242, any future date and any CVC.
              </p>
            )}
            <ul className="mt-8 grid gap-3 sm:grid-cols-3" aria-label="Credit packs">
              {view.config.packs.map((p) => (
                <li key={p.priceId} className="flex flex-col rounded-lg border border-rule p-4">
                  <p className="font-display text-[34px] leading-none">{p.credits}</p>
                  <p className="field-hint">credits</p>
                  <p className="mt-4 text-[18px]">{p.price}</p>
                  <p className="field-hint">{perCredit(p)} a credit</p>
                  <button className="btn btn-primary mt-4" disabled={busy !== null} onClick={() => buy(p, view.config, view.balance)}>
                    {busy === p.priceId ? 'Opening…' : `Buy ${p.credits}`}
                  </button>
                </li>
              ))}
            </ul>
            <p className="field-hint mt-6">
              Payments are handled by Paddle, our reseller and Merchant of Record: it charges any sales tax or VAT and emails your receipt. You're buying as {view.email}. Buying means agreeing to the{' '}
              <a href="/terms/" className="underline">
                terms
              </a>
              ; you can have a full refund within 30 days (
              <a href="/refunds/" className="underline">
                refund policy
              </a>
              ).
            </p>
            {error && (
              <p className="mt-4 text-[14px]" role="alert">
                {error}
              </p>
            )}
          </>
        )}
        {view.kind === 'adding' && (
          <p className="mt-6" role="status" aria-live="polite">
            Payment received. Adding {view.pack.credits} credits…
          </p>
        )}
        {view.kind === 'added' && (
          <div className="mt-6" role="status">
            <p>
              Added {view.pack.credits} credits. You have <span className="font-medium">{view.balance}</span>.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="/app/" className="btn btn-primary">
                Back to the app
              </a>
              <a href="/app/account/" className="btn">
                Your account
              </a>
            </div>
          </div>
        )}
        {view.kind === 'slow' && (
          <div className="mt-6" role="status">
            <p>Payment received. Your {view.pack.credits} credits are on their way and will show on your account shortly; Paddle's receipt is in your email.</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="/app/" className="btn btn-primary">
                Back to the app
              </a>
              <a href="/app/account/" className="btn">
                Your account
              </a>
            </div>
          </div>
        )}
      </main>
      <LegalLinks width="w-[min(640px,calc(100vw-32px))]" />
    </div>
  )
}

const perCredit = (p: Pack) => {
  const dollars = Number(p.price.replace(/[^\d.]/g, ''))
  return `$${(dollars / p.credits).toFixed(2)}`
}

/** Poll the balance until the webhook has added the credits; null after a minute. */
async function waitForCredits(before: number): Promise<number | null> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const a = await api.account().catch(() => null)
    if (a?.signedIn && a.balance > before) return a.balance
  }
  return null
}
