---
'inlaytrace': minor
---

New `strokes` option for flat outline art: in palette mode, a colour that is mostly thin, long regions is traced down its middle as one stroked path (`InlayPath.stroke` is the width measured from its ink), with its anti-aliased edges and darker shades joined in, and the shapes either side meet beneath it. Lines under 2.5 px wide, and solid shapes in the line's colour, stay shapes. Off by default; output without it is unchanged.
