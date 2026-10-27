---
'inlaytrace': patch
---

In images with exactly flat colours, such as most PNG exports, edges are placed between pixels from their anti-aliasing instead of on the pixel grid: straight sides land where they really are, and small shapes come out cleaner (2–16% fewer wrong pixels on the PNG fixtures, for the same nodes). Whether an image qualifies is judged from its pixels, so typical JPEG and WebP traces and Poster are unchanged.
