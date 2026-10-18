---
'inlaytrace': patch
---

Photos: `quantizePalette(rgba, n)` picks a photo's colours by k-means in OKLab (deterministic), and the `stacked` option draws each shape whole, larger shapes first, instead of cutting holes (same picture, less path data, no hairline seams). Also fixes speck merging, which could strand fragments of merged specks as new specks: on photos that left thousands of extra shapes, and a larger `speckle` gave more shapes rather than fewer.
