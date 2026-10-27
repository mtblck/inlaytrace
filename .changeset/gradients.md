---
'inlaytrace': patch
---

New `gradients` option: soft shading that a palette splits into bands of tints is traced as one shape with a linear or radial gradient (`path.gradient`, written by `toSvg` as `<linearGradient>` / `<radialGradient>`), when the gradient fits much better than a flat colour. Off by default.
