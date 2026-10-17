---
order: 9
---

# Privacy and security

## Nothing leaves your device

The image is decoded, traced, edited and exported in your browser. There is no
upload, no server step, no analytics and no third-party script. Tracing runs in
a Web Worker; SVGO and paper.js are loaded from the same site, on first use.

The only things stored are your light/dark theme and overlay colours, in your
own browser's localStorage. Images and edits aren't kept anywhere: reloading the page starts
over.

## A strict content security policy

The page allows scripts only from itself, plus `'wasm-unsafe-eval'` for
VTracer's WebAssembly and `worker-src 'self' blob:` for the worker. No inline
scripts, and no `eval`: paper.js is the core build, which has none.

The policy is **tested, not trusted**. Without the two allowances the page
loads, accepts a drop and never traces. So:

- `npm run hosting:check` fails the build if either goes missing.
- `vite preview` serves the real headers from `vercel.json`, so local testing
  runs under the production policy.
- `npm run verify` fails on any CSP violation in the console.

## Untrusted output stays out of the markup

The trace is shown inline (overlays and hit targets need real DOM paths), so
everything that becomes markup is checked first:

- Every `d`, `fill` and `transform` is validated against what the tracers emit.
- Edited path data is validated once per shape before it's drawn.
- Recolours and the background are normalised hex, or ignored.

## Hosting

The app is its own Vercel project, served under mattblack.space through a
rewrite. It's built to live at `/tools/img-to-svg/` on both domains, so the
portfolio proxies it without translating paths, and the tool owns its own
security headers.
