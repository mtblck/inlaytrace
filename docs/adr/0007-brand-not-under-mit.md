---
public: true
---

# 0007: The Inlay name and logos are not under the code's MIT licence

- **Status:** Accepted
- **Date:** 2026-11-28
- **PR:** https://github.com/mtblck/inlaytrace/pull/264

## Context

The repo is MIT, and until now nothing said otherwise about `brand/`, so the
logos, icons and brand kit were licensed as freely as the code: anyone could
ship a fork or product called Inlay with our mark. MIT has no trademark carve-out
of its own (Apache 2.0 section 6 does). The brand-kit plugin (1.6+) now writes a
brand licence into every kit by default.

## Decision

Everything in `brand/` (and its copies: the favicons and app icons in
`apps/*/public/`, the header marks) is all rights reserved under
`brand/LICENSE`, with `brand/TRADEMARKS.md` saying what anyone may do without
asking (talk about Inlay, say "works with", link with the unmodified logo, keep
the files unchanged in a fork). The README's Licence section says so. The root
`LICENSE` stays the plain MIT text, so GitHub and npm still detect it.

## Consequences

Forks must rename and use their own mark; the code stays fully MIT. Someone who
reads only the root `LICENSE` won't see the exception, which is why the README
and CLAUDE.md state it. Revisit if Inlay becomes a community project that wants
a shared mark (for example CC BY for `brand/`).
