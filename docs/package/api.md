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
} & (
    | { mode: 'palette'; palette: string[]; merge?: Record<string, string> }
    | { mode: 'binary'; threshold: number | null }
  )

type FitOptions = { tolerance: number; cornerAngle: number; smoothing?: number }
```

## Palettes

### `peakPalette(rgba, maxColors, options?)`

```ts
function peakPalette(rgba: ArrayLike<number>, maxColors: number, options?: { minDistance?: number; minShare?: number }): string[]
```

Up to `maxColors` colours from the peaks of the histogram, most common first.
`minDistance` (OKLab, default 0.07) is how far apart two colours must be to
count separately; `minShare` (default 0.002) is the smallest share of the
image a colour needs.

### `exactPalette(rgba, maxColors)`

```ts
function exactPalette(rgba: ArrayLike<number>, maxColors: number): string[]
```

The image's exact colours, most-used first, up to `maxColors`.

### `oklab(rgb)`

```ts
function oklab(rgb: [number, number, number]): [number, number, number]
```

sRGB (0–255) to OKLab, the perceptual colour space the palettes and labelling
use.

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
