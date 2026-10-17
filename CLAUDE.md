# img-to-svg

Browser-based raster → SVG converter at https://mattblack.space/tools/img-to-svg/.
Portfolio piece and personal tool; follow the `portfolio-tool` skill for stack,
hosting and portfolio conventions. README has the design notes and measurements.

## Commands

`npm test` · `npm run build` · `npm run preview` then `npm run verify [url]` · `npm run score`
(real-browser E2E; `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
in Claude's cloud sandbox, where the Playwright CDN is blocked).

CI and Claude review run on PRs (`.github/workflows/`; playbook in mtblck/boards `docs/ci.md`).
Open PRs as drafts and mark them ready only when the work is done: that triggers the Claude review.

## Load-bearing decisions

- **Client-only.** Tracing runs in a Web Worker (`src/engine/`). Images never leave the device.
- **Flat art (Logo/Illustration/Line art) uses our shared-edge tracer** (`src/engine/shapes.ts`,
  fitting in `src/lib/fit.ts`): each colour boundary traced and fitted once, so shapes tile
  exactly. Run `npm run score` before shipping any tracer, fitter or preset change.
- **VTracer 1.0 (Poster, Pixel art only) via `scripts/vendor-vtracer.mjs`**, which rewrites the official Node
  package's glue to browser ESM. Output in `src/engine/vtracer/` is generated and
  gitignored. Bumping the package means re-checking that script's substitutions.
- **Logo/Illustration palettes come from histogram peaks** (`src/lib/palette.ts`),
  not VTracer's quantizer, which drifts flat colours. Poster keeps the quantizer.
  Re-score any preset change against clean art before shipping; see README table.
- **No GPL/AGPL in the bundle** (no Potrace, no `@imgly/*`); AI weights must be
  MIT/BSD/Apache. Repo is MIT.
- **Paths:** Vite `base` and `outDir` are both `/tools/img-to-svg/`, so the build
  serves identically on its own Vercel URL and through mb-portfolio's rewrite.
- **CSP** needs `'wasm-unsafe-eval'` + `worker-src 'self'`; `hosting:check` guards it.
- **Edits = `{ inks, doc }`** (`src/lib/doc.ts`): ink edits keyed by traced hex; `doc` null
  until a geometric edit detaches it, then settings changes must confirm. paper.js is
  lazy-loaded for mirror only; keep it out of the main chunk.
- No Supabase. A future paid "HD" mode is a Vercel Function with spend caps.
- **Commit as `mtblck <105079242+mtblck@users.noreply.github.com>`.** Vercel blocks
  deploys whose author email isn't linked to Matt's account (seen on mb-portfolio).
