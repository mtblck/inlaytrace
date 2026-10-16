# img-to-svg

Turn a PNG, JPG or WebP into a clean SVG — in the browser, without uploading it
anywhere.

**https://mattblack.space/tools/img-to-svg/**

Pick what the image is (logo, illustration, line art, poster, pixel art), adjust
colours and smoothing, and compare the result against the original three ways:
a split slider, a difference blend that lights up wherever the SVG is wrong,
and an outline view that shows every path as a cutter or plotter will. Each
colour in the trace is an editable ink you can recolour or drop. Export a single
optimised SVG, or a zip with one SVG per ink for screen printing and vinyl.

React 19 · Vite · Tailwind v4 · VTracer (Rust → WebAssembly) in a Web Worker ·
SVGO · deployed on Vercel, proxied into mattblack.space.

## Commands

```bash
npm install
npm run dev        # http://localhost:5173/tools/img-to-svg/
npm test           # unit tests + every preset through the real tracer
npm run build      # vendors the tracer, checks hosting config, type-checks, builds
npm run preview    # serves the build with the production security headers
npm run verify     # end-to-end in a real browser (needs `preview` running)
```

`verify` takes an optional URL, so the same checks run against production:
`npm run verify -- https://mattblack.space/tools/img-to-svg/`. Set
`CHROME_PATH` to use an installed Chromium, `SHOTS=dir` to save screenshots,
and `FIXTURE=path` to also trace an image of your own.

## Design notes

**The tracer is VTracer, not a model.** The research in
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
outline view needs CSS on the paths), so every `d`, `fill` and `transform` is
validated against what VTracer emits before it is rebuilt into the document.
Recolours are normalised hex or ignored.

## Licence

MIT. VTracer is MIT OR Apache-2.0; SVGO and fflate are MIT. Potrace (GPL) and
the `@imgly` packages (AGPL) are deliberately not used.
