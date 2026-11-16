---
'inlaytrace': minor
---

A command line: `npx inlaytrace logo.png -o logo.svg --preset logo`. PNGs are read with Node's own zlib, so the package still has no dependencies; JPEG, WebP, GIF and TIFF use sharp when it's installed beside it. `--help` lists the flags, which follow the trace options.
