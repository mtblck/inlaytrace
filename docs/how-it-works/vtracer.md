---
order: 5
---

# VTracer (Poster)

[VTracer](https://github.com/visioncortex/vtracer) is an MIT/Apache-2.0
tracer written in Rust. The research found it the best classical tracer, and it
traced everything until flat art, then pixel art, moved to
[Inlay](inlay.md). It still handles **Poster**: photos flattened into colour
bands. Photos have no flat regions to share edges between, and VTracer's
spline fitting and own quantizer suit their soft bands (histogram peaks made
photos worse, 9.9 → 15.3 mean error).

Moving Poster to Inlay too would drop a 650 KB WebAssembly file, the vendoring
script below and the CSP's `'wasm-unsafe-eval'`. It needs a stacked mode and a
quantized palette first, scored against VTracer on real photos
([#53](https://github.com/mtblck/inlaytrace/issues/53)).

## Loading it in a browser

VTracer 1.0's npm package is a Node build: its glue reads the WebAssembly with
`fs.readFileSync`. The community browser build wraps the older 0.8 engine,
without 1.0's palette and simplification options, and rebuilding for the
browser needs the Rust wasm32 toolchain on every machine.

So `scripts/vendor-vtracer.mjs` rewrites the official glue to browser ESM with
an async `init(url)`. It asserts every substitution matched and pins the
package version, so an upstream change fails the build instead of shipping a
module that throws in the browser. The output in `apps/app/src/engine/vtracer/` is
generated and not committed.

The WebAssembly needs `'wasm-unsafe-eval'` in the content security policy;
`npm run hosting:check` fails the build if that goes missing.

## Settings

| Setting | VTracer option |
| --- | --- |
| Colours | `maxColors` (Poster) |
| Ignore specks | `filterSpeckle` |
| Smoothing | `simplify` |
| Corners | `cornerThreshold` |
| Shapes (Stacked / Cut out) | `hierarchical` |
