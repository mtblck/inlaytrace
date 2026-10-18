import { useEffect, useState, type FormEvent } from 'react'
import { api, describe, type AccountData } from './api'

type View = { kind: 'loading'; note?: string } | { kind: 'signedOut'; error?: string } | { kind: 'sent'; email: string } | { kind: 'signedIn'; data: AccountData } | { kind: 'deleted' } | { kind: 'unavailable'; error: string }

/**
 * The account page (/app/account/): sign in by emailed link, see credits and
 * their history, sign out, delete the account. Sign-in links land here with
 * ?code=, which the server exchanges for a session.
 */
export default function Account() {
  const [view, setView] = useState<View>({ kind: 'loading' })

  useEffect(() => {
    void (async () => {
      const url = new URL(location.href)
      const params = new URLSearchParams(url.search + '&' + url.hash.slice(1))
      const code = params.get('code')
      const linkError = params.get('error_description')
      if (code || linkError) history.replaceState(null, '', url.pathname)
      if (linkError) return setView({ kind: 'signedOut', error: linkError.includes('expired') || linkError.includes('invalid') ? 'That sign-in link has expired or was already used. Ask for a new one.' : linkError })
      if (code) {
        setView({ kind: 'loading', note: 'Signing you in…' })
        try {
          await api.exchange(code)
        } catch (e) {
          return setView({ kind: 'signedOut', error: e instanceof Error ? e.message : String(e) })
        }
      }
      await load()
    })()
  }, [])

  async function load() {
    try {
      const a = await api.account()
      setView(a.signedIn ? { kind: 'signedIn', data: a } : { kind: 'signedOut' })
    } catch (e) {
      setView({ kind: 'unavailable', error: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="min-h-full">
      <header className="flex items-center justify-between border-b border-rule px-5 py-3">
        <a href="/app/" className="font-display text-[22px] leading-none">
          Inlay
        </a>
        <a href="/app/" className="text-[13px] text-ink-muted hover:text-ink">
          Back to the app
        </a>
      </header>
      <main className="mx-auto w-[min(560px,calc(100vw-32px))] py-10">
        <h1 className="font-display text-[34px] leading-tight">Account</h1>
        {view.kind === 'loading' && (
          <p className="mt-6 text-ink-muted" aria-live="polite">
            {view.note ?? 'Loading…'}
          </p>
        )}
        {view.kind === 'signedOut' && <SignIn error={view.error} onSent={(email) => setView({ kind: 'sent', email })} />}
        {view.kind === 'sent' && <Sent email={view.email} onBack={() => setView({ kind: 'signedOut' })} />}
        {view.kind === 'signedIn' && <SignedIn data={view.data} onSignedOut={() => setView({ kind: 'signedOut' })} onDeleted={() => setView({ kind: 'deleted' })} />}
        {view.kind === 'deleted' && (
          <p className="mt-6" role="status">
            Your account is deleted. The app still works as before, no account needed.
          </p>
        )}
        {view.kind === 'unavailable' && (
          <p className="mt-6" role="alert">
            {view.error}
          </p>
        )}
      </main>
    </div>
  )
}

function SignIn(props: { error?: string; onSent: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(props.error)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api.start(email)
      props.onSent(email.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="mt-3 text-ink-muted">You only need an account to buy credits for HD mode. Tracing in the app is free and never needs one.</p>
      <form className="mt-8 flex flex-col gap-2" onSubmit={submit}>
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 text-[14px] outline-none focus-visible:border-accent"
          />
          <button className="btn btn-primary" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </div>
        <p className="field-hint">No password. The link signs you in on this browser.</p>
        {error && (
          <p className="mt-2 text-[14px]" role="alert">
            {error}
          </p>
        )}
      </form>
    </>
  )
}

function Sent(props: { email: string; onBack: () => void }) {
  return (
    <div className="mt-6" role="status">
      <p>
        Check your email. We sent a sign-in link to <strong className="font-medium">{props.email}</strong>.
      </p>
      <p className="mt-2 text-ink-muted">Open it in this browser. It works once and expires after an hour.</p>
      <button className="btn mt-6" onClick={props.onBack}>
        Use a different email
      </button>
    </div>
  )
}

function SignedIn(props: { data: AccountData; onSignedOut: () => void; onDeleted: () => void }) {
  const { email, balance, ledger } = props.data
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function act(fn: () => Promise<void>, then: () => void) {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
      then()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <p className="mt-3 text-ink-muted">
        Signed in as <span className="text-ink">{email}</span>
      </p>

      <section className="mt-8 rounded-lg border border-rule p-5" aria-labelledby="credits">
        <h2 id="credits" className="field-label">
          Credits
        </h2>
        <p className="mt-2 font-display text-[48px] leading-none tabular-nums" data-balance>
          {balance}
        </p>
        <p className="field-hint mt-3">Credits pay for HD mode and never expire.</p>
        <a href="/app/buy/" className="btn btn-primary mt-4">
          Buy credits
        </a>
      </section>

      <section className="mt-8" aria-labelledby="history">
        <h2 id="history" className="field-label">
          History
        </h2>
        {ledger.length === 0 ? (
          <p className="field-hint mt-2">Nothing yet. Purchases and HD runs will show here.</p>
        ) : (
          <table className="mt-2 w-full text-[13.5px]">
            <tbody className="divide-y divide-rule-soft">
              {ledger.map((e) => (
                <tr key={e.id}>
                  <td className="py-2 pr-4 whitespace-nowrap text-ink-muted">{new Date(e.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="py-2 pr-4">{describe(e)}</td>
                  <td className="num py-2 text-right whitespace-nowrap">{e.delta > 0 ? `+${e.delta}` : `−${-e.delta}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="field-hint mt-3">Receipts for purchases are emailed by Paddle, which handles payments for Inlay.</p>
        {ledger.some((e) => e.reason === 'purchase') && (
          <button className="btn mt-3" disabled={busy} onClick={() => act(async () => void location.assign((await api.portal()).url), () => {})}>
            Receipts and invoices
          </button>
        )}
      </section>

      <div className="mt-10 flex flex-wrap gap-2">
        <button className="btn" disabled={busy} onClick={() => act(api.signOut, props.onSignedOut)}>
          Sign out
        </button>
      </div>

      <section className="mt-12 border-t border-rule pt-6" aria-labelledby="delete">
        <h2 id="delete" className="field-label">
          Delete account
        </h2>
        <p className="field-hint mt-1">
          Removes your email, credits and history from Inlay. Unused credits can't be brought back. Paddle keeps its own record of purchases, as the law requires for tax.
        </p>
        {confirming ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => act(api.deleteAccount, props.onDeleted)}>
              Delete my account
            </button>
            <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <button className="btn mt-4" onClick={() => setConfirming(true)}>
            Delete account…
          </button>
        )}
      </section>

      {error && (
        <p className="mt-4 text-[14px]" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
