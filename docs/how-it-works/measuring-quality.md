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
| Poster | VTracer | 1.13% | 948 | 24.4 KB |

Run it before shipping any change to the tracer, the fitter or a preset.

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
