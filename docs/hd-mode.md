---
order: 46
---

# HD mode: plan

A paid, opt-in trace that runs on a server, paid for with credits. Ticket
[#46](https://github.com/mtblck/inlaytrace/issues/46). Planning notes: this page
is left off the public site (`INTERNAL` in `scripts/sync-docs.mjs`).

## Decided (October 2026)

- **The free app doesn't change.** It stays in the browser, with no account and
  nothing uploaded. Everything free today stays free.
- **Credits, bought in packs.** Credits never expire. One credit isn't one image:
  the cost depends on the image's size, and the app shows it before anything is
  uploaded.
- **Buying needs an account; using the free app never does.** Accounts are
  Supabase Auth with an emailed sign-in link (no passwords). An account page shows
  the balance, HD uses and purchases, links to Paddle's portal for invoices, and
  can delete the account.
- **Paddle** is the payment processor and merchant of record (it handles sales
  tax and VAT), at 5% + 50¢ a transaction. Lemon Squeezy charges the same, but
  Stripe now steers new sellers to Stripe Managed Payments.
- **Checkout runs on our own `/buy` page**, with Paddle's overlay and a CSP that
  allows Paddle only on that page. Paddle's hosted checkout is meant for mobile
  apps and needs separate approval for live use.
- **Supabase** on a free organization (project `hjmhsrxagrquqgtfzyfx`, East US).
  Sign-in emails go through Resend from `login@inlaytrace.com`.

## Packs

One Paddle product, *Inlay HD credits*, with three one-time prices. These are the
sandbox ids; live ids come when the live account is approved.

| Pack | Price | Paddle takes | Sandbox price id |
| --- | --- | --- | --- |
| 20 credits | $5 | $0.75 (15%) | `pri_01m57wybp0tek7qeg1ge41smc3` |
| 60 credits | $12 | $1.10 (9%) | `pri_01m57wz8aj07enh29xt4wfptm6` |
| 200 credits | $30 | $2.00 (7%) | `pri_01m57x08gaqsn896bvgsp0j0mr` |

For comparison: Vectorizer.ai's API charges $0.05 to $0.20 a credit, and
remove.bg charges about $0.23 to $1.00 an image.

**Proposed cost by size** (to settle with the HD trace itself): 1 credit up to
4 megapixels (about 2000 × 2000), 2 credits up to 16 MP, and 4 credits above that.

## How it fits together

- **The browser talks only to `/api`.** Vercel Functions in this project talk to
  Supabase with the service-role key. The app's CSP stays `connect-src 'self'`, and
  no Supabase or Paddle script loads in the app.
- **The ledger** (`supabase/migrations/`): one append-only `credit_ledger` table.
  A balance is the sum of a user's rows. Four functions are the only ways it
  changes, and only the server may call them:
  - `grant_purchase`: once per Paddle transaction, so a repeated webhook adds nothing.
  - `spend_credits`: serialised per user, so it never goes below zero.
  - `refund_use`: when an HD trace fails, once per use.
  - `credit_balance`: reads the balance.

  RLS is on with no policies, and the `anon` and `authenticated` roles have no
  privileges at all.
- **Paddle's webhook** (`transaction.completed`) grants the credits. The checkout
  carries the Supabase user id in `custom_data`, and every webhook's signature is
  checked against the webhook secret.
- **Paddle is the record of purchases.** The free Supabase plan has no backups, so
  purchases can be rebuilt from Paddle's transactions if needed. Free projects
  also pause after a week with no traffic; a daily Vercel cron ping keeps the
  project awake.
- **Large uploads:** a Vercel Function's request body is capped at 4.5 MB.
  Bigger images go to Supabase Storage first (1 GB on the free plan) and are
  deleted as soon as the trace is done.

## Privacy wording

"Images never leave your device" becomes true of the free app only. HD is opt-in
per image and says what happens each time it's used: the image is uploaded,
traced and deleted. An account stores an email, a balance, and a log of HD uses
(credits spent, image size, date; never the image). The privacy page and docs
change in the same PR as HD itself.

## Settings (Vercel environment variables, set by Matt)

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET` (any long random string: Vercel sends it to the daily keep-alive)
- `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENV` (`sandbox` or `production`)

Paddle's notification destination: `https://inlaytrace.com/api/paddle/webhook`,
events `transaction.completed`, `adjustment.created` and `adjustment.updated`.
A full refund or chargeback takes the pack's credits back; a partial refund
takes its share (rounded up). Only one reversal per transaction is recorded.
The balance can go below zero if the credits were already spent.

Never in the repo, never in chat.

## What HD does

All three, each priced by image size, each with a **free low-resolution
preview**: credits buy the full-resolution result, as remove.bg sells it. Only
work done on the server costs credits. Exports (SVG, PNG, PDF, EPS, DXF) stay
free: they run in the browser, in MIT code, and were promised to stay free.

- **Background removal** with BiRefNet (MIT). About 4 s for 1024 px on an M1 Max
  CPU, so perhaps 10–15 s on a Vercel Function. The ONNX model is about 220 MB,
  near the 250 MB function limit, so it may need the half-precision version.
  Compare against remove.bg on our own test images before setting a price.
- **Heavier upscaling** with Real-ESRGAN x4plus (BSD): tens of seconds to a
  couple of minutes on CPU, within Pro's function duration.
- **Very large images** traced on the server, beyond what a browser tab holds.

Each run costs well under a cent in Vercel CPU and memory. Vercel Pro (already
paid, $20 a month across Matt's projects) is required anyway, because the Hobby
plan forbids taking payments.

## Open

- **Paddle's live approval:** a pricing page, terms, a refund policy and a
  privacy policy, live on inlaytrace.com before the review.

## Tickets

[#89](https://github.com/mtblck/inlaytrace/issues/89) accounts ·
[#90](https://github.com/mtblck/inlaytrace/issues/90) buy page and webhook ·
[#91](https://github.com/mtblck/inlaytrace/issues/91) the server-side trace ·
[#92](https://github.com/mtblck/inlaytrace/issues/92) pricing, terms, refund and privacy pages
