---
'inlaytrace': patch
---

New `closeGaps` option: a line broken by a small gap (up to 1.6 times its width, and 5.5 px) is joined before tracing, in line art's ink (`mode: 'binary'`), Outline art's lines (`strokes`) and `centerline`. Dashes and gaps drawn on purpose stay open. Off by default.
