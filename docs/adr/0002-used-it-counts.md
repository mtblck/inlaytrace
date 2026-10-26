---
public: false
---

# 0002: Count finished traces and downloads through mattblack.space

- **Status:** Accepted
- **Date:** 2026-10-26
- **PR:** (this PR)

## Context

Page views (ADR 0001) say who came, not who traced anything. Vercel's free
plan has no custom events. Boards now runs one shared counter for every app,
`POST mattblack.space/boards/api/events` (mtblck/boards ADR 0003), which keeps
per-day totals and nothing about visitors. The app's CSP is `connect-src 'self'`
and should stay that way.

## Decision

The app sends `traced` (once per image per page load, not per retrace) and
`downloaded` (every export) with `navigator.sendBeacon` to `/_mb/events`, which
`vercel.json` rewrites to the shared counter. The body is the project and event
name only.

## Consequences

- The CSP is unchanged, and the request is same-origin, so content blockers
  that drop third-party analytics don't skew the counts much.
- Counting is skipped off inlaytrace.com, so localhost, previews and tests never count.
- A new event needs its name in Boards' projects.json first; until then the
  counter answers 400 and nothing is counted.
