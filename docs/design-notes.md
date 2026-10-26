---
order: 50
---

# Design notes

Why the non-obvious choices were made, what broke before, and the measurements
behind them. Newest thinking is in the relevant docs; this is the record.

**The tracers are classical, not a model.** The research in
[research](research.md) found that no downloadable AI model
beats a good classical tracer at the tracing itself: VTracer matches or beats
every learned model on icons and clearly beats them on illustrations, at a
fraction of a second instead of 10–80 seconds on a GPU. AI belongs *around* the
tracer (background removal, upscaling), which is the next phase.

**VTracer was vendored with a rewritten loader, until #53.** The official
`@visioncortex/vtracer` package is a `wasm-pack --target nodejs` build: the wasm
is portable, but the glue reads it with `fs.readFileSync`, so it cannot load in
a browser. The community browser build wraps the older 0.8 engine and misses
1.0's palette and simplification options, so a script rewrote the glue to ESM
with an async `init(url)`, asserting every substitution matched. Once Inlay
took Poster too, the app stopped shipping VTracer; it's now a benchmark only,
loaded in Node as published (`scripts/vtracer.mjs`).

**Flat art traces each edge once.** VTracer traces every colour region on
its own and smooths the pixel outline into curves without knowing where the
corners are. On the sample badge that turned the straight mountain slopes into
slow S-bends and the snow-cap peaks into rounded bumps with two nodes a pixel
apart, and none of its settings gave straight lines *and* sharp corners.
Fitting each traced shape separately fixed the lines but opened hairline gaps,
because cut-out shapes trace every shared edge twice and the two copies were
fitted a fraction of a pixel apart. So Logo, Illustration and Line art now use
a tracer of our own, **Inlay** (`packages/inlay/src/inlay.ts`), named for inlaid wood,
where every piece is cut to fit its neighbours:

1. Label every pixel with a palette colour (the histogram peaks below). A pixel
   between two colours (anti-aliasing) takes the nearest colour *among its
   neighbours*, so a red/blue edge never grows a purple sliver.
2. Merge specks into their surroundings.
3. Walk the cracks between differently labelled pixels. Where three regions
   meet is a junction; each boundary between junctions is one chain, with one
   region either side.
4. Fit each chain once (`packages/inlay/src/fit.ts`): find corners (two straight sides,
   fitted a few pixels out, that meet near the outline; a round end's sides run
   parallel, so it stays a curve), then a straight line wherever one fits
   within 1.5× tolerance, otherwise straight stretches as lines and the rest as
   least-squares Béziers (Schneider) with matching tangents. The line test sees
   a plain moving average, which removes JPEG's 16 px colour-block ripple;
   curves see an average whose window shrinks with local curvature, so small
   dots keep their size.
5. Build each region from its chains. Neighbours share the same fitted edge
   exactly: no gaps, no overlaps, which is also what a vinyl cutter wants.

Scored with `npm run score` (rendered back at 4× against the clean art, where
wobble and rounded corners count):

