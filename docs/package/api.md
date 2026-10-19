---
order: 3
---

# API reference

Everything `inlaytrace` exports. Types are TypeScript.

## Tracing

### `trace(rgba, width, height, options)`

```ts
function trace(rgba: ArrayLike<number>, width: number, height: number, options: InlayOptions): InlayResult
```

Traces RGBA pixels (4 bytes a pixel, row by row, as `getImageData().data` or
sharp's raw output) into filled shapes that share their edges exactly. See
[Options](options.md).

### `toSvg(result)`

```ts
function toSvg(result: InlayResult): string
```

The result as an SVG document, with `width`, `height` and a `viewBox`.

### `traceInlay(rgba, width, height, options)`

```ts
function traceInlay(rgba: ArrayLike<number>, width: number, height: number, options: InlayOptions): string
```

`toSvg(trace(…))` in one call.

### Types

```ts
type InlayResult = { width: number; height: number; paths: InlayPath[] }
type InlayPath = { d: string; fill: string } // absolute M/L/C/Z, nonzero fill; largest first

type InlayOptions = FitOptions & {
  speckle: number
  pixels?: boolean
  stacked?: boolean
} & (
    | { mode: 'palette'; palette: string[]; merge?: Record<string, string> }
    | { mode: 'binary'; threshold: number | null }
  )

type FitOptions = { tolerance: number; cornerAngle: number; smoothing?: number }
```

## Palettes

### `peakPalette(rgba, maxColors, options?)`

```ts
function peakPalette(rgba: ArrayLike<number>, maxColors: number, options?: { minDistance?: number; minShare?: number; minDetail?: number }): string[]
```

Up to `maxColors` colours from the peaks of the histogram, heaviest first (a
colour's weight is the pixels within `minDistance / 2` of it). `minDistance`
(OKLab, default 0.07) is how far apart two colours must be to count
separately; `minShare` (default 0.002) is the share of the image a colour
needs, and `minDetail` (default 0.0005) the smaller share enough for one that
isn't a blend of two colours already picked.

### `exactPalette(rgba, maxColors)`

```ts
function exactPalette(rgba: ArrayLike<number>, maxColors: number): string[]
```

The image's exact colours, most-used first, up to `maxColors`.

### `quantizePalette(rgba, maxColors, options?)`

```ts
function quantizePalette(rgba: ArrayLike<number>, maxColors: number, options?: { iterations?: number }): string[]
```

Up to `maxColors` colours that best summarise the image, for photos: k-means
in OKLab over a colour histogram, seeded deterministically (the most common
colour, then the farthest from those chosen), at most `iterations` rounds
(default 16). Each colour is the mean of its cluster's pixels, most common
first. Fewer colours come back when the image has fewer.

### `oklab(rgb)`

```ts
function oklab(rgb: [number, number, number]): [number, number, number]
```

sRGB (0–255) to OKLab, the perceptual colour space the palettes and labelling
use.

## Centerline

### `centerline(rgba, width, height, options)`

```ts
function centerline(rgba: ArrayLike<number>, width: number, height: number, options: CenterlineOptions): CenterlineResult

type CenterlineOptions = {
  threshold: number | null // ink is darker than this (0–255); null adapts to the neighbourhood
  speckle: number // ink and paper specks smaller than speckle × speckle px are folded away
  tolerance: number // px between the skeleton and the fitted stroke
  cornerAngle: number // degrees
  strokeWidth?: number // px; measured from the ink when left out
  color?: string // default '#000000'
}
type CenterlineResult = {
  width: number
  height: number
  paths: { d: string; stroke: string; strokeWidth: number }[]
  measuredWidth: number // the ink's width, px
}
```

Single strokes down the middle of the ink, for pen plotters and engraving,
instead of outlines round it. The ink is thinned to a one-pixel skeleton
(Zhang–Suen, then any pixel its neighbours don't need), spurs shorter than the
stroke is wide are pruned, and the skeleton is walked into strokes between ends
and junctions. Strokes that carry straight on through a crossing (within 30°)
are joined, so a pen lifts less. Each stroke is fitted with the same curve
fitter as outlines. The width is the ink's area over the skeleton's length.

### `traceCenterline(rgba, width, height, options)`, `centerlineToSvg(result)`

The same as an SVG string: one `<path>` with `fill="none"`, the stroke colour
and width, and round caps and joins.

## Symmetry

### `detectSymmetry(rgba, width, height, options?)`

```ts
function detectSymmetry(rgba: ArrayLike<number>, width: number, height: number, options?: SymmetryOptions): Symmetry[]

type Symmetry =
  | { kind: 'mirror'; orientation: 'vertical' | 'horizontal'; position: number; score: number }
  | { kind: 'rotation'; order: number; cx: number; cy: number; score: number }

type SymmetryOptions = {
  tolerance?: number // RGB distance counted as the same colour; default 60
  orders?: number[] // rotational orders to try; default 2–8
}
```

Scores the best vertical and horizontal mirror axis and the best centre for
each rotational order, highest score first. `score` is the share of the drawing
(every pixel that isn't background, on either side) whose reflection or turn
has the same colour, 0–1. A clean symmetric drawing scores close to 1; about
0.95 is a sensible bar for "likely". Positions are in pixels: a vertical axis at
`position` 50 lies between pixels 49 and 50. A round drawing scores well for
every order. Returns `[]` when there's almost nothing but background.

The background is the most common colour round the border (or transparency).
Only candidates near the foreground's centroid are scored, since that's where
any axis or centre of a symmetric drawing lies.

## Curves

### `fitChain(points, closed, options)`

```ts
function fitChain(points: Pt[], closed: boolean, options: FitOptions): Cubic[]
```

The fitter on its own: a chain of points about a pixel apart (an open run
whose ends stay fixed, or a closed loop) to the fewest lines and cubic
Béziers that follow it within `tolerance`, with corners kept sharp. Each
`Cubic` is `[start, handle1, handle2, end]`; straight ones have their handles
on the line. See [Curve fitting](../how-it-works/curve-fitting.md).

### `isFlat(cubic)`, `pointAt(cubic, t)`

Whether a cubic is a straight line (its handles within 0.15 px of the chord),
and the point at parameter `t` (0–1).

## Path data

### `parsePath(d)`, `serializePath(subpaths)`

```ts
type Pt = { x: number; y: number }
type PathNode = { x: number; y: number; in: Pt | null; out: Pt | null }
type Subpath = { nodes: PathNode[]; closed: boolean }

function parsePath(d: string): Subpath[]
function serializePath(subpaths: Subpath[]): string
```

SVG path data as nodes with absolute handles (the model vector editors use),
and back as `M`/`L`/`C`/`Z`. Relative commands, `H`, `V`, `S`, `Q` and `T` are
read; arcs become straight lines. Writing rounds to three decimals and is
idempotent after the first pass, so editing one node never nudges the rest.

### `mapPoints(subpaths, f)`

Applies `f` to every node and handle, for transforms.
