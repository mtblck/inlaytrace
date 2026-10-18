---
order: 9
---

# Privacy and security

## Nothing leaves your device

The image is decoded, traced, edited and exported in your browser. There is no
upload, no server step, no analytics and no third-party script. Tracing runs in
a Web Worker; SVGO and paper.js are loaded from the same site, on first use.

The one exception is [HD](hd.md), which is paid, in beta, and
happens only when you confirm it for an image: that image is uploaded, traced
at full size on Inlay's server, and deleted as soon as the result is back. The
app sends nothing to the server before you confirm, and talks only to its own
site even then.

The optional AI steps (*Remove the background*, *Upscale 4× with AI*) run in
the browser too. Their runtime (ONNX Runtime, about 3.7 MB compressed) and
models (about 4.5 MB each) are downloaded **from this site** the first time a
step is used; the image is processed on your device and nothing about it is
sent anywhere. The browser tests check that the steps contact no other site.

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
Your light/dark theme and overlay colours are kept in localStorage. The app's
own files (not your images) are cached by its service worker, so it works
offline; see [Install and offline](install-and-offline.md).

Saving is best-effort: if the browser refuses storage (some private modes,
full disks, blocked site data), the tool works as before and simply doesn't
restore.

## A strict content security policy

The app allows scripts only from itself, plus `worker-src 'self' blob:` for
the worker. No inline scripts and no `eval` (paper.js is the core build, which
has none). The page doesn't allow WebAssembly either. Only the AI worker
(background removal and upscaling) compiles any, so only that one file is
served with `'wasm-unsafe-eval'`, its policy otherwise the same as the app's.
`'wasm-unsafe-eval'` lets a script compile WebAssembly; it doesn't allow
`eval`, inline scripts or anything from another site, and the WebAssembly can
only come from this site, since `connect-src` is `'self'`. (The docs site
allows WebAssembly for its search, on its own policy.)

The policy is **tested, not trusted**. Without the worker allowance the page
loads, accepts a drop and never traces. So:

- `npm run hosting:check` fails the build if the worker allowance goes
  missing, if the page's policy allows WebAssembly, if the AI worker's policy
  differs from the app's by anything but `'wasm-unsafe-eval'`, or if the AI
  worker's file is renamed so that its policy no longer reaches it.
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