| Sample badge | Wrong pixels at 4× | Nodes | Size |
| --- | --- | --- | --- |
| VTracer, previous Logo settings | 0.86% | 259 | 7.3 KB |
| Shared edges, fitted per chain | 0.74% | 167 | 5.0 KB |
| + corners by their sides, round ends, lines inside curves | 0.70% | 177 | 5.4 KB |
| + exact shapes (#37) | 0.54% | 175 | 5.4 KB |

(Re-measured later for the landing page, VTracer comes out at 0.85% and 271
nodes; see [measuring quality](how-it-works/measuring-quality.md).)

Straight edges are single segments and the peaks are single sharp corners.

The third row came from Matt's testing on a different browser, whose JPEG
encoder left different noise: a bump at a snow cap's tip and hooked ends on the
sample's arc. Sweeping JPEG quality reproduced both, and the fixes were about
telling shapes apart rather than tuning numbers. A corner is now two straight
sides meeting near the outline (a stroke's 4 px round end has sides that run
parallel, so it stays a curve); smoothing follows local curvature, measured at
two scales so JPEG noise can't fake a tight bend; runs that mix straight and
curved parts get lines for the straight stretches and curves joined smoothly
between them; and a curve turns at most about 90°, so a circle is four curves.
The extra nodes are those round ends and circles. On
a 2048 px image Inlay took 1.3 s where VTracer took 17.5 s.

**Pixel art moved to Inlay too.** Pixel art wants its exact staircase, which
Inlay already walks before it fits anything, so a pixel mode skips the
clean-up and the fitting and joins straight runs. Its palette is the image's
exact colours, because histogram peaks drop a one-pixel eye for being rare and
fold close shades together. On a test sprite both engines draw every pixel
exactly; Inlay uses 14% fewer nodes, about the same bytes, and on a 1024 px
sprite is 4× faster (0.2 s against 0.85 s). That left Poster on VTracer, since
photos have no flat regions or histogram peaks and cut-out shapes cost size
there, until [#53](https://github.com/mtblck/inlaytrace/issues/53) (below).

**Tuning the presets.** Each candidate setting was scored by tracing, rendering
the SVG back in Chromium, and measuring the error against the *clean source
art*, not the JPEG. On the built-in sample badge (5 colours, JPEG at q72):

| Change | Wrong pixels | Paths | Size |
| --- | --- | --- | --- |
| Colour cap 6 (first attempt) | 8.75% | 346 | 68 KB |
| Cap 8 | 1.39% | 373 | 70 KB |
| + `layerDifference: 32`, speckle 8 | 1.50% | 45 | 13 KB |
| + cut-out shapes | 0.95% | 15 | 7 KB |
| + palette from histogram peaks | 0.93% (mean error 3.28 → 1.47) | 14 | 4.3 KB |

Two of those were surprises worth remembering:

- *A cap equal to the number of colours is too low.* Anti-aliased edge shades
  take quantizer slots, so with a cap of 6 on a 5-colour badge the red
  mountain and green hill merged into one brown. The colour hint in the UI says
  to raise the cap if that happens.
- *VTracer's quantizer drifts flat colours towards their neighbours.* The gold
  sun came out pale peach, plainly visible in the Difference view. Flat art's
  real colours are sharp peaks in the histogram, with anti-aliasing a thin
  spread between them, so `packages/inlay/src/palette.ts` takes the peaks (5-bit bins,
  most frequent first, accepted only if perceptually distinct in OKLab) and
  passed them to VTracer as a fixed palette (Inlay uses them the same way now). That recovered the source colours
  almost exactly, and on a real illustration cut mean error from 11.1 to 4.3.
  On a photo it made things worse (9.9 → 15.3), since photos have no peaks, so
  Poster kept VTracer's quantizer; it now uses Inlay's own (`quantizePalette`).

`layerDifference` and cut-out shapes follow the same pattern: big wins on flat
art, costs on photos, so they are per-preset rather than global.

**Small images.** A 146×156 logo has eye slits and teeth 2–3 px wide, and
VTracer faithfully traces their pixel steps, so the result came out wobbly with
the anti-aliasing as an extra grey ink. Sources under 512 px are now upscaled to
1024 px with smoothing and a blur of half the scale factor before tracing; the
same logo then traced to clean curves with every detail intact. Mid-size images
are left alone: the 640 px sample was already at 0.93% wrong pixels natively.

**Light ink on dark.** Line art always traces the dark side, so a
white logo on black came out as the background with holes. Line art can now
invert first ("Light on dark"), and starts that way when the image's border is
dark. On a white-on-black logo that is the whole job in one step: background gone,
white shapes as black paths, 6.5 KB. Line art also defaults to a fixed
threshold now; adaptive thresholding closed the thin gaps between the logo's
shapes, so it stays as an option for photos of paper.

**Outline illustrations.** An error-page illustration (a sinking ship: 3 px
mid-blue outlines on white, the ship and moon filled with pale blues, saved as
lossy WebP) traced as almost nothing. Six separate causes, each now fixed:

- *Speck clean-up dissolved the strokes.* Lossy compression smears a thin
  stroke into two shades of its ink (0.08 apart in OKLab, so both made the
  palette), and each fragment was a speck. A speck joined the label it shared
  most edge with, which for a piece of a 3 px stroke is the paper; and a speck
  whose neighbour had just joined its own colour was still judged alone. Specks
  now join the neighbour nearest in colour, and wait a pass once they've grown.
  Slivers under 2 px wide fold into a neighbour within 0.15 of their colour
  (a hairline of a colour of its own has none, so it stays).
- *Pale fills never made the palette.* A light-blue fill is 0.03 from white,
  under the 0.07 that makes a colour distinct, and on the line from white to
  the ink, so it read as an edge. Fills are *flat* (every pixel matches its
  four neighbours) and edges never are, so `peakPalette` now fills spare slots
  with flat tints at least 0.02 from the others, and drops a blend that is
  never flat at any share (the anti-aliasing of thin outlines on white is
  plentiful enough to pass `minShare`).
- *Line art's fixed 128 sat on the ink.* The blue's luminance is 122, with
  noise either side. Line art and Centerline now default to the image's own
  ink/paper split (Otsu, "Auto"); the fixed level is still there as "Manual".
  On the pen drawing it cost little (0.36% → 0.38% wrong).
- *A 3 px letter stem collapsed to a line.* Its ends are too narrow to measure
  as corners, so both long sides were fitted between the same two nodes. A
  closed outline that loses over half its area is refitted as a smooth loop,
  or kept as its pixel outline.
- *Spikes under thin letters.* A stem's nearly parallel sides "met" 13 px past
  its last pixels, and a least-squares cubic put a handle 100 px out. A
  narrow corner must now lie within 0.5 / tan(θ/2) + 1 px of its pixels (where
  a real point thins below a pixel), and handles longer than their run fall
  back to a third of the chord.
- *Pixel art took the page for pixel art.* 88% of the image was one exact
  white, so the exact palette "covered" it; the other 31 colours were
  near-whites and the drawing traced white. Coverage no longer counts the
  commonest colour.

`npm run score` has the case as `scripts/fixtures/outline.svg`, scored wrong
past 24 instead of 96 (a missing pale fill is under 96 from white): Logo went
from 13.0% to 2.1% of pixels wrong, with the badge and emblems unchanged. On
`score:photos` Poster came out 22% closer to the photos (mean error 10.4 → 8.2)
for files about half as large again, since fewer real regions are now
dissolved: raise Speckle for smaller files.

**Only the latest request ever waits.** Dragging a slider fires many trace
requests a second and a trace can take a second or more. `TraceClient` holds at
most one waiting request per channel (trace, optimise), replacing it when a
newer one arrives, so the preview is never more than one trace behind the
slider. The worker is created lazily because React StrictMode's double effect
run would otherwise leave the app holding a terminated worker in development.

**The numbers shown are the numbers exported.** Path, node and byte counts come
from the SVGO-optimised output, computed in the background after each change,
not from the raw trace. Before this, the panel showed 41 KB for a file that
downloaded at 31 KB.

**One domain, two halves.** The app started as a tool at
mattblack.space/tools/img-to-svg/, proxied by the portfolio, so it was built to
live at that same path on both hosts. With inlaytrace.com it moved to `/app/`,
beside the landing page at `/` and the docs at `/docs/`, all one Vercel
project. The old path redirects permanently, with an absolute URL so the
portfolio's proxy passes the redirect through rather than following it. The
site builds to `dist/` first, because Astro empties its output folder, and the
app builds into `dist/app` after it.

**One copy of each doc.** `docs/*.md` is the source: Boards reads it, and
`scripts/sync-docs.mjs` copies it into Starlight at build time (title from the
first heading, `order` to sidebar order, `.md` links to site URLs). Planning
notes such as the launch plan are left out.

**The landing page's evidence is measured.** `npm run site:assets` traces the
app's sample as the app receives it (640 px JPEG) with Inlay and with VTracer as
the old Logo preset ran it, scores both against the clean art at 4×, and writes
the shapes and numbers the page draws. The close-up is pinned to the left peak:
the window where VTracer is most wrong by pixel count is a gentle curve where the
two look the same, and the page's claim is about corners and straight edges. On
this sample VTracer's shared edges stay within 0.06 px of each other, so the page
does not claim it leaves gaps.

**The CSP is tested, not trusted.** There are three, and Vercel applies every
matching header block, so they're scoped never to overlap. The app's needs a
worker allowance (without it the page loads, accepts a drop, and never traces)
and must not allow `'wasm-unsafe-eval'`; the AI worker's file
(`/app/assets/prep-*.js`) gets the same policy plus `'wasm-unsafe-eval'`, since
a dedicated worker runs under the policy its own script is served with. The site's is `script-src 'self'` plus
`'wasm-unsafe-eval'` for search (Pagefind) and the sha256 of each inline script
Starlight writes (theme, sidebar). `npm run hosting:check` fails the build if any
of that goes missing; after the build, `--dist` hashes every inline script in
the site and fails on one the CSP doesn't list (so a Starlight update fails the
build, not the docs) or on any inline script in the app. `npm run preview`
(`scripts/serve.mjs`) serves `dist/` with `vercel.json`'s redirects, rewrites
and headers, and `verify` fails on any CSP violation in the console.

**Untrusted output stays out of the markup.** The trace is shown inline (the
overlays and hit targets need real DOM paths), so every `d`, `fill` and `transform` is
validated against what the tracers emit before it is rebuilt into the document.
Recolours are normalised hex or ignored.

**Edits sit on top of the trace until they can't.** The document is
`{ inks, doc, background }`. Colour edits (`inks`) are keyed by the traced
colour, so they survive re-tracing, as does the background. `doc` stays `null`, meaning "whatever the tracer produces",
until the first geometric edit (a node drag, a delete, a mirror) copies the
trace into an editable document with fresh ids. From then on a trace setting
would throw the edits away, so changing one asks first; going back to the trace
is itself an undoable step. Undo/redo stores whole snapshots (cheap at these
sizes, capped at 100) and coalesces a drag or a colour-picker sweep into one step.

**Path data is normalised once, then round-trips exactly.** Editing converts each
path to absolute M/L/C/Z nodes with explicit handles (`apps/app/src/lib/pathdata.ts`).
Numbers are written to three decimals and the serialiser is idempotent, so
touching one node never nudges the rest of the drawing.

**Mirror is two booleans per shape.** For each path: intersect it with the kept
half-plane, reflect that across the axis, and unite the two. A shape that
crossed the axis comes out as one seamless shape rather than two halves that
meet; shapes entirely on the discarded side are dropped; paint order and fills
are kept. The geometry is paper.js (MIT), loaded only when you mirror: 72 KB
gzipped against an 89 KB app. The unit tests run the same core build under
jsdom, and `verify` renders the exported SVG and compares each half against
the other (0.0% of pixels differ on a real logo).

**Moves and scales are measured from the start of the drag.** Each pointer
move sends the whole transform since the press, and it is applied to the shapes
as they were then. Applying increments instead would compound rounding over a
long drag. The starting shapes are captured in the event handler, not inside
the state updater: React can run the updater after the handler has already
cleared them at the end of the drag, and in an early version that applied the
final move twice (a 30 px drag moved 60 px). The browser check drags by a known
distance and measures the result.

**Smooth nodes stay smooth.** A node whose two handles are in line (within
10°) is smooth, which is how the tracer writes curves that meet with matching
tangents. Dragging one of its handles swings the other round to stay opposite,
keeping its length; ⌥ breaks the pair. Whether a node is smooth is decided at
the press, so a drag that bends a handle past the threshold doesn't suddenly
let go of its partner.

**Marquees take shapes wholly inside.** Touching is the other common rule,
but a trace usually has one large shape behind everything, and touching would
add it to every selection. A marquee can start in the margin round the image,
for when that background shape covers all of it.

**PDF and EPS are written by hand.** Both are a few path operators per
shape (moveto, lineto, curveto, closepath, fill), so a library would add more
than it saves. The PDF is five objects with a Flate-compressed content stream
and a byte-exact cross-reference table; the tests check every offset, and the
file passes `qpdf --check` and renders back the same as the SVG in Poppler.
Coordinates are flipped (both formats put the origin bottom-left) and scaled
from the viewBox to points.

**Merging colours happens before regions exist.** Making two colours the same
leaves two shapes and the seam between them. Merging relabels one colour's
pixels as the other's after palette labelling (so anti-aliased edges were
still judged against both) and before specks, components and edges are
built, so the seam never exists. It's a trace setting, so it costs a
re-trace and asks first after shape edits.

