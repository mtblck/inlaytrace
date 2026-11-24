---
order: 3
---

# API reference

Everything `inlaytrace` exports. Types are TypeScript.

## Tracing

### `trace(image, options?)`

```ts
function trace(image: ImageLike, options?: TraceOptions): InlayResult
type ImageLike = { data: ArrayLike<number>; width: number; height: number } // ImageData, or sharp's raw data with its info's size
```

Traces RGBA pixels (4 bytes a pixel, row by row) into filled shapes that share
their edges exactly, or with the `centerline` preset into strokes. The preset
(default `logo`) picks the palette, any steps before tracing and every
default; any option given overrides it. See [Options](options.md). Throws on
an unknown preset, or when `data` is shorter than `width × height × 4`. The
image's pixels are never changed.

The 0.3 form, `trace(rgba, width, height, options)` with `mode: 'palette'` or
`'binary'` and a palette you pick yourself, still works but is deprecated: it
goes in 1.0. Its options are below as `InlayOptions`.

### `toSvg(result)`

```ts
function toSvg(result: InlayResult): string
```

The result as an SVG document, with `width`, `height` and a `viewBox`.

### `traceInlay(image, options?)`

```ts
function traceInlay(image: ImageLike, options?: TraceOptions): string
```

`toSvg(trace(…))` in one call. Also takes the deprecated 0.3 form.

### `traceAsync(image, options?)`

```ts
function traceAsync(image: ImageLike, options?: TraceAsyncOptions): Promise<InlayResult>
type TraceAsyncOptions = TraceOptions & {
  signal?: AbortSignalLike // an AbortController's signal: stops the trace, rejecting with the signal's reason
  onProgress?: (step: TraceStep) => void // called at each pause
}
type AbortSignalLike = { readonly aborted: boolean; readonly reason?: unknown }
type TraceStep = { stage: TraceStage; done: number } // done: how far through the stage, 0 to 1
type TraceStage = 'palette' | 'label' | 'clean' | 'regions' | 'fit' | 'shapes'
```

`trace` that can be stopped and reports progress: it gives the same result,
but pauses between its stages (and every few hundred edges while fitting),
calling `onProgress`. About every 12 ms it lets the thread get on with other
work, so a page that traces on its main thread can keep responding, and a
Cancel button can abort it. When `signal` aborts, it rejects at the next pause
with the signal's `reason` (an `Error` named `AbortError` when there is none),
and it doesn't start at all on a signal that has already aborted. Bad input
rejects with the error `trace` would throw. The centerline preset reports only
its start. In a Web Worker, terminating the worker stops a trace too, without
this.

```ts
const controller = new AbortController()
cancelButton.onclick = () => controller.abort()
const result = await traceAsync(imageData, {
  preset: 'poster',
  signal: controller.signal,
  onProgress: ({ stage, done }) => (status.textContent = `${stage} ${Math.round(done * 100)}%`),
})
```

### `presets`

```ts
const presets: Record<PresetName, PresetDefaults>
type PresetName = 'logo' | 'illustration' | 'outline' | 'lineart' | 'centerline' | 'poster' | 'pixel'
```

Each preset's defaults (`colors`, `speckle`, `tolerance`, `cornerAngle`,
`shapes`, `layers`, `strokes`, `gradients`, `closeGaps`, `threshold`) and its
`kind`: `'colour'`, `'ink'` or `'centerline'`. Read-only; to change one, pass
the option to `trace`.

### Types

```ts
type InlayResult = { width: number; height: number; paths: InlayPath[]; measuredWidth?: number } // measuredWidth: centerline only, the stroke width measured from the ink
type InlayPath = { d: string; fill: string; stroke?: number; gradient?: Gradient } // absolute M/L/C/Z, nonzero fill; largest first. With `strokes`, lines come last: `stroke` is their width, `fill` their colour, unfilled. With `gradients`, a shaded shape has `gradient`, and `fill` is its average colour

// In the trace's pixels (userSpaceOnUse); offsets 0–1, colours #rrggbb, interpolated in sRGB
type Gradient =
  | { type: 'linear'; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] }
  | { type: 'radial'; cx: number; cy: number; r: number; stops: GradientStop[] }
type GradientStop = { offset: number; color: string }

type TraceOptions = {
  preset?: PresetName
  colors?: number
  palette?: string[] // your own colours: traced with only these
  merge?: Record<string, string>
  speckle?: number
  tolerance?: number
  cornerAngle?: number
  smoothing?: number
  shapes?: boolean
  layers?: boolean
  strokes?: boolean
  gradients?: boolean
  closeGaps?: boolean
  scale?: number
  threshold?: number | 'auto' | null // lineart, centerline
  invert?: boolean // lineart, centerline
  strokeWidth?: number // centerline
  deblur?: boolean
  smoothShading?: boolean
  keepOutlines?: boolean
  grayscale?: boolean // greys only, `colors` of them
}

// The deprecated 0.3 form's options
type InlayOptions = FitOptions & {
  speckle: number
  pixels?: boolean
  stacked?: boolean
  photo?: boolean
  strokes?: boolean
  scale?: number
  gradients?: boolean
  closeGaps?: boolean // join lines' ends across small breaks before tracing: line art's ink (binary), and Outline art's lines (strokes)
  lines?: ArrayLike<number> // painted lines, one entry per pixel (from boostLines): a region mostly on them folds only into another such region (not one in the colour of a shape it touches), unless it is a sliver under 16 px across
} & (
    | { mode: 'palette'; palette: string[]; merge?: Record<string, string> }
    | { mode: 'binary'; threshold: number | 'auto' | null }
  )

type FitOptions = { tolerance: number; cornerAngle: number; smoothing?: number }
```

## Palettes

### `peakPalette(rgba, maxColors, options?)`

