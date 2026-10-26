---
public: false
---

# 0001: Count page views with Vercel Web Analytics

- **Status:** Accepted
- **Date:** 2026-10-26
- **PR:** [#137](https://github.com/mtblck/inlaytrace/pull/137)

## Context

Matt wants to know how many people use each of his apps, on one private page
(mattblack.space/analytics), at no cost. Inlay promised "no analytics", with a
strict CSP (`script-src 'self'`). Google Analytics would need cookies, a consent
banner and a third-party origin.

## Decision

We load Vercel Web Analytics from our own origin through two identical loaders,
`apps/app/public/analytics.js` and `apps/site/public/analytics.js` (skipped on
localhost). It sets no cookies, stores nothing in the browser and never sees
images. The privacy page lists every field it records.

## Consequences

- The CSP is unchanged: the script and its beacon are same-origin.
- The two loaders must stay identical.
- Anything that adds cookies, storage or a third-party origin needs a new ADR
  and a consent decision.
