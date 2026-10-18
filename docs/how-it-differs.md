---
order: 30
---

# What we do differently

How Inlay compares with the image-to-SVG tools people already use, and
where it deliberately goes its own way. Competitor details were checked on
2026-10-17 from each tool's own site, or come from the
[research](research.md); some may have changed since.

## The field

| Tool | Where it runs | Cost | Tracing | Editing |
| --- | --- | --- | --- | --- |
| **Inlay** | Your browser; nothing uploaded | Free | Inlay, our shared-edge tracer, for everything from logos and pixel art to photos, plus centerline strokes | Colours (replace, merge, remove), background, select/move/scale shapes, nodes and handles, mirror and turn (detected), undo |
| **Vectorizer.ai** | Their servers (kept 24 h) | Paid downloads | Proprietary; symmetry and shape fitting | "Refine result": palette, recolour/merge/remove regions, toggle symmetries, fit shapes, sharpen/round corners. No node editing |
| **Vector Magic** | Their servers, or a paid desktop app | Paid | Proprietary | Edits the colour regions before re-vectorising |
| **Illustrator Image Trace** | Desktop | Subscription | Proprietary; presets, colour/path/corner/noise controls | Full editor after *Expand* |
| **Inkscape Trace Bitmap** | Desktop | Free (GPL) | Potrace; colours as stacked scans | Full editor |
| **SVGcode** | Browser, offline PWA | Free | Potrace per posterised colour | None (hands off to other editors) |
| **VTracer demo** | Browser | Free | VTracer | None |

## What's different here

**Edges shared exactly, traced once.** Most tracers trace each colour region on
its own, so every edge between two colours exists twice. How closely the two
copies agree depends on the tracer: VTracer's stay within 0.06 px of each other
on our sample, while fitting each region separately (our own first attempt)
opened hairline gaps. Inlay traces each boundary once and both neighbours use
it, so the copies are identical by construction and layers register exactly
for print and vinyl.
→ [Inlay](how-it-works/inlay.md)

**Shapes a designer would draw.** Straight edges are single lines, corners are
single sharp points measured from their two sides, round ends stay round, and
circles are four curves. VTracer smoothed our sample's straight slopes into
S-bends; Inlay is more accurate with a third fewer nodes.
→ [Curve fitting](how-it-works/curve-fitting.md)

**Colours that are actually in the image.** The palette comes from histogram
peaks rather than a quantizer's averages, which drift (a gold sun came out
peach).
→ [Palettes](how-it-works/palettes.md)

**You can see the error.** A Difference view lights up every pixel where the SVG
and the original disagree, and the stats show the optimised file's real size.
No other tool surveyed shows its own error.

**Free, private and editable together.** The hosted tools that let you refine a
trace are paid and upload your image; the free browser tools trace but don't
edit; the desktop editors can do anything but are a separate install and a
general drawing program. Here the image never leaves your device, and you can
fix the result: nodes, curves, colours, background, mirror, with undo.

**Measured, not tuned by eye.** Every tracer change is scored against clean art
at 4× (`npm run score`), and the numbers are written down.
→ [Measuring quality](how-it-works/measuring-quality.md)

## What others do that we don't (yet)

Each of these is on the [roadmap](roadmap.md):

- **More formats**: DXF (Vectorizer.ai); offline install (SVGcode).

Not planned: a full drawing program (Illustrator, Inkscape: pen tool, booleans,
text). Inlay fixes a trace; for more, export the SVG to one of those.
