# img-to-svg

Turn a PNG, JPG or WebP into a clean SVG — in the browser, without uploading it
anywhere.

**https://mattblack.space/tools/img-to-svg/**

Pick what the image is (logo, illustration, line art, poster, pixel art), adjust
colours and smoothing, and compare the result against the original three ways:
a split slider, a difference blend that lights up wherever the SVG is wrong,
and the vector on its own, with optional path and node overlays in colours you
pick. Zoom with the slider or a trackpad pinch over the image. Then edit
(the view switches to the SVG alone once you start): replace or remove any
colour (removing one is how to drop a background), add a background colour
behind everything, drag nodes and bend curves, delete nodes or shapes, and
mirror one half of the drawing onto the other as seamless merged shapes.
Everything is undoable. Export a single optimised SVG, or a zip with one SVG
per colour for screen printing and vinyl.

React 19 · Vite · Tailwind v4 · a shared-edge tracer for flat art and VTracer
(Rust → WebAssembly) for posters and pixel art, in a Web Worker ·
SVGO · paper.js (mirroring only, lazy-loaded) · deployed on Vercel, proxied into mattblack.space.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173/tools/img-to-svg/
npm test           # unit tests + every preset through the real tracer
npm run build      # vendors the tracer, checks hosting config, type-checks, builds
npm run preview    # serves the build with the production security headers
npm run verify     # end-to-end in a real browser (needs `preview` running)
npm run score      # trace the sample, score each preset against the clean art
```

`verify` takes an optional URL, so the same checks run against production:
`npm run verify -- https://mattblack.space/tools/img-to-svg/`. Set
`CHROME_PATH` to use an installed Chromium, `SHOTS=dir` to save screenshots,
and `FIXTURE=path` to also trace and edit an image of your own. The editor
checks (overlays, node drag, undo/redo, mirror symmetry measured on the
exported SVG, the discard prompt) run on the built-in sample and on the fixture.

## Design notes

**The tracers are classical, not a model.** The research in
[`docs/research.md`](docs/research.md) found that no downloadable AI model
beats a good classical tracer at the tracing itself: VTracer matches or beats
every learned model on icons and clearly beats them on illustrations, at a
fraction of a second instead of 10–80 seconds on a GPU. AI belongs *around* the
tracer (background removal, upscaling), which is the next phase.

**VTracer 1.0 is vendored with a rewritten loader.** The official
`@visioncortex/vtracer` package is a `wasm-pack --target nodejs` build: the wasm
is portable, but the glue reads it with `fs.readFileSync`, so it cannot load in
a browser. The community browser build wraps the older 0.8 engine and misses
1.0's palette and simplification options. Rebuilding with `--target web` needs
the wasm32 Rust toolchain on every machine that builds this, so instead
`scripts/vendor-vtracer.mjs` rewrites the glue to ESM with an async
`init(url)`. The rewrite asserts every substitution matched and pins the package
version, so an upstream change fails the build rather than shipping a module
that throws in the browser.

**Flat art traces each edge once.** VTracer traces every colour region on
its own and smooths the pixel outline into curves without knowing where the
corners are. On the sample badge that turned the straight mountain slopes into
slow S-bends and the snow-cap peaks into rounded bumps with two nodes a pixel
apart, and none of its settings gave straight lines *and* sharp corners.
Fitting each traced shape separately fixed the lines but opened hairline gaps,
because cut-out shapes trace every shared edge twice and the two copies were
fitted a fraction of a pixel apart. So Logo, Illustration and Line art now use
a tracer of our own (`src/engine/shapes.ts`):

1. Label every pixel with a palette colour (the histogram peaks below). A pixel
   between two colours (anti-aliasing) takes the nearest colour *among its
   neighbours*, so a red/blue edge never grows a purple sliver.
2. Merge specks into their surroundings.
3. Walk the cracks between differently labelled pixels. Where three regions
   meet is a junction; each boundary between junctions is one chain, with one
   region either side.
4. Fit each chain once (`src/lib/fit.ts`): find corners (a turn that stays
   sharp at half the distance; a curve's doesn't), square off the crisp ones,
   then a straight line wherever one fits within 1.5× tolerance, otherwise
   least-squares Béziers (Schneider). The line test sees a plain moving
   average, which removes JPEG's 16 px colour-block ripple; curves are fitted
   to a "twiced" average that keeps small dots their size.
