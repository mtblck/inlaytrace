---
'inlaytrace': patch
---

Faster colour labelling: converting colours to OKLab reads linear light from a table instead of a power per channel, which cut a 24-colour trace of an 820 × 1162 painted poster from 20 s to 11 s with the same output.
