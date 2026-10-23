# Contributing

Thanks for looking. Inlay is a side project with one maintainer, so replies can
take a few days. Bug reports with an image that shows the problem are the most
useful thing you can send.

## Reporting a bug

Use the bug template. The tracer's output depends on the image, the preset and
the settings, so a report needs all three. If you can't share the image
publicly, a crop or a similar image that shows the same problem works; an
image attached to an issue is public.

## Setting up

Node 20 or newer (CI uses 24) and npm. One install covers everything (npm workspaces):

```bash
npm install
npm run dev          # the app: http://localhost:5173/app/
npm run site:dev     # the landing page and docs: http://localhost:4321/
npm test             # the app's and the package's tests, plus every preset through the real tracer
npm run build        # checks hosting config, type-checks, builds the site and the app
npm run preview      # serves the build as Vercel will: routes, redirects, security headers
npm run verify       # end-to-end in a real browser (needs `preview` running)
npm run score        # trace the sample, score each preset against the clean art
npm run score:photos # score Poster on three photos, against VTracer
npm run site:assets  # re-measure the landing page's evidence
```

Run every command from the repo root.

`verify` takes an optional URL, so the same checks run against a deployment:
`npm run verify -- https://inlaytrace.com/app/`. Set
`CHROME_PATH` to use an installed Chromium, `SHOTS=dir` to save screenshots,
and `FIXTURE=path` to also trace and edit an image of your own. It covers the
editor (overlays, node drag, marquees, move, scale, nudges, undo, mirror
symmetry measured on the exported SVG, the shortcuts panel) and then the site
(its security policy, the landing page's hero slider and links, docs search, dark
mode, phone width). It fails on any console error or CSP violation.

## Where things live

The files behind each part, for finding your way around the code.

| Path | What |
| --- | --- |
| `apps/app/src/engine/` | The worker, `runTrace` and the presets |
| `packages/inlay/src/fit.ts` | Curve fitting: corners, smoothing, lines and Béziers |
| `packages/inlay/src/palette.ts` | Palettes from histogram peaks |
| `apps/app/src/lib/doc.ts`, `history.ts`, `pathdata.ts` | The editable document, undo, path data |
| `apps/app/src/lib/mirror.ts` | Mirroring and turning with paper.js booleans; picking the likeliest detected symmetry |
| `apps/app/src/components/` | Canvas, controls, edit panel, colours |
| `scripts/` | `verify` (browser E2E), `score` and `score:photos` (quality, against VTracer as a benchmark), hosting checks |

## Changing the tracer

Anything in `packages/inlay` that changes output, or a preset in
`apps/app/src/engine/presets.ts`:

1. `npm run score` before and after, and `npm run score:photos` if it could
   touch Poster. Say what changed in the PR (wrong pixels or mean error,
   nodes, size). A change that looks better on one image can be worse on the
   sample; the score is the referee.
2. Check more than one JPEG quality. Encoders differ between browsers, and
   flaws have hidden at one quality and shown at another (see
   [measuring quality](docs/how-it-works/measuring-quality.md)).
3. `npm run site:assets` and commit `apps/site/src/data/sample.json`, so the
   landing page's numbers stay true.

Keep `packages/inlay` free of DOM and app imports; it runs in Node and workers.

## Releasing the package

The package versions with [Changesets](.changeset/README.md):

1. A PR that changes what `inlaytrace` users get adds a changeset
   (`npx changeset`): `patch` or, while the package is 0.x, `minor` for a
   breaking change, plus a line for the changelog.
2. To release, a PR runs `npm run version-packages`, which bumps the version,
   writes `packages/inlay/CHANGELOG.md` and updates the lockfile.
3. Merging it stages the release: `.github/workflows/release.yml` builds,
   tests and checks the package, then stages any version npm doesn't have yet,
   through npm trusted publishing with provenance. Nothing is public until a
   maintainer approves it with two-factor authentication (`npx npm@11.21.1 stage
   list inlaytrace`, then `npx npm@11.21.1 stage approve <id>`). Re-running the
   workflow afterwards tags it `inlaytrace@x.y.z`.
   (npm 11 on purpose: npm 12 needs Node 22.22.2+ or 24.15+ and, on older
   Node, an approval can quietly not happen.)

`npm run build -w packages/inlay` builds the package locally; `npm run check -w
packages/inlay` lints it for publishing; `node packages/inlay/test/smoke.mjs`
loads the build in plain Node. In this repo the app and the site use the
package's TypeScript source through an alias, so day-to-day work needs no
build.

## Docs

The docs are Markdown in `docs/`. The site copies them in at build time
(`scripts/sync-docs.mjs`), so edit `docs/`, never `apps/site/src/content/`.
Record measured numbers, not adjectives.

## Pull requests

- Open it as a draft while you're working; mark it ready when it's done.
- CI runs the tests, the build and the browser checks.
- Commit messages: an imperative subject, then a body saying why and how you
  checked it.
- Licences: MIT, BSD or Apache only. No GPL or AGPL code in the bundle.

By contributing you agree that your work is released under the
[MIT licence](LICENSE), and to follow the [code of conduct](CODE_OF_CONDUCT.md).