5. Build each region from its chains. Neighbours share the same fitted edge
   exactly: no gaps, no overlaps, which is also what a vinyl cutter wants.

Scored with `npm run score` (rendered back at 4× against the clean art, where
wobble and rounded corners count):

| Sample badge | Wrong pixels at 4× | Nodes | Size |
| --- | --- | --- | --- |
| VTracer, previous Logo settings | 0.86% | 259 | 7.3 KB |
| Shared edges, fitted per chain | 0.74% | 167 | 5.0 KB |
| + corners by their sides, round ends, lines inside curves | 0.70% | 177 | 5.4 KB |

Straight edges are single segments and the peaks are single sharp corners.

The second row came from Matt's testing on a different browser, whose JPEG
encoder left different noise: a bump at a snow cap's tip and hooked ends on the
sample's arc. Sweeping JPEG quality reproduced both, and the fixes were about
telling shapes apart rather than tuning numbers. A corner is now two straight
sides meeting near the outline (a stroke's 4 px round end has sides that run
parallel, so it stays a curve); smoothing follows local curvature, measured at
two scales so JPEG noise can't fake a tight bend; runs that mix straight and
curved parts get lines for the straight stretches and curves joined smoothly
between them; and a curve turns at most about 90°, so a circle is four curves.
The extra nodes are those round ends and circles. On
a 2048 px image the new tracer took 1.5 s where VTracer took 17.5 s. Poster and
Pixel art keep VTracer: photos have no flat regions to share edges between, and
pixel art wants its steps.

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
  spread between them, so `src/lib/palette.ts` takes the peaks (5-bit bins,
  most frequent first, accepted only if perceptually distinct in OKLab) and
  passes them to VTracer as a fixed palette. That recovered the source colours
  almost exactly, and on a real illustration cut mean error from 11.1 to 4.3.
  On a photo it made things worse (9.9 → 15.3), since photos have no peaks, so
  the Poster preset keeps VTracer's quantizer.

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
dark. On the robot logo that is the whole job in one step: background gone,
white shapes as black paths, 6.5 KB. Line art also defaults to a fixed
threshold now; adaptive thresholding closed the thin gaps between the logo's
shapes, so it stays as an option for photos of paper.

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

**Paths are the same on both hosts.** The build goes to `dist/tools/img-to-svg`
with a matching Vite `base`, so assets live at `/tools/img-to-svg/assets/…` on
this project's own Vercel URL *and* through mattblack.space's rewrite. The
portfolio proxies the path without translating it.

**The CSP is tested, not trusted.** The tracer needs `'wasm-unsafe-eval'` and a
worker allowance. Without them the page loads, accepts a drop, and never traces.
`npm run hosting:check` fails the build if either goes missing; `vite preview`
serves the real headers from `vercel.json`; and `verify` fails on any CSP
violation in the console.

**Untrusted output stays out of the markup.** The trace is shown inline (the
overlays and hit targets need real DOM paths), so every `d`, `fill` and `transform` is
validated against what the tracers emit before it is rebuilt into the document.
Recolours are normalised hex or ignored.

**Edits sit on top of the trace until they can't.** The document is
`{ inks, doc }`. Colour edits (`inks`) are keyed by the traced colour, so they
survive re-tracing. `doc` stays `null`, meaning "whatever the tracer produces",
until the first geometric edit (a node drag, a delete, a mirror) copies the
trace into an editable document with fresh ids. From then on a trace setting
would throw the edits away, so changing one asks first; going back to the trace
is itself an undoable step. Undo/redo stores whole snapshots (cheap at these
sizes, capped at 100) and coalesces a drag or a colour-picker sweep into one step.

**Path data is normalised once, then round-trips exactly.** Editing converts each
path to absolute M/L/C/Z nodes with explicit handles (`src/lib/pathdata.ts`).
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

## Licence

MIT. VTracer is MIT OR Apache-2.0; SVGO, fflate and paper.js are MIT. Potrace (GPL) and
the `@imgly` packages (AGPL) are deliberately not used.
