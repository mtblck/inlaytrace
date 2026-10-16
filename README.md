# img-to-svg

Turn a PNG, JPG or WebP into a clean SVG — in the browser, without uploading it
anywhere.

Live (soon): https://mattblack.space/tools/img-to-svg/

## Status

Pre-build. The research that decides the approach is in
[`docs/research.md`](docs/research.md). Short version: a classical tracer
(VTracer, compiled to WASM) beats every downloadable AI model at the actual
tracing, so AI is used *around* it — background removal and upscaling, both in
the browser — with an optional capped server mode for a hosted vectorizer.

## Planned

1. **Core** — VTracer in a Web Worker, SVGO cleanup, presets (logo, line art,
   pixel art, poster), split/overlay diff view, live path/node/byte counts,
   editable palette, per-colour layer export.
2. **AI assist** — in-browser background removal (BiRefNet) and upscaling
   (Real-ESRGAN), models cached locally.
3. **HD mode** — optional hosted vectorizer behind a Vercel Function with a
   spend cap.
