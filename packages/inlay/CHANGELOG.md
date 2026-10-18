# inlaytrace

## 0.1.0

First published release: the tracer the [Inlay app](https://mattblack.space/tools/img-to-svg/)
uses for logos, illustrations, line art and pixel art, built as ESM with type
declarations.

- `trace(rgba, width, height, options)` in `palette` mode (flat colour, with
  optional `merge` and `pixels` for pixel art) and `binary` mode (line art).
- `toSvg`, `traceInlay`, `peakPalette`, `exactPalette`, `oklab`, `fitChain`,
  `isFlat`, `pointAt`, `parsePath`, `serializePath` and `mapPoints`.
- `mergeLabels`, `otsu` and `staircase` are exported for the app's tests and
  aren't part of the stable API.
