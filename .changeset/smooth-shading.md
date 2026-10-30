---
'inlaytrace': minor
---

New `smoothShading(rgba, width, height)`: an edge-preserving (bilateral) filter for painted art, run before picking the palette. Brush and JPEG noise inside a shadow evens out, so the shadow traces as one shape instead of flecks of its two nearest colours, while the edges between colours stay sharp.
