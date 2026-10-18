# Inlay

Image → SVG in the browser (`apps/app`, live at https://inlaytrace.com/app/)
and the tracer behind it, `inlaytrace` (`packages/inlay`, on npm). Public repo `mtblck/inlaytrace`
(renamed from img-to-svg); site and docs at https://inlaytrace.com. History: `docs/launch-plan.md`.
`docs/design-notes.md` has the design notes and measurements; README is the public front door.
One npm workspace: run every command from the repo root.

## Commands

`npm test` · `npm run build` · `npm run preview` then `npm run verify [url]` · `npm run score` ·
`npm run site:dev` · `npm run site:assets` after any tracer change (landing-page numbers)
(real-browser E2E; `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
in Claude's cloud sandbox, where the Playwright CDN is blocked).

CI and Claude review run on PRs (`.github/workflows/`; playbook in mtblck/boards `docs/ci.md`).
Open PRs as drafts and mark them ready only when the work is done: that triggers the Claude review.

## Load-bearing decisions

- **Client-only.** Tracing runs in a Web Worker (`apps/app/src/engine/`). Images never leave the device.
- **Layout:** `apps/app` (Vite root; its config sets `root`, so scripts run it from the repo root with
  `-c apps/app/vite.config.ts`), `apps/site` (Astro + Starlight: landing at `/`, docs at `/docs/`),
  `packages/inlay`, root `vitest.config.ts` running app and package as projects.
- **Docs live in `docs/`** (Boards reads them); `scripts/sync-docs.mjs` copies them into the site
  at build time. Never edit `apps/site/src/content/docs/docs/` (generated, gitignored).
- **Inlay, our shared-edge tracer, does every preset** (`packages/inlay/src/inlay.ts`,
  fitting in `packages/inlay/src/fit.ts`): each colour boundary traced and fitted once, so shapes tile
  exactly. Run `npm run score` before shipping any tracer, fitter or preset change.
- **Inlay is a workspace package** (`packages/inlay`, published to npm as `inlaytrace`; #55). Keep it free
  of DOM and app imports. The app and the site import it by name, aliased to its `src/` (app Vite config +
  tsconfig paths, site astro.config), so no build in the dev loop; npm gets `dist/` from tsdown
  (`npm run build -w packages/inlay`, `check` runs publint + attw, `test/smoke.mjs` loads it in plain Node).
  Releases: a changeset per user-visible change; `npm run version-packages` PR; merging *stages* it (release.yml,
  trusted publishing, stage-only); Matt approves with 2FA (`npm stage approve`), then a re-run tags it. Root devDeps pin `@emnapi/core`/`@emnapi/runtime` (optional peers of tsdown's
  compiler): without them npm versions disagree about the lockfile and `npm ci` fails on some (10, 11.4, 11.7).
- **VTracer is a benchmark only** (devDependency `@visioncortex/vtracer`, loaded in Node by `scripts/vtracer.mjs`):
  `score`, `score:photos`, `site:assets` and two tests compare against it. The app ships no WebAssembly.
- **Logo/Illustration palettes come from histogram peaks** (`packages/inlay/src/palette.ts`),
  (VTracer's quantizer drifted flat colours). Poster quantizes (`quantizePalette`, k-means in OKLab) and stacks
  shapes (`stacked`). Re-score any preset change (`score`, and `score:photos` for Poster) before shipping.
- **No GPL/AGPL in the bundle** (no Potrace, no `@imgly/*`); AI weights must be
  MIT/BSD/Apache. Repo is MIT.
- **Paths:** one Vercel project (`img-to-svg`) at inlaytrace.com: site at `/`, docs at `/docs/`, app at
  `/app/` (Vite `base`, built to the root's `dist/app`). The old `/tools/img-to-svg/(.*)` must keep
  redirecting (308, absolute) to `https://inlaytrace.com/app/$1`; `hosting:check` guards it, and
  mb-portfolio redirects mattblack.space's copy of that path the same way.
- **Two CSPs** in `vercel.json`, scoped not to overlap: the app's needs `worker-src 'self'` and must *not* allow
  `'wasm-unsafe-eval'` (it runs none); the site's allows it for Pagefind and lists a sha256 per Starlight inline script. `hosting:check` guards both, and the build's
  `--dist` pass names any new hash to add. `npm run preview` is `scripts/serve.mjs`, which mimics Vercel.
- **Edits = `{ inks, doc }`** (`apps/app/src/lib/doc.ts`): ink edits keyed by traced hex; `doc` null
  until a geometric edit detaches it, then settings changes must confirm. paper.js is
  lazy-loaded for mirror only; keep it out of the main chunk.
- No Supabase. A future paid "HD" mode is a Vercel Function with spend caps.
- **Claude commits for Matt as `mtblck <105079242+mtblck@users.noreply.github.com>`.** Vercel blocks
  deploys whose author email isn't linked to Matt's account (seen on mb-portfolio).
