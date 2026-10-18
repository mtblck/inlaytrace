---
order: 9
---

# Privacy and security

## Nothing leaves your device

The image is decoded, traced, edited and exported in your browser. There is no
upload, no server step, no analytics and no third-party script. Tracing runs in
a Web Worker; SVGO and paper.js are loaded from the same site, on first use.

## What's kept in your browser

So a reload or a closed tab doesn't lose work, the current session is kept in
**this browser's own storage** (IndexedDB): the original image file, the trace
settings and your edits. It never leaves the device and isn't shared with
other sites. The image is stored once it has traced (so one that can't be
traced is never brought back), and the settings and edits as you work. A note
under the file name appears once it's saved. *Start over* (beside *Replace*)
asks, then deletes it; so does clearing this site's data in your browser. A
private window keeps nothing after it closes. Saved data is checked on the
way back in, like everything else that becomes markup.
Your light/dark theme and overlay colours are kept in localStorage.

Saving is best-effort: if the browser refuses storage (some private modes,
full disks, blocked site data), the tool works as before and simply doesn't
restore.

## A strict content security policy

The page allows scripts only from itself, plus `'wasm-unsafe-eval'` for
VTracer's WebAssembly and `worker-src 'self' blob:` for the worker. No inline
scripts, and no `eval`: paper.js is the core build, which has none.

The policy is **tested, not trusted**. Without the two allowances the page
loads, accepts a drop and never traces. So:

- `npm run hosting:check` fails the build if either goes missing.
- `npm run preview` serves the real headers from `vercel.json`, so local testing
  runs under the production policy.
- `npm run verify` fails on any CSP violation in the console.

## Untrusted output stays out of the markup

The trace is shown inline (overlays and hit targets need real DOM paths), so
everything that becomes markup is checked first:

- Every `d`, `fill` and `transform` is validated against what the tracers emit.
- Edited path data is validated once per shape before it's drawn.
- Recolours and the background are normalised hex, or ignored.

## Hosting

The site and the app are one Vercel project at inlaytrace.com: the landing
page and docs at the root, the app at `/app/`, each with its own security
policy. The app's old address, mattblack.space/tools/img-to-svg/, redirects
there permanently.
