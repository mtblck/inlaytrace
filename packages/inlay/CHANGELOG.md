# inlaytrace

## 0.1.2

### Patch Changes

- 679659c: Photos: `quantizePalette(rgba, n)` picks a photo's colours by k-means in OKLab (deterministic), and the `stacked` option draws each shape whole, larger shapes first, instead of cutting holes (same picture, less path data, no hairline seams). Also fixes speck merging, which could strand fragments of merged specks as new specks: on photos that left thousands of extra shapes, and a larger `speckle` gave more shapes rather than fewer.

## 0.1.1

### Patch Changes

- The npm page says the package has no dependencies or install scripts, and that releases carry provenance. No code changes.

## 0.1.0

First published release: the tracer the [Inlay app](https://inlaytrace.com/app/)
uses for logos, illustrations, line art and pixel art, built as ESM with type
declarations.

- `trace(rgba, width, height, options)` in `palette` mode (flat colour, with
  optional `merge` and `pixels` for pixel art) and `binary` mode (line art).
- `toSvg`, `traceInlay`, `peakPalette`, `exactPalette`, `oklab`, `fitChain`,
  `isFlat`, `pointAt`, `parsePath`, `serializePath` and `mapPoints`.
- `mergeLabels`, `otsu` and `staircase` are exported for the app's tests and
  aren't part of the stable API.