**Overlays never export.** The canvas is three layers: the original, the
vector exactly as exported, and an overlay `svg` with hit targets, outlines,
nodes, handles and the mirror axis. Nodes and handles are sized in screen pixels
(scaled by the current zoom), so they stay grabbable at 8×. A press only becomes a
drag after 3 px of travel and keeps the grab offset, so clicking a node selects
it without nudging it. Invisible hit targets sit beneath every visible node, so
a neighbour's target can't steal the node under the pointer.

**Zoom is a scale, not a level.** Zoom is stored as screen pixels per
original pixel (`null` means fit, which follows the window), so 100% means the
same thing however large the image was traced. The slider and the ± steps are
logarithmic (√2 a step), and steps stop at fit and at 100% rather than skipping
past them. A trackpad pinch over the canvas zooms around the cursor: Chrome,
Firefox and Edge send it as ctrl+wheel, Safari as gesture events, and both are
handled; ⌘/Ctrl + wheel, ⌘/Ctrl + = − 0 1 work too. Past fit, the sheet gets
half a window of padding on each side, which is what lets the point under the
cursor stay put (0.1% drift over a 1,100% pinch) even near an edge.

**Busy traces stay responsive.** A Poster trace of a photo can be 2,500 paths
and 60,000 nodes. The node overlay is one `<path>` and is skipped (with a note)
past 20,000 nodes; each shape is a memoised element; path data is validated
once per path, not per render; and the stats panel measures only the optimised
file. On that trace a node drag went from 117 ms to 25 ms a move, and toggling
the overlay from 2.4 s to 0.3 s.

