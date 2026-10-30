---
'inlaytrace': patch
---

Gradient fills no longer smear one shape into its neighbour on painted art (a face into the hair or shadow beside it): a gradient must stay within 20 RGB levels of the image, and must draw each of the bands it replaces no worse than that band's own colour did.
