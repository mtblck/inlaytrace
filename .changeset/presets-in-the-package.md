---
'inlaytrace': minor
---

Presets in the package, and a simpler call: `trace(image, { preset: 'logo' })`. `image` is anything shaped like ImageData (`{ data, width, height }`). The seven presets the app uses (`logo`, `illustration`, `outline`, `lineart`, `centerline`, `poster`, `pixel`) each pick their own palette and carry their own defaults, and any option overrides them. `palette` traces in your own colours, `layers` replaces `stacked`, `invert` traces light ink, and `presets` lists every default. Centerline paths are now `{ d, fill, stroke }` like Outline art's lines (`fill` the colour, `stroke` the width). `trace(rgba, width, height, options)`, `traceCenterline` and `centerlineToSvg` still work but are deprecated, and go in 1.0.
