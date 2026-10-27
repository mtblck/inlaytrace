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

Wrong pixels miss two things people notice at once: a pale shape that has gone
(it differs from white by less than the 96 that counts as wrong) and an outline
broken into pieces (a few pixels, however bad it looks). So it also reports:

- **Past 24**: wrong pixels again at a summed difference of 24, which a missing
  pale fill does cross.
- **Regions**: how many of the clean art's flat areas over 16 px (at 1×) come
  out mostly in their own colour. Each pixel is labelled with the nearest of the
  fixture's colours; a region is a connected piece of one colour, counting only
  pixels well inside it so the anti-aliasing between two colours never makes a
  sliver of a third. A dropped shape counts here whatever its size.
- **Lines**: the number of separate pieces the fixture's line colour makes in
  the trace, against the clean art. More means broken lines, fewer means lines
  run together. Line art and Centerline draw in black, which is still nearest
  the line colour, so they count too.

Current results:

| Preset | Tracer | Wrong pixels at 4× | Past 24 | Regions | Nodes | Size |
| --- | --- | --- | --- | --- | --- | --- |
| Logo | shared edges, exact shapes | 0.54% | 0.75% | 12/12 | 181 | 5.6 KB |
| Illustration | shared edges, exact shapes, stacked | 0.49% | 0.70% | 12/12 | 195 | 6.4 KB |
| Poster | shared edges, quantized, stacked | 3.19% | 4.05% | 9/12 | 1280 | 44.3 KB |

