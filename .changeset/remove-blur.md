---
'inlaytrace': minor
---

New `deblur` option (and `--deblur` on the command line) for soft photos, screenshots and enlarged copies of flat-colour art. A blurred edge is a ramp, and its middle traced as a band of an in-between colour round every shape. `deblur` measures the blur place by place, finds the flat colours the image is made of, and works out the flat shapes that, blurred the same way, look like the image; those are traced instead. It tells a lens's blur from a resize's, which decides where each edge sits, and takes out a colour fringe on the way. Images whose edges measure crisp are left as they are. On a soft photo of a dump-truck logo the Logo SVG went from 411 KB with a halo round every shape to 93 KB without. Also exported: `deblur(rgba, width, height)` and `edgeBlur(rgba, width, height)`, which measures how soft an image's edges are, in px.
