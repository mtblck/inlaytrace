---
'inlaytrace': minor
---

New `strokes` option for flat outline art: in palette mode, the colours drawn mostly as thin, long lines are traced down their middle as one stroked path each (`InlayPath.stroke` is the width measured from the ink), with their anti-aliased edges and darker shades joined in, and the shapes either side meet beneath them. Small lettering, short marks and solid shapes stay shapes. `scale` says how far the image was enlarged, so the line widths scale with it. Off by default; output without it is unchanged.

`toSvg` and `centerlineToSvg` now escape the attribute values they write, so a palette colour given with a quote in it can't end its attribute.
