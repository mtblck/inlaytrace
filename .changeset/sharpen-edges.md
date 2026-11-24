---
'inlaytrace': minor
---

New `sharpen` option for the colour presets, and `sharpenEdges(rgba, width, height)` and `edgeBlur(rgba, width, height)` on their own: a blurry image's soft edges are snapped back to steps before the palette is picked, so the blur no longer traces as a band of an in-between colour round every shape, and thin lines keep their colour. Images whose edges measure crisp are left as they are.
