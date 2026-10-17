---
order: 1
---

# Inlay

A browser tool that turns a PNG, JPG or WebP into a clean, editable SVG, and
the tracer behind it, published as the `inlaytrace` package. It runs entirely
on your device: the image is never uploaded, and tracing happens in a Web
Worker so the page stays responsive.

**Live:** https://mattblack.space/tools/img-to-svg/ (moving to inlaytrace.com)
<!-- site:hide -->
· **Code:** `mtblck/img-to-svg` (to be `mtblck/inlaytrace`) · **Plan:**
[Going public](launch-plan.md)
<!-- /site:hide -->

## What it does

1. **Trace.** Pick what the image is (Logo, Illustration, Line art, Poster,
   Pixel art). Each preset routes to the tracer and settings that suit it.
2. **Check.** Compare the SVG against the original with a split slider, a
   difference blend that lights up wherever they disagree, or the SVG on its
   own with path and node overlays. Zoom with a slider or a trackpad pinch.
3. **Edit.** Replace or remove colours, add a background, select shapes to move
   and scale them, drag nodes and bend curves, delete nodes or shapes, and
   mirror one half onto the other. Every edit is undoable, and `?` lists the
   keyboard shortcuts.
4. **Export.** One optimised SVG, a copy to the clipboard, or a zip with one SVG
   per colour for screen printing and vinyl cutting.

## Principles

- **Private by construction.** No server step, no analytics, a strict content
  security policy. See [Privacy and security](features/privacy-and-security.md).
- **Measure, don't eyeball.** Every tracer change is scored by rendering the
  SVG back and comparing it with the clean source art (`npm run score`). The
  numbers in these docs come from that.
- **Show the error.** A converter that looks right at a glance can still be
  quietly wrong. The difference view and overlays make every mistake visible.
- **Shapes a designer would draw.** Straight edges as single lines, corners as
  single sharp points, circles as four curves, and neighbouring shapes that
  share their edges exactly.

## The docs

- [How it works](how-it-works.md): the path from pixels to paths, the
  Inlay, curve fitting and how quality is measured.
- [Features](features.md): every feature, how to use it and how it works.
- [What we do differently](how-it-differs.md): how this compares with other
  image-to-SVG tools.
- [Roadmap](roadmap.md): suggested improvements, in priority order.
- [Research](research.md): the survey of tracers, AI models and hosted APIs
  done before any code was written.

## Where things live

| Path | What |
| --- | --- |
| `apps/app/src/engine/` | The worker, Inlay (`shapes.ts`), VTracer glue, presets |
| `packages/inlay/src/fit.ts` | Curve fitting: corners, smoothing, lines and Béziers |
| `packages/inlay/src/palette.ts` | Palettes from histogram peaks |
| `apps/app/src/lib/doc.ts`, `history.ts`, `pathdata.ts` | The editable document, undo, path data |
| `apps/app/src/lib/mirror.ts` | Mirroring with paper.js booleans |
| `apps/app/src/components/` | Canvas, controls, edit panel, colours |
| `scripts/` | `verify` (browser E2E), `score` (quality), VTracer vendoring, hosting checks |
