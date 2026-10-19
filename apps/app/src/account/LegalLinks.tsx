/**
 * The legal pages and contact, under the account and buy pages: where people
 * pay, the terms, privacy notice and refund policy are one click away (as
 * Paddle's review asks), whether or not they're signed in.
 */
export function LegalLinks({ width }: { width: string }) {
  return (
    <footer className={`mx-auto ${width} border-t border-rule py-5 text-[13px] text-ink-muted`}>
      <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-1">
        <a href="/terms/" className="hover:text-ink">
          Terms
        </a>
        <a href="/privacy/" className="hover:text-ink">
          Privacy
        </a>
        <a href="/refunds/" className="hover:text-ink">
          Refunds
        </a>
        <a href="mailto:hello@inlaytrace.com" className="hover:text-ink">
          Contact
        </a>
      </nav>
    </footer>
  )
}
