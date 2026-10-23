import { LegalLinks } from '../account/LegalLinks'
import { useEffect, useRef, useState } from 'react'
import { COST, UPSCALE } from '../../../../server/pricing'
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
  const [picked, setPicked] = useState<string | null>(null)
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
      <main className="mx-auto w-[min(760px,calc(100vw-32px))] py-10 sm:py-12">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[36px] leading-tight sm:text-[44px]">Buy credits</h1>
            {view.kind === 'choose' && <p className="mt-2 text-[16px] text-ink-muted">Credits pay for HD traces and upscales on our servers. Everything else in Inlay stays free.</p>}
          </div>
          {view.kind === 'choose' && (
            <div className="rounded-lg bg-paper-sunk px-3.5 py-2.5 text-right">
              <div className="text-[12.5px] text-ink-muted">Your balance</div>
              <div className="font-mono text-[18px]">
                {view.balance} credit{view.balance === 1 ? '' : 's'}
              </div>
            </div>
          )}
        </div>
        {view.kind === 'loading' && <p className="mt-6 text-ink-muted">Loading…</p>}
        {view.kind === 'unavailable' && (
          <p className="mt-6" role="alert">
            {view.error}
          </p>
        )}
        {view.kind === 'signedOut' && (
          <div className="mt-6">
            <p>Sign in to buy credits. You'll get an email with a link, no password.</p>
            <a href="/app/account/" className="btn btn-primary mt-6 h-11 px-5">
              Sign in
            </a>
          </div>
        )}
        {view.kind === 'choose' && <Choose config={view.config} picked={picked} onPick={setPicked} busy={busy} email={view.email} error={error} onBuy={(p) => buy(p, view.config, view.balance)} />}
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
      <LegalLinks width="w-[min(760px,calc(100vw-32px))]" />
    </div>
  )
}

/** The pack picker, the one Buy button and what an HD run costs. */
function Choose(props: { config: CheckoutConfig; picked: string | null; onPick: (priceId: string) => void; busy: string | null; email: string; error?: string; onBuy: (p: Pack) => void }) {
  const { packs } = props.config
  // The middle pack is picked until someone picks another.
  const pack = packs.find((p) => p.priceId === props.picked) ?? packs[Math.floor(packs.length / 2)]
  const best = Math.min(...packs.map(dollarsPerCredit))
  return (
    <>
      {props.config.environment === 'sandbox' && (
        <p className="mt-6 rounded-md border border-rule bg-paper-sunk px-3 py-2 text-[13px]">
          Test mode: no real payment is taken. Pay with card 4242 4242 4242 4242, any future date and any CVC.
        </p>
      )}
      <fieldset className="mt-8">
        <legend className="mb-3 text-[16px] font-bold">Choose a pack</legend>
        <ul className="grid gap-3 sm:grid-cols-3">
          {packs.map((p) => {
            const on = p === pack
            return (
              <li key={p.priceId}>
                <label className={`flex h-full cursor-pointer flex-col gap-1.5 rounded-xl p-4 sm:p-5 ${on ? 'border-2 border-ink bg-paper-sunk' : 'border border-rule hover:border-ink-faint'}`}>
                  <span className={`flex items-center gap-2.5 text-[17px] ${on ? 'font-bold' : 'font-semibold'}`}>
                    <input type="radio" name="pack" className="size-5 accent-ink" checked={on} onChange={() => props.onPick(p.priceId)} />
                    {p.credits} credits
                  </span>
                  <span className="font-display text-[30px] leading-tight">{p.price}</span>
                  <span className="text-[13.5px] text-ink-muted">
                    {perCredit(p)} a credit{packs.length > 1 && dollarsPerCredit(p) === best ? ', the best value' : ''}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>
      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
        <button className="btn btn-primary h-12 shrink-0 px-6 text-[16px]" disabled={props.busy !== null} onClick={() => props.onBuy(pack)}>
          {props.busy === pack.priceId ? 'Opening…' : `Buy ${pack.credits} credits for ${pack.price}`}
        </button>
        <p className="field-hint">
          Paddle, our reseller and Merchant of Record, takes the payment, adds any sales tax or VAT and emails your receipt. You're buying as {props.email}, and agreeing to the{' '}
          <a href="/terms/" className="underline">
            terms
          </a>
          . Credits never expire, and you can have a full refund within 30 days (
          <a href="/refunds/" className="underline">
            refund policy
          </a>
          ).
        </p>
      </div>
      {props.error && (
        <p className="mt-4 text-[14px]" role="alert">
          {props.error}
        </p>
      )}

      <h2 className="mt-12 text-[17px] font-bold">What an HD run costs</h2>
      <p className="field-hint mt-1">The app shows the cost before anything runs. If a run fails, its credits go straight back.</p>
      <table className="mt-3 w-full text-[14px]">
        <thead>
          <tr className="border-b border-rule text-left">
            <th className="py-2 pr-4 font-semibold">Run</th>
            <th className="py-2 text-right font-semibold">Credits</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-rule-soft">
          {COST.map((c) => (
            <tr key={c.label}>
              <td className="py-2 pr-4">HD trace, {c.label.charAt(0).toLowerCase() + c.label.slice(1)}</td>
              <td className="num py-2 text-right text-[13px] text-ink">{c.credits}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 pr-4">HD {UPSCALE.label.charAt(0).toLowerCase() + UPSCALE.label.slice(1)}</td>
            <td className="num py-2 text-right text-[13px] text-ink">{UPSCALE.credits}</td>
          </tr>
        </tbody>
      </table>
    </>
  )
}

const dollarsPerCredit = (p: Pack) => Number(p.price.replace(/[^\d.]/g, '')) / p.credits

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