Exact shapes (#37) took Logo from 0.70% / 177 nodes and Illustration from
0.59% / 201: the badge's big disc is now a true circle rather than four fitted
curves. The sun overlaps the mountains, so its outline isn't one closed edge and
stays fitted.

Poster scored 1.13% / 948 nodes / 24.4 KB here when VTracer traced it. It's
worse on this badge now because it's the wrong preset for one: a quantized
palette spends colours on the anti-aliased edges that Logo's histogram peaks
ignore. Poster is judged on photos, below.

Then two symmetric marks drawn for the test (`scripts/fixtures/emblem.svg`, a
mirror-symmetric shield, and `pinwheel.svg`, five-fold with no mirror axis) go
through the same JPEG round trip, are traced with Logo, and are scored again
after the Mirror tool enforces whatever `detectSymmetry` found. *Asymmetry* is
the share of the drawing that differs from its own reflection (or turn):

| Mark | Detected | | Wrong pixels at 4× | Asymmetry | Nodes | Size |
| --- | --- | --- | --- | --- | --- | --- |
| Emblem | vertical axis at 320 (100%) | traced | 0.18% | 0.25% | 72 | 2.4 KB |
| | | mirrored | 0.16% | 0.00% | 81 | 2.7 KB |
| Pinwheel | turn of order 5 at (320, 320) (97.6%) | traced | 0.27% | 1.63% | 68 | 2.6 KB |
| | | turned | 0.31% | 0.00% | 107 | 3.9 KB |

The next-best candidate scores 70% and 35%, far below the 95% bar. Enforcing
symmetry copies the kept part's error along with its shape, so accuracy barely
moves either way; the turn costs nodes where the copies meet the cut-out
background. Detection takes about 0.3 s at 640 px.

Last, a pen drawing (`scripts/fixtures/strokes.svg`: six strokes 3 units wide
on a 200-unit drawing, so 9.6 px at 640 px) traced with Centerline and, for
comparison, Line art:

| Preset | Wrong pixels at 4× | Lines | Strokes | Nodes | Size | Stroke width |
| --- | --- | --- | --- | --- | --- | --- |
| Centerline | 0.90% | 5/5 | 6 | 38 | 1.3 KB | 9.7 px (measured) |
| Line art | 0.38% | 5/5 | (outlines) | 85 | 2.6 KB | |

Centerline finds one stroke per drawn stroke and the width to within about 1%
(both now split ink from paper by the drawing's own Otsu threshold, Auto, which
cost a little here against the old fixed 128: 0.83% and 0.36%). It's
less exact than outlines because a skeleton cuts the inside of a sharp corner
and stops short of a round end, which is what a plotter's pen fills back in.

Then a flat outline illustration (`scripts/fixtures/outline.svg`: mid-blue
outlines 1 unit wide, so 3.2 px, on white, shapes filled with pale tints of the
same blue). A pale fill is under 96 from white, so a missing one would hide in
the badge's measure; here a pixel is wrong past 24:

| Preset | Wrong pixels at 4× | Regions | Lines | Nodes | Paths | Size |
| --- | --- | --- | --- | --- | --- | --- |
| Logo | 2.02% | 20/20 | 7/7 | 330 | 20 | 9.7 KB |
| Illustration | 2.03% | 20/20 | 7/7 | 216 | 21 | 6.3 KB |
| Outline art | 2.07% | 20/20 | 7/7 | 195 | 15 | 5.9 KB |
| Line art | 13.36% | 13/20 | 6/7 | 128 | 6 | 3.7 KB |
| Poster | 2.62% | 12/20 | 5/7 | 614 | 53 | 20.2 KB |

Before the outline fixes Logo and Illustration were 13.0% wrong here: the
fills weren't in the palette and the outlines dissolved into the paper. Line
art draws only the ink, so the fills count against it, and so do the regions
it leaves white. Poster loses pale fills and breaks two lines.

Then the same outlines meeting (`scripts/fixtures/junctions.svg`: a T, a Y, an
X, a box with a cross, a box drawn with a gap, and three dashes, 8 pieces as
drawn), where *Lines* shows whether junctions stay joined and drawn gaps stay
open:

| Preset | Wrong pixels at 4× | Regions | Lines | Nodes | Size |
| --- | --- | --- | --- | --- | --- |
| Illustration | 2.90% | 13/13 | 8/8 | 96 | 2.1 KB |
| Outline art | 2.95% | 13/13 | 8/8 | 54 | 1.0 KB |
| Line art | 3.11% | 13/13 | 8/8 | 113 | 2.0 KB |
| Centerline | 3.29% | 13/13 | 8/8 | 41 | 0.8 KB |

The same drawing with lines 0.7 units wide (`junctions-thin.svg`, 2.2 px at
640 px, under the 2.5 px Outline art draws as strokes):

| Preset | Wrong pixels at 4× | Regions | Lines | Nodes | Size |
| --- | --- | --- | --- | --- | --- |
| Logo | 2.05% | 13/13 | 8/8 | 168 | 3.0 KB |
| Illustration | 2.05% | 13/13 | 8/8 | 86 | 1.8 KB |
| Line art | 2.04% | 13/13 | 8/8 | 94 | 1.9 KB |
| Centerline | 2.15% | 13/13 | 8/8 | 36 | 0.7 KB |

Before #145 every outline preset made 11 pieces of these 8 (2.25% wrong):
each arm of the T and the Y tapered to a point, so the lines looked broken.

And with lines 2.5 units wide (`junctions-thick.svg`, 8 px), where thinning bends
the skeleton toward each junction:

| Preset | Wrong pixels at 4× | Regions | Lines | Nodes | Size |
| --- | --- | --- | --- | --- | --- |
| Line art | 6.30% | 13/13 | 8/8 | 93 | 2.2 KB |
| Centerline | 6.75% | 13/13 | 8/8 | 43 | 0.9 KB |

Before junctions were refitted (#148) Centerline drew the X pinched, for 55
nodes; wrong pixels barely move (6.77%) because a skeleton also stops short of
every end, which costs far more.

And with lines 0.35 units wide (`junctions-hair.svg`, 1.1 px), so thin that no
pixel is wholly ink and a slanted line is a staircase of pixels touching only at
their corners:

| Preset | Wrong pixels at 4× | Regions | Lines | Nodes | Size |
| --- | --- | --- | --- | --- | --- |
| Logo | 1.51% | 13/13 | 8/8 | 176 | 3.3 KB |
| Illustration | 1.49% | 13/13 | 8/8 | 188 | 3.7 KB |
| Line art | 1.58% | 13/13 | 8/8 | 90 | 1.8 KB |
| Centerline | 1.74% | 13/13 | 8/8 | 37 | 0.7 KB |

Before diagonal steps were joined (#145) the slanted lines fell apart: 25 pieces
with Logo (for 1126 nodes), 16 with Line art, 10 with Illustration and
Centerline, and Illustration lost two of the regions.

And flat shapes partly behind others (`scripts/fixtures/overlap.svg`: a pale
moon and a disc behind a bar, a crescent, and an L-shaped sliver 1.5 units wide).
*Whole* counts the drawing's shapes the trace draws whole, hidden parts
included: a path of the shape's colour matching all of it (over 0.95 of the
union, at 1×):

| Preset | Wrong pixels at 4× | Regions | Whole | Nodes | Size |
| --- | --- | --- | --- | --- | --- |
| Logo (cut out) | 0.18% | 8/8 | 3/8 | 86 | 2.1 KB |
| Logo, stacked | 0.18% | 8/8 | 8/8 | 52 | 1.5 KB |
| Illustration (stacked) | 0.18% | 8/8 | 8/8 | 53 | 1.5 KB |
| Illustration, cut out | 0.18% | 8/8 | 3/8 | 88 | 2.2 KB |
| Poster | 1.13% | 8/8 | 2/8 | 288 | 6.4 KB |

Cut out, only the three shapes nothing covers are whole. Stacked flat art
(#146) completes the moon, the disc, the crescent's disc, the square under the
other square and the paper behind everything, and the drawing looks the same.
Illustration and Outline art stack by default; Logo stays cut out. Stacking also
drops the holes in the paper and in shapes that hold others, which is why it
uses about half the nodes on the junction fixtures.

And soft shading (`scripts/fixtures/shaded.svg`: a sky and a hill shaded by
linear gradients, a ball by a radial one, and a flat house). Flat fills band
each shade into tints, each off by more than 24 across much of its width;
with `gradients` (#150, on for stacked Illustration and Outline art) each
shade is one shape with a gradient again:

| Preset | Wrong pixels at 4× | Regions | Nodes | Paths | Size |
| --- | --- | --- | --- | --- | --- |
| Logo | 32.84% | 6/8 | 222 | 13 | 6.6 KB |
| Illustration (stacked, gradients) | 0.19% | 8/8 | 61 | 6 | 2.2 KB |
| Illustration, cut out (flat) | 32.50% | 7/8 | 414 | 20 | 12.7 KB |
| Poster | 0.85% | 8/8 | 1540 | 37 | 50.1 KB |
| Poster, gradients | 0.76% | 8/8 | 93 | 7 | 3.7 KB |

Every drawing above arrives as JPEG. The badge and three fixtures saved as PNG
instead, the way most logos arrive, show what edges placed between pixels
(#147) gain when the anti-aliasing isn't masked by compression noise:

| Drawing | Preset | Wrong pixels at 4× | Nodes | Size | Before #147 |
| --- | --- | --- | --- | --- | --- |
| Badge | Logo | 0.48% | 162 | 4.8 KB | 0.51%, 162 nodes |
| Badge | Illustration | 0.45% | 176 | 5.5 KB | 0.50%, 173 nodes |
| Emblem | Logo | 0.28% | 59 | 2.0 KB | 0.32%, 61 nodes |
| Emblem | Illustration | 0.25% | 39 | 1.3 KB | 0.26%, 42 nodes |
| Outline | Logo | 0.43% | 310 | 8.7 KB | 0.44%, 311 nodes |
| Outline | Illustration | 0.39% | 163 | 4.9 KB | 0.44%, 163 nodes |
| Overlap | Logo | 0.17% | 78 | 1.9 KB | 0.20%, 78 nodes |
| Overlap | Illustration | 0.16% | 49 | 1.4 KB | 0.19%, 50 nodes |

The badge and fixtures count wrong pixels past 96 and 24 as above. The JPEG
results are unchanged, by design: there the edges stay on the pixel grid.

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
- Every preset runs through the real engine; mirror and turn output is
  symmetric, and a background outside the turn keeps its corners; symmetry
  detection finds an off-centre axis, a five-fold turn, and nothing in a
  lopsided drawing; path
  data round-trips without drift; undo/redo and colour edits behave.

## `npm run verify`: the real app in a real browser

`scripts/verify.mjs` drives the built app in Chromium with the production
security headers, on the sample and optionally on an image of your own
(`FIXTURE=path`). It fails on any console error or CSP violation, and checks:
tracing and presets, colour replace and remove, the background, export and the
layers zip, the compare views and zoom (including that a pinch keeps the point
under the cursor in place), overlays, node selection and drag, undo/redo,
mirror symmetry measured on the exported SVG, detected symmetry (a five-fold
mark set up as a turn and repeated; a shield's axis found and restored with
*Use this axis*), and the discard prompts. It runs
in CI on every pull request.
