---
'inlaytrace': minor
---

New `boostLines(rgba, width, height, radius?)`: darkens faint painted outlines (thin lines darker than both their sides, found with a black-hat filter) before the palette is picked, so a mouth on a shadowed face or a line between two near-equal colours labels apart from them instead of being lost. Short dark marks are left alone as texture.