```ts
function peakPalette(
  rgba: ArrayLike<number>,
  maxColors: number,
  options?: { minDistance?: number; minShare?: number; minDetail?: number; width?: number; minTint?: number; minFlat?: number },
): string[]
```

Up to `maxColors` colours from the peaks of the histogram, heaviest first (a
colour's weight is the pixels within `minDistance / 2` of it). `minDistance`
(OKLab, default 0.07) is how far apart two colours must be to count
separately; `minShare` (default 0.002) is the share of the image a colour
needs, and `minDetail` (default 0.0005) the smaller share enough for one that
isn't a blend of two colours already picked. Given the image's `width`, it
also looks at which pixels are flat (their four neighbours within 8 per
channel): a blend that is never flat is an edge and is left out at any share
under 2%, and spare slots go to pale flat tints at least `minTint` (default 0.02)
from every colour picked and flat over at least `minFlat` (default 0.001) of
the image, such as a pale fill on white.

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

### `smoothShading(rgba, width, height, keep?)`

```ts
function smoothShading(rgba: ArrayLike<number>, width: number, height: number, keep?: ArrayLike<number>): Uint8ClampedArray
```

A smoothed copy of the image for tracing painted art: a bilateral filter
(radius 4 px, three passes) that averages each pixel only with neighbours of
a similar colour. Brush and JPEG noise inside a shadow evens out, so the shadow
labels as one colour instead of flecks of two; edges between colours stay put.
Transparent pixels, and any non-zero in `keep` (one entry per pixel), are left
alone and never averaged in. Run it before picking the palette and pass the
result to `trace`.

### `deblur(rgba, width, height, blur?, scale?)` and `edgeBlur(rgba, width, height)`

```ts
function deblur(rgba: ArrayLike<number>, width: number, height: number, blur?: number, scale?: number): Uint8ClampedArray
function edgeBlur(rgba: ArrayLike<number>, width: number, height: number): number
```

`edgeBlur` measures how soft the image's edges are, in px: the Gaussian blur a
hard edge would need to look like the image's bold edges (the median over
them; 0 with none). Crisp art reads under 1 px, JPEG or not; the same art
blurred by 2 px reads about 2.

`deblur` returns a copy with the blur taken out, for tracing a soft photo,
screenshot or enlargement of flat art. It measures the blur place by place,
finds the flat colours the image is made of, and searches for the map of those
colours that, blurred the same way, best matches the image with the least
boundary. That map's boundaries are then smoothed along their length, as far
as the blur leaves their place open, so straight edges come out straight and
corners stay corners, and it is drawn with clean anti-aliased edges. It works out
whether the blur was a lens's (of light) or a resize's (of the stored values),
which decides where each edge sits, and undoes a colour fringe first. `blur`
is `edgeBlur`'s reading, measured when left out; under 1.5 px the image is
only copied. For an image enlarged `scale` times first, that threshold grows
with it. Alpha is kept, and the colour under transparent pixels isn't blurred
in. An image with fewer than two flat colours (a line drawing, a photo) is
only copied. Shading comes out flat. About 3 s for a megapixel image.

### `boostLines(rgba, width, height, radius?, lines?)`

```ts
function boostLines(rgba: ArrayLike<number>, width: number, height: number, radius?: number, lines?: Uint8Array): Uint8ClampedArray
```

A copy of the image with faint painted outlines darkened, so they label apart
from the colours on either side: a black-hat filter over `radius` px (default
2; 3 for an image enlarged 2×) finds lines up to about twice that wide that are
darker than both sides, and each is darkened by twice its depth, at most 30
levels, keeping its colour. Lines shorter than four times the radius are left
alone as texture. Each pixel darkened is set to 1 in `lines` when it's given
(one entry per pixel): pass that to `smoothShading` as `keep` and to `trace`
as `lines`, or smoothing blurs a dark line back into its sides and the
clean-up after labelling folds it into a near-black neighbour. Run it before
`smoothShading`.

## Centerline

### `centerline(rgba, width, height, options)`

```ts
function centerline(rgba: ArrayLike<number>, width: number, height: number, options: CenterlineOptions): CenterlineResult

type CenterlineOptions = {
  threshold: number | 'auto' | null // ink is darker than this (0–255); 'auto' is the image's own split (Otsu); null adapts to the neighbourhood
  speckle: number // ink and paper specks smaller than speckle × speckle px are folded away
  tolerance: number // px between the skeleton and the fitted stroke
  cornerAngle: number // degrees
  strokeWidth?: number // px; measured from the ink when left out
  color?: string // default '#000000'
  closeGaps?: boolean // join lines' ends across small breaks before tracing
}
type CenterlineResult = InlayResult & { measuredWidth: number } // the ink's width, px
```

Since 0.4 each path is `{ d, fill, stroke }` like Outline art's lines: `fill`
is the colour and `stroke` the width. `trace(image, { preset: 'centerline' })`
is the same trace with the preset's defaults.

Single strokes down the middle of the ink, for pen plotters and engraving,
instead of outlines round it. The ink is thinned to a one-pixel skeleton
(Zhang–Suen, then any pixel its neighbours don't need), spurs shorter than the
stroke is wide are pruned, and the skeleton is walked into strokes between ends
and junctions. Strokes that carry straight on through a crossing (within 30°)
are joined, so a pen lifts less. Each stroke is fitted with the same curve
fitter as outlines. The width is the ink's area over the skeleton's length.

### `traceCenterline(rgba, width, height, options)`, `centerlineToSvg(result)`

Deprecated since 0.4, going in 1.0: use `traceInlay(image, { preset: 'centerline' })`
and `toSvg`, which draw the same `<path>` (`fill="none"`, the stroke colour and
width, round caps and joins).

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
