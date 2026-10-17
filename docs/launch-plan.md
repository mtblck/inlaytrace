---
order: 45
---

# Going public: Inlay as a site, an app and a package

img-to-svg started as a tool for Matt. The tracer inside it, Inlay, is now the
interesting part: shapes that share their edges exactly, in pure TypeScript,
MIT. This plan turns the project into something worth sharing:

- a **landing page** that shows what Inlay does in a few seconds,
- the **app** (today's img-to-svg) as the hands-on demo and a real tool,
- an **npm package** with install and usage docs,

all on its own site rather than as a page under the portfolio.

**Decided (2026-10-17):** the brand is **Inlay**, and one name is used
everywhere: **`inlaytrace`** for the npm package, the repo (`mtblck/inlaytrace`,
renamed from img-to-svg and made public) and the domain (**inlaytrace.com**).

## What comparable projects do

| Project | Shape | Takeaway |
| --- | --- | --- |
| [Shiki](https://github.com/shikijs/shiki) | One monorepo: `packages/`, `docs/`, `test/`; docs site at its own domain; CONTRIBUTING, CODE_OF_CONDUCT at the root | Library and site in one repo, packages separate from the site |
| [SVGO](https://github.com/svg/svgo) | Library + CLI repo with a `docs/` folder; site at svgo.dev; the web app (SVGOMG) is a separate project | README order: why → install → CLI → config → API → license |
| [SVGcode](https://github.com/tomayac/SVGcode) | The app is the product (svgco.de); README: intro → use it → develop → credits → alternatives → license | A traced-image app sells itself with a screenshot and a link |
| [VTracer](https://cdn.jsdelivr.net/npm/vtracer-webapp@0.4.0/README.md) | Rust library, CLI and web app; the web app's README is just setup | The thinnest docs of the four; the demo carries it |

Common pattern: **one repo, packages separate from apps, the site at its own
domain, the README as a short front door that links to the docs.** Monorepo
guides ([Vercel](https://vercel.com/academy/production-monorepos/add-docs-app),
[next-forge](https://docs.next-forge.com/structure/apps)) lay it out as
`apps/*` (site, docs, app) beside `packages/*` (what gets published).

## Names

npm and domain checks on 2026-10-17:

| Name | npm | Domain |
| --- | --- | --- |
| `inlay` | Taken (a 2022 templating package) | inlay.dev, .app, .design, .studio, .so all taken |
| `@inlay/*` | Scope owned by someone else | — |
| `inlaytrace` | Free | inlaytrace.com free, $11.25/yr |
| `inlay-tracer` | Free | inlaytracer.com free, $11.25/yr |
| `@mtblck/inlay` | Free | — |
| — | — | inlay.tools free, $17.99 then $38.30/yr |

**Recommendation:** the brand is **Inlay**; one machine name everywhere,
**`inlaytrace`**: the npm package, the repo, and inlaytrace.com. Short, unique,
says what it does, and one string to remember. ("Inlay Tracer" with
`inlay-tracer` / inlaytracer.com works the same way if the longer name reads
better.)

**Keep "image to SVG" in the app's title.** It's what people search for:
"Inlay: image to SVG, in your browser". The tracer has the brand; the app keeps
the description.

**Decided:** `inlaytrace`, on its own domain.

## Site structure

One domain, three parts:

| Path | What | Built with |
| --- | --- | --- |
| `/` | Landing page | Astro (Starlight's custom pages) |
| `/docs/…` | Getting started, guides, API, how it works, the app's features | Starlight |
| `/app/` | Today's img-to-svg | The existing Vite + React app, `base: '/app/'` |

**Why Starlight:** a custom landing page and docs in one Astro site, built-in
search with no API key (Pagefind), Markdown content, and React islands where a
page needs the real component. VitePress is the fastest docs tool but is
Vue-based; Docusaurus is React but heavier
([comparison](https://www.pkgpulse.com/guides/docusaurus-vs-vitepress-vs-nextra-vs-starlight-2026)).

**Docs stay in `docs/`.** Starlight can read the repo's `docs/*.md` directly, so
Boards keeps showing them and there's one copy. The docs need a `title` in their
frontmatter (today the title is the first heading), which a script can add.

**Hosting:** one Vercel project builds the site and the app into one output.
Headers per path, so only `/app/` gets the WebAssembly allowance in its CSP.
`mattblack.space/tools/img-to-svg/` redirects to `/app/`, and the portfolio's
case study links to the new site.

### The landing page

1. **Hero:** "Inlay traces images into vector shapes that fit together
   exactly." A live split-view of the sample badge (the real tracer, running
   in the page) with *Try it with your image* → `/app/` and
   `npm i inlaytrace`.
2. **Why it's different**, three panels with the evidence: no gaps (a zoomed
   seam, Inlay against a per-colour tracer); shapes a designer would draw
   (node counts, straight lines, sharp corners); private and free (runs in
   the browser, MIT, no WebAssembly).
3. **The numbers:** the score table (0.70% against 0.86%, 177 against 259
   nodes, 1.3 s against 17.5 s).
4. **Use it in code:** ten lines of `trace()` and `toSvg()`.
5. **Compared with the field:** the table from
   [What we do differently](how-it-differs.md).
6. **Footer:** GitHub, npm, docs, licence, "made by Matt Black" →
   mattblack.space.

### The docs

| Section | Pages |
| --- | --- |
| Getting started | Install; quick start in the browser (canvas), in a Web Worker, in Node (with `sharp` or `pngjs` for decoding) |
| Guides | Logos and flat art; line art; pixel art; choosing a palette; merging colours; optimising output with SVGO; layers for vinyl and screen print |
| API reference | `trace`, `toSvg`, options per mode, `peakPalette`, `exactPalette`, `fitChain`, `parsePath` / `serializePath`, generated from TSDoc ([starlight-typedoc](https://github.com/HiDeoo/starlight-typedoc)) |
| How it works | Today's pages: pipeline, palettes, Inlay, curve fitting, measuring quality |
| The app | Today's feature pages |
| Project | Comparison, roadmap, changelog, contributing |

The package README is the short front door (SVGO's order): what and why → a
picture → install → quick start → link to the docs → licence.

## Repo

**Recommendation: rename and open the existing repo** (`mtblck/img-to-svg` →
`mtblck/inlaytrace`) instead of starting fresh. It keeps the history, the
issues and their discussion, and GitHub redirects the old URLs. Private
issues can't be moved into a public repo, so a fresh repo would lose them.

Before flipping it public:

- **History check.** 42 commits, no image, key or token files ever added
  (checked 2026-10-17). Run a secret scanner (gitleaks) once more to be sure.
- **Issues and PRs become public**, including the internal ones (CI review
  set-up, Claude review notes). Read through them; close or edit anything
  that shouldn't be public.
- **CLAUDE.md** stays (it's useful to contributors using Claude) but loses
  anything personal; the Boards references can stay.
- **Boards:** update `projects.json` with the new repo name; consider marking
  the project and selected tickets `public`.

Layout after the move:

```
apps/
  app/        today's src/, index.html, vite config (base /app/)
  site/       Astro + Starlight: landing page; docs read from ../../docs
packages/
  inlay/      the library: published as inlaytrace
docs/         Markdown docs (Boards + the site)
scripts/      score, verify, vendoring, hosting checks
```

Community files at the root: README (the project's front door), LICENSE (MIT),
CONTRIBUTING (set-up, `npm test`, `score` before tracer changes, commit style),
CODE_OF_CONDUCT (Contributor Covenant), SECURITY (how to report), issue
templates (a bug report asks for the image, the preset and the settings; a
feature request), and a PR template.

## The package

- **Build:** ESM-only with type declarations (tsup or tsdown). Node 18+,
  browsers, workers. ESM-only is now a reasonable default for a new package
  ([guide](https://www.pkgpulse.com/guides/publishing-npm-package-complete-guide-2026)).
- **Release:** Changesets for versions and the changelog; a GitHub Actions
  workflow publishes on merge to `main`, with **npm trusted publishing**
  (OIDC: no long-lived token in the repo) and provenance. Check the current
  set-up steps when doing it.
- **Version 0.x** until Poster's stacked mode (#53) settles the API; then 1.0.
- **Maybe a CLI:** `npx inlaytrace logo.png -o logo.svg`. Cheap once the
  package exists, and the way most people try a tracer.

## What changes when it's public

- **Support:** issues from strangers. The bug template asks for the image and
  settings; "can't reproduce without the image" is a fine answer.
- **Stability:** semver, a changelog, and no casual breaking changes.
- **Privacy stays the pitch:** no analytics, nothing uploaded, the session in
  the browser only. Say so on the landing page.
- **Accessibility and browsers:** the app should state what it supports;
  verify already runs Chromium, so add a WebKit pass.

## Order of work

| Phase | Work | Needs Matt | Ticket |
| --- | --- | --- | --- |
| 0 | Decide names, domain, repo approach | Done | — |
| 1 | Restructure into `apps/` + `packages/`; rebrand the app; old URL keeps working | — | [#58](https://github.com/mtblck/img-to-svg/issues/58) |
| 2 | Site: landing page, docs in Starlight, getting started, API reference | Review the wording | [#59](https://github.com/mtblck/img-to-svg/issues/59) |
| 3 | Go public: history scan, issue review, community files, rename, flip public | Flip the switch | [#60](https://github.com/mtblck/img-to-svg/issues/60) |
| 4 | Publish the package: build, Changesets, trusted publishing, maybe a CLI | npm account | [#55](https://github.com/mtblck/img-to-svg/issues/55) |
| 5 | Domain, redirects, portfolio case study, Boards; announce | Buy the domain | [#61](https://github.com/mtblck/img-to-svg/issues/61) |

## Sources

- [Shiki repository](https://github.com/shikijs/shiki)
- [SVGO repository](https://github.com/svg/svgo)
- [SVGcode repository](https://github.com/tomayac/SVGcode)
- [VTracer web app README](https://cdn.jsdelivr.net/npm/vtracer-webapp@0.4.0/README.md)
- [Vercel: add a docs app to a monorepo](https://vercel.com/academy/production-monorepos/add-docs-app)
- [next-forge: apps structure](https://docs.next-forge.com/structure/apps)
- [Docusaurus vs VitePress vs Nextra vs Starlight (2026)](https://www.pkgpulse.com/guides/docusaurus-vs-vitepress-vs-nextra-vs-starlight-2026)
- [Publishing an npm package (2026)](https://www.pkgpulse.com/guides/publishing-npm-package-complete-guide-2026)
