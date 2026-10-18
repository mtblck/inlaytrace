---
order: 6
---

# Measuring quality

Every change to tracing is measured, not judged by eye. Three tools do it.

## `npm run score`: accuracy against clean art

The built-in sample badge is drawn in code (`apps/app/src/lib/sample.ts`), so its exact
shapes are known. `scripts/score.mjs`:

1. Renders the badge at 640 px and saves it as a JPEG at quality 72, exactly as
   the app's *Try a sample* does.
2. Traces it with each preset through the app's own code (loaded via Vite).
3. Renders each SVG back at **4×** and counts the pixels that differ noticeably
   from the clean art, also rendered at 4×. At 1× a wobbly edge or a rounded
   corner hides inside the anti-aliasing; at 4× it counts.
4. Reports wrong pixels, nodes, paths and size.

Current results:

| Preset | Tracer | Wrong pixels at 4× | Nodes | Size |
| --- | --- | --- | --- | --- |
| Logo | shared edges | 0.70% | 177 | 5.4 KB |
| Illustration | shared edges | 0.59% | 201 | 6.5 KB |
| Poster | shared edges, quantized, stacked | 3.25% | 1258 | 43.6 KB |

Poster scored 1.13% / 948 nodes / 24.4 KB here when VTracer traced it. It's
worse on this badge now because it's the wrong preset for one: a quantized
palette spends colours on the anti-aliased edges that Logo's histogram peaks
ignore. Poster is judged on photos, below.

Run it before shipping any change to the tracer, the fitter or a preset.

## `npm run score:photos`: Poster on photos

Photos have no clean source art, so the reference is the photo itself. Three
photos in `scripts/fixtures/photos/` (CC0 and public domain, from
scikit-image's sample data) are traced by Poster as the app runs it, and by
VTracer as Poster ran it before; each SVG is rendered back at 1× and compared
with the photo, as the mean per-channel difference (0–255).

| Average of 3 photos | Mean error | Paths | Nodes | Size | Time |
| --- | --- | --- | --- | --- | --- |
| VTracer (Poster before) | 14.27 | 511 | 9,164 | 212.6 KB | 510 ms |
| Inlay (Poster now) | 11.83 | 222 | 4,474 | 148.7 KB | 607 ms |

Inlay is closer on every photo (14.04 → 12.89 on the cat, 13.79 → 13.63 on the
coffee cup, 14.98 → 8.96 on the rocket), with fewer paths and a smaller file on
each; it's about 20% slower. `VARIANTS=more,noise` adds the configurations tried
along the way (more colours, smaller specks, a looser tolerance, a slight blur
before tracing).

**The landing page's figures** come from `npm run site:assets`, which runs the
same measurement on the same badge, for Inlay (the Logo preset) and for VTracer
with the settings the Logo preset used before Inlay. Nodes are counted the same
way (path commands). Re-run it after a tracer change and commit
`apps/site/src/data/sample.json`. Re-measured in October 2026, VTracer comes out at 0.85%
and 271 nodes; the 0.86% and 259 in the Inlay history were measured when it was
still the Logo tracer.

**JPEG noise matters.** Different browsers encode the sample's JPEG
differently. Two flaws Matt saw (a bump at a snow cap's tip, hooked stroke
ends) didn't show in our browser until the sample was traced at JPEG qualities
from 0.6 to 0.92. Sweeping quality is now part of checking a fitter change.

## `npm test`: properties that must hold

Unit tests (Vitest) pin what the output must be, not just that it runs:

- Shapes tile the image: their areas add up to the whole within 0.2%.
- A slanted straight edge is one line, shared exactly by both neighbours.
- A stroke with round ends stays within 0.75 px of its true outline; one with
  square ends keeps exactly four corners.
- A circle is four curves within 0.5 px; an acute peak at a junction is one
  point.
- On a real JPEG crop of the sample (`packages/inlay/src/fixtures/sample-caps.ts`), no
  two consecutive nodes are closer than 3 px.
- Every preset runs through the real engine; mirror output is symmetric; path
  data round-trips without drift; undo/redo and colour edits behave.

## `npm run verify`: the real app in a real browser

`scripts/verify.mjs` drives the built app in Chromium with the production
security headers, on the sample and optionally on an image of your own
(`FIXTURE=path`). It fails on any console error or CSP violation, and checks:
tracing and presets, colour replace and remove, the background, export and the
layers zip, the compare views and zoom (including that a pinch keeps the point
under the cursor in place), overlays, node selection and drag, undo/redo,
mirror symmetry measured on the exported SVG, and the discard prompts. It runs
in CI on every pull request.
