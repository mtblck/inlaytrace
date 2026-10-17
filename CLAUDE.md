# Inlay

Image → SVG in the browser (`apps/app`, live at https://mattblack.space/tools/img-to-svg/)
and the tracer behind it, `inlaytrace` (`packages/inlay`). Being prepared to go public
as `mtblck/inlaytrace` on inlaytrace.com: see `docs/launch-plan.md` and tickets #58–#61, #55.
Until then follow the `portfolio-tool` skill for hosting. README has the design notes and measurements.
One npm workspace: run every command from the repo root.

## Commands

`npm test` · `npm run build` · `npm run preview` then `npm run verify [url]` · `npm run score`
(real-browser E2E; `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
in Claude's cloud sandbox, where the Playwright CDN is blocked).

CI and Claude review run on PRs (`.github/workflows/`; playbook in mtblck/boards `docs/ci.md`).
Open PRs as drafts and mark them ready only when the work is done: that triggers the Claude review.

## Load-bearing decisions

- **Client-only.** Tracing runs in a Web Worker (`apps/app/src/engine/`). Images never leave the device.
- **Layout:** `apps/app` (Vite root; its config sets `root`, so scripts run it from the repo root with
  `-c apps/app/vite.config.ts`), `packages/inlay`, root `vitest.config.ts` running both as projects.
- **Inlay, our shared-edge tracer, does Logo/Illustration/Line art/Pixel art** (`packages/inlay/src/inlay.ts`,
  fitting in `packages/inlay/src/fit.ts`): each colour boundary traced and fitted once, so shapes tile
  exactly. Run `npm run score` before shipping any tracer, fitter or preset change.
- **Inlay is a workspace package** (`packages/inlay`, `inlaytrace`, `"private": true` until
  it's published; see #55). Keep it free of DOM and app imports; the app imports it by name.
  Its tests run with the app's (`npm test`); `npm run lint` type-checks it on its own.
- **VTracer 1.0 (Poster only) via `scripts/vendor-vtracer.mjs`**, which rewrites the official Node
  package's glue to browser ESM. Output in `apps/app/src/engine/vtracer/` is generated and
  gitignored. Bumping the package means re-checking that script's substitutions.
- **Logo/Illustration palettes come from histogram peaks** (`packages/inlay/src/palette.ts`),
  not VTracer's quantizer, which drifts flat colours. Poster keeps the quantizer.
  Re-score any preset change against clean art before shipping; see README table.
- **No GPL/AGPL in the bundle** (no Potrace, no `@imgly/*`); AI weights must be
  MIT/BSD/Apache. Repo is MIT.
- **Paths:** Vite `base` is `/tools/img-to-svg/` and the build goes to the root's `dist/tools/img-to-svg`,
  so it serves identically on its own Vercel URL and through mb-portfolio's rewrite. At the
  inlaytrace.com cutover (#61) `BASE` in `apps/app/vite.config.ts` becomes `/app/`.
- **CSP** needs `'wasm-unsafe-eval'` + `worker-src 'self'`; `hosting:check` guards it.
- **Edits = `{ inks, doc }`** (`apps/app/src/lib/doc.ts`): ink edits keyed by traced hex; `doc` null
  until a geometric edit detaches it, then settings changes must confirm. paper.js is
  lazy-loaded for mirror only; keep it out of the main chunk.
- No Supabase. A future paid "HD" mode is a Vercel Function with spend caps.
- **Commit as `mtblck <105079242+mtblck@users.noreply.github.com>`.** Vercel blocks
  deploys whose author email isn't linked to Matt's account (seen on mb-portfolio).
