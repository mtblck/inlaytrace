---
'inlaytrace': minor
---

The package entry no longer exports `mergeLabels`, `otsu`, `staircase` or `colorAt`. They were internals, exported for the app's tests and never documented. Everything left is in the API reference and stays through 1.0.
