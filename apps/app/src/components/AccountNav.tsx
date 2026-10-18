import { useAccountStatus } from '../account/status'

const PersonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
    <circle cx="8" cy="5.5" r="2.75" />
    <path d="M2.75 14c.6-2.6 2.75-4.25 5.25-4.25s4.65 1.65 5.25 4.25" strokeLinecap="round" />
  </svg>
)

/**
 * The header's account corner: "Sign in" when signed out; the credit balance
 * (a link to buy more) and the account page when signed in. Nothing until the
 * first answer, so the two states don't flicker.
 */
export function AccountNav() {
  const s = useAccountStatus()
  if (s.kind === 'unknown') return <span className="w-20" aria-hidden />
  if (s.kind === 'signedOut') {
    return (
      <a href="/app/account/" className="btn ml-1 h-8 px-3 no-underline" data-account="signed-out">
        <PersonIcon />
        Sign in
      </a>
    )
  }
  const credits = `${s.balance.toLocaleString()} credit${s.balance === 1 ? '' : 's'}`
  return (
    <div className="ml-1 flex items-center gap-1" data-account="signed-in">
      <a
        href="/app/buy/"
        className="num rounded-md px-2 py-1.5 text-ink no-underline hover:bg-paper-sunk"
        title="Your HD credits. Buy more"
        aria-label={`${credits}. Buy more`}
        data-balance
      >
        {credits}
      </a>
      <a href="/app/account/" className="btn h-8 px-3 no-underline" title={s.email}>
        <PersonIcon />
        <span className="hidden sm:inline">Account</span>
        <span className="sr-only sm:hidden">Account</span>
      </a>
    </div>
  )
}
