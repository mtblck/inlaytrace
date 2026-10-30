---
'inlaytrace': minor
---

Painted lines stay through smoothing and clean-up: `boostLines` can mark the pixels it darkens (a `lines` array), `smoothShading` takes a `keep` mask it leaves alone, and the tracer's new `lines` option stops a marked line from being folded into a neighbour as a sliver. A dark outline between two dark areas (trousers against a night background) now keeps them apart.
