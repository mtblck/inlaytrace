---
public: false
---

# 0004: Inlay is free; HD is shelved and tips replace it

- **Status:** Accepted
- **Date:** 2026-11-03
- **PR:** (this PR)

## Context

HD mode (`docs/hd-mode.md`, ticket #46) was built as a paid beta: a full-size
trace or a 4× upscale on our server, paid for with credit packs through Paddle,
with Supabase accounts to hold the balance. The app showed it in the export
panel, a Sign in / credits corner in the header, an account page and a buy page;
the site had Pricing and Refunds pages and Paddle wording in the terms and
privacy notice.

Matt isn't confident enough in HD's results to market or sell it yet, and would
rather Inlay be free across the board. Leaving a half-ready paid feature in front
of people costs more trust than it earns.

## Decision

We take every paid surface out of the app and the site: the HD panel, the account
corner, the account and buy pages, Pricing and Refunds, and Paddle's CSP. Their
old addresses redirect to the app or the landing page. In their place, a tip
button from Matt's `tipjar` package links to Ko-fi: inline in the app's header,
floating on the site's own pages (tucked away while the footer, with its own
support link, is on screen).

The server side (`server/`, `api/`, `supabase/migrations/`, the keep-alive cron)
stays in the repo so HD can come back without rebuilding it, but switched off:
unless the `PAID_FEATURES` environment variable is `on`, every API route except
the keep-alive and Paddle's webhook (so refunds of beta purchases still reach the
ledger) answers 410, so nobody can sign in, buy or run HD by calling it directly. The privacy notice and terms say paid features may come later,
opt-in, and set out before launch. The privacy notice also covers accounts left
from the beta (Supabase, Paddle), and the terms offer refunds of unused credits
to anyone who bought during it.

## Consequences

- The app makes no request to `/api` at all, and no page allows Paddle;
  `hosting:check` fails if a Paddle host reappears in any header or the old
  paid addresses stop redirecting.
- Bringing HD back means setting `PAID_FEATURES=on` in Vercel, restoring the client pages from git history (the
  commit that made this ADR), a new ADR superseding this one, and the privacy
  and terms sections rewritten before launch.
- The dormant server code still runs in tests and builds. If HD stays shelved
  for long, delete it rather than keep maintaining it.
