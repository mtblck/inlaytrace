---
order: 5
---

# VTracer (the benchmark)

[VTracer](https://github.com/visioncortex/vtracer) is an MIT/Apache-2.0 tracer
written in Rust. The research found it the best classical tracer, and the app
was built on it. Inlay replaced it one preset at a time: flat art and line art
first, then pixel art, and Poster (photos) last. It's now only a benchmark:
the scoring scripts compare Inlay against it, and nothing that ships uses it.

## Why Poster moved

Poster was the last preset on VTracer, and it stayed there because photos are
unlike flat art in two ways. They have no histogram peaks, so Inlay's
peak-picked palettes made them worse (mean error 9.9 → 15.3). And cutting a
hole in every shape for each shape inside it costs size. So Inlay first gained
a quantized palette (k-means in OKLab, [palettes](palettes.md)) and a stacked
mode, where each shape is drawn whole and larger shapes come first.

Scored on three photos ([measuring quality](measuring-quality.md)), against
Poster as VTracer ran it:

| Average of 3 photos | Mean error | Paths | Nodes | Size | Time |
| --- | --- | --- | --- | --- | --- |
| VTracer | 14.27 | 511 | 9,164 | 212.6 KB | 510 ms |
| Inlay, quantized and stacked | 11.83 | 222 | 4,474 | 148.7 KB | 607 ms |

Closer to the photo on all three, with fewer paths and smaller files, for
about 20% more time. Switching also removed a 650 KB WebAssembly file from the
app, the script that rewrote VTracer's Node build for the browser, and the
app's `'wasm-unsafe-eval'` security allowance.

The first comparison wasn't close: Inlay drew ten times as many shapes. That
turned out to be a bug in merging specks (a speck that joined a small region
which then joined a third was stranded as a new speck), which photos hit
thousands of times and clean art never did. Fixing it took Inlay from 5,150
shapes to 222 on the same photos.

A slight blur before tracing (radius 2) took the mean error to 10.6 at about
the same size, but it also softens hard edges inside a photo; it's a candidate
for a future setting rather than a default.

## As a benchmark

The official npm package is a Node build, so the scripts load it directly
(`scripts/vtracer.mjs`), with no vendoring: `npm run score` (the clean-art
badge), `npm run score:photos`, `npm run site:assets` (the landing page's
comparison) and two tests. It's a devDependency.
