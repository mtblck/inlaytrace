---
order: 1
---

# The pipeline

What happens between dropping a file and seeing the trace.

## 1. Load

The file is decoded in the page (`apps/app/src/lib/image.ts`). PNG, JPG, WebP, GIF and
BMP all work; transparency is kept. Nothing leaves the browser.

## 2. Resize for tracing

| Image | What happens | Why |
| --- | --- | --- |
| Long edge under 512 px | Upscaled to 1024 px (at most 8×) with smoothing and a blur of half the scale factor | A 146×156 logo has details 2–3 px wide. Traced as-is, every pixel step became a wobble and the anti-aliasing became an extra grey colour. Upscaled and softened, the same logo traces to clean curves. |
| 512 px to 2048 px | Traced at its own size | The 640 px sample already traced accurately. |
| Long edge over 2048 px | Downscaled to 2048 px | Keeps traces around a second. Pixel art allows 4096 px. |

The panel says when either happens ("upscaled 6.6× to trace", "traced at
2048 × 1536").

## 3. Trace in a worker

The pixels go to a Web Worker (`apps/app/src/engine/worker.ts`), so a long trace never
freezes the page. The worker runs one function, `runTrace` (`apps/app/src/engine/run.ts`),
which the unit tests also call, so the tests and the app can't drift apart:

- **Logo, Illustration, Line art** → [Inlay](inlay.md), our shared-edge
  tracer, with a palette from [histogram peaks](palettes.md) (or ink/paper for
  line art).
- **Pixel art** → Inlay with the image's exact colours, keeping every pixel.
- **Poster** → Inlay with a [quantized palette](palettes.md) and stacked shapes.

For line art with **Light on dark**, the worker inverts the pixels first, since
line art always traces the dark side.

**Only the latest request waits.** Dragging a slider fires many trace requests
a second. `TraceClient` (`apps/app/src/engine/client.ts`) keeps at most one waiting
request per channel and replaces it when a newer one arrives, so the preview is
never more than one trace behind the slider.

## 4. Show it

The SVG is parsed and every `d`, `fill` and `transform` is validated against
what the tracers emit before it becomes markup (see
[Privacy and security](../features/privacy-and-security.md)). The canvas then
draws three layers: the original, the vector exactly as it will export, and an
overlay for selection, nodes and the mirror axis or turn.

## 5. Optimise in the background

300 ms after the last change, the worker runs SVGO (`preset-default`,
multipass, two decimals). The Paths, Nodes and Size figures come from that
optimised file, not the raw trace: before this, the panel showed 41 KB for a
file that downloaded at 31 KB. SVGO is about 200 KB gzipped, so it loads on
first use, not with the page.