**Poster moved to Inlay last, and a bug was the gap.** Photos stayed on VTracer
because they have no histogram peaks and cut-out shapes cost size on them. Inlay
gained a quantized palette (k-means in OKLab, seeded deterministically) and a
stacked mode, but the first photo scores were poor: ten times VTracer's shapes
and 2.5 times its size. A larger speck setting made it *worse*, which pointed
at the cause: merging specks ran once, so a speck that joined a small region
which then joined a third was stranded as a new speck. Clean art never
cascades; photos did thousands of times. Repeating the merge until nothing is
left took the photos from 5,150 shapes to 222, and Inlay then beat VTracer on
all three photos (mean error 14.3 → 11.8, 57% fewer shapes, 30% smaller), so
the app dropped VTracer, its WebAssembly and the `'wasm-unsafe-eval'` allowance.
Stacking itself saves less than expected on photos (about 3%): most photo
regions are small and have few holes. A radius-2 blur before tracing cut error
a further 10%, but softens real edges; it's left for a future setting. At
2048 px Poster takes 3.4–5.1 s on these photos in Node, about 15% longer than
VTracer took (2.9–4.5 s), and the SVG is about 30% larger at that size; at the
photos' own size (450–640 px wide) it's both smaller and closer.

**Stacked shapes still had seams, between neighbours.** Stacking covers a hole
with what fills it, but two shapes side by side over a third each anti-alias
their shared edge, and the third shows through as a darker hairline; more
colours meant more such edges, so raising Poster's colours seemed to add
random lines. Drawing each shape in its own colour as a 0.5 px outline cut
error on a product photo by 11%, which measured the seams' cost. The fix keeps
plain fills: each shape's outline is now that of itself plus every neighbour
painted after it (still from the same fitted edges), so every edge is drawn
once, by the later shape over the earlier one's colour. A hole in that outline
stays open if a shape painted earlier is inside it, or transparency. On the
three photos mean error went 11.83 → 10.42 (12%) for 37% more path data
(148.7 → 203.1 KB, still under VTracer's 212.6).

**Centerline is a skeleton, not an outline (#38).** Plotters and engravers want
one stroke per line. AutoTrace does this but is GPL, so Inlay grew its own: the
ink is thinned (Zhang–Suen), then any pixel whose neighbours stay connected
without it is dropped, because Zhang–Suen leaves the line two pixels thick at
staircases, and every one of those read as a junction: a ring came out as four
strokes until that pass, and as one after. The width started as twice the
median distance transform along the skeleton, but that is out by a pixel on
even widths (the skeleton can't sit on the middle), so it is the ink's area
over the skeleton's length instead: 9.58 px for strokes drawn 9.6 px wide.
Strokes that carry straight through a crossing are joined, so a plus sign is two
pen strokes, not four.

**AI steps run in a worker with its own policy (#39).** Background removal
(U²-Net small, Apache 2.0, 4.4 MB) and 4× upscaling (Real-ESRGAN general v3,
BSD 3-Clause, converted from its PyTorch release to ONNX unchanged, 4.9 MB) run
with ONNX Runtime Web's WebAssembly backend (MIT, 3.7 MB compressed), one
thread so no cross-origin isolation is needed. Rather than allow WebAssembly
for the whole app again, only the worker's script is served with
`'wasm-unsafe-eval'`; Chromium compiles under the worker's policy, and the page
stays without it. On a 600 px photo background removal took about 3 s the first
time (download included); upscaling a 120 × 80 mark about 2 s. The steps give a
prepared copy of the image that is traced and compared against instead of the
original; the original is still what's saved.

