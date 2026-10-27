---
'inlaytrace': patch
---

In images saved without loss (PNG), edges are placed between pixels from their anti-aliasing instead of on the pixel grid: straight sides land where they really are, and small shapes come out cleaner (4–16% fewer wrong pixels on the PNG fixtures, for the same nodes). JPEG and WebP traces are unchanged.
