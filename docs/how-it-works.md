---
order: 10
---

# How it works

From a dropped file to an SVG you can edit, in six steps. Each child page goes
into one part in depth.

1. **Load and prepare** the image: decode it, downscale big ones, upscale small
   ones. → [The pipeline](how-it-works/pipeline.md)
2. **Find the colours.** Flat art's real colours are sharp peaks in its
   histogram; those become the palette. → [Palettes](how-it-works/palettes.md)
3. **Trace.** Logo, Illustration, Line art and Pixel art use **Inlay**, our own
   shared-edge tracer, which traces every boundary between two colours once,
   so the pieces fit together like inlaid wood. → [Inlay](how-it-works/inlay.md)
4. **Fit curves.** Each boundary becomes the fewest straight lines and curves
   that follow it, with sharp corners kept sharp; Pixel art keeps its exact
   pixel staircase instead. → [Curve fitting](how-it-works/curve-fitting.md)
5. **Poster** goes through VTracer instead, which suits photos' soft bands.
   → [VTracer](how-it-works/vtracer.md)
6. **Optimise** with SVGO in the background, so the numbers shown are the
   numbers you download.

Throughout, quality is measured rather than judged by eye.
→ [Measuring quality](how-it-works/measuring-quality.md)

## Why classical tracing, not AI

The research before any code was written ([Research](research.md)) found that
no downloadable model beats a good classical tracer at the tracing itself. The
learned models (StarVector, OmniSVG) need a 16 GB GPU and 10–80 seconds per
image, and on illustrations they lost to VTracer outright. AI earns its place
*around* the tracer, for removing backgrounds and upscaling low-resolution
logos, and that is on the [roadmap](roadmap.md).
