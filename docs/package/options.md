---
order: 2
---

# Options

`trace(image, options)` starts from a preset and takes any of these to
override it. Left out, each comes from the preset (`presets` lists them).

## Preset and colours

| Option | Type | What it does |
| --- | --- | --- |
| `preset` | `'logo'` (default), `'illustration'`, `'outline'`, `'lineart'`, `'centerline'`, `'poster'`, `'pixel'` | What the image is. Colour presets pick their palette from the image: `logo`, `illustration` and `outline` from the histogram's peaks (`peakPalette`), `poster` by clustering (`quantizePalette`), `pixel` from its exact colours (`exactPalette`, or clustering when they cover under 90% of it, as a JPEG's do). `lineart` and `centerline` trace one ink. |
| `colors` | number | Colour presets: at most this many colours. Logo 8, Illustration, Outline and Poster 24, Pixel art 32. |
| `palette` | `string[]` | Colour presets: your own colours (`#rrggbb`), traced with only these instead of picking from the image. Gradients go off with it, since their stops would bring back the image's colours. |
| `merge` | `Record<string, string>` | See [`merge`](#mode-palette-colour-art) below. |
| `layers` | boolean | Shapes in layers, each whole, instead of cut out to tile. See `stacked` below, which is what it sets. On for Illustration, Outline and Poster; off for Logo, since cutters and screen printers want cut-out shapes. |
| `threshold` | number, `'auto'` or `null` | `lineart` and `centerline`: see [binary mode](#mode-binary-line-art). Default `'auto'`. |
| `invert` | boolean | `lineart` and `centerline`: light ink on a dark background. A copy of the pixels is flipped; yours are left alone. |
| `strokeWidth` | number, px | `centerline`: the stroke width; measured from the ink when left out. |
| `sharpen` | boolean | Colour presets: [`sharpenEdges`](api.md) first, so a blurry image's soft edges don't trace as a band of an in-between colour round every shape. Does nothing to an image whose edges measure crisp. |
| `smoothShading` | boolean | Colour presets: [`smoothShading`](api.md) first, so painted shading doesn't break into flecks. |
| `keepOutlines` | boolean | Colour presets: [`boostLines`](api.md) first, so faint painted outlines stay apart from the shapes they part. Looks for wider lines on an enlarged image (`scale`). |
| `grayscale` | boolean | Colour presets but `pixel`: trace in greys only, `colors` of them. Each pixel becomes the grey of its own OKLab lightness before the palette is picked. Ignored with your own `palette`. |

## Fitting

| Option | Type | What it does |
| --- | --- | --- |
| `tolerance` | number, px | How far the fitted outline may stray from the pixels. Higher means fewer nodes and a smaller file. 1 suits most logos. |
| `cornerAngle` | number, degrees | Turns sharper than this stay sharp corners; gentler ones become curves. |
| `speckle` | number, px | Regions smaller than `speckle` × `speckle` pixels merge into whatever surrounds them. 0 keeps everything. In flat art (no `photo`), a region at least 0.25 (OKLab) from every colour around it, such as a letter, stays from an eighth of that area up (at least 6 px). |
| `smoothing` | number, px (optional) | Half-window of the smoothing over the pixel staircase. Default 12; it narrows by itself on tight curves. |
| `shapes` | boolean (optional) | Exact shapes: an outline that has one neighbour all the way round and is a circle, an ellipse, a rectangle, a rounded rectangle or a regular polygon (3–12 sides) is drawn as that shape exactly, rather than as fitted curves. Only outlines that fit within 0.3 px RMS (0.85 px at worst) qualify, so a shape that's nearly round stays as traced. Both sides of the edge get the same shape, so shapes still tile. Default false. |
| `strokes` | boolean (optional) | Lines as strokes, for flat outline art (palette mode, not with `photo` or `pixels`). A colour that stands out from the paper (0.25 in OKLab) and is at least 30% thin, long parts (up to 8 px wide and eight times as long; wider areas of it are left out first, so an outline running into a solid area still counts) becomes a line. Its anti-aliased edges and darker shades join it; each connected piece is then measured, and only pieces at least 2.5 px wide, eight times as long as wide and within 20% of the colour's usual width are traced, down their middle, as one stroked path `{ d, fill, stroke }` (`stroke` is the measured width), drawn after the shapes with round caps and joins. The rest (small lettering, short marks, a heading in the same ink) stays shapes. The shapes either side grow under the line to its middle. Default false. |
| `scale` | number (optional) | With `strokes`: how many times the image was enlarged before tracing (an upscaled small image, a full-size trace). The widths above are multiplied by it. Default 1. |
| `gradients` | boolean (optional) | Soft shading as gradients (palette mode, not with `pixels`). Neighbouring regions whose boundary is soft (across it the image changes by under 0.4 of their two colours' difference, or under 10 levels) are one shade; if a linear or a radial gradient, fitted by least squares on their pixels, at least halves the error of one flat colour and comes within 10% of the bands' own, they become one shape filled with it. A neighbour the gradient draws at least as well as its own colour joins it. The path gets `gradient` (`{ type: 'linear', x1, y1, x2, y2, stops }` or `{ type: 'radial', cx, cy, r, stops }`, in the trace's pixels, stops `{ offset: 0–1, color }`), and its `fill` is the shade's average colour; `toSvg` writes the gradients in `<defs>` with `gradientUnits="userSpaceOnUse"`, and fills the path with `url(#…) #rrggbb`, its average colour as the fallback. Default false: a cutter or a plotter can only draw flat colour. |
| `pixels` | boolean (optional) | The 0.3 form only; the `pixel` preset sets it. Pixel art: no clean-up and no curve fitting; every boundary is its exact pixel staircase. |
| `photo` | boolean (optional) | The 0.3 form only; the `poster` preset sets it. Photos: a speck joins the colour it shares the most edge with, and slivers are left alone. Without it (flat art) a speck joins the nearest colour, and slivers under 2 px wide fold into a neighbour of nearly the same colour, so a thin stroke that lossy compression split into two shades of its ink stays whole. |
| `stacked` | boolean (optional) | The 0.3 form's name for `layers`. Stacked shapes, for photos: each shape is drawn whole, without the holes other shapes sit in, larger shapes first, and reaching under the neighbours drawn after it. The picture is the same as cut-out shapes, without the hairline seams where anti-aliased edges meet, for more path data. Holes onto transparency are kept. Default: cut out, which is what vinyl cutters and screen printers want. |

## Modes (the 0.3 form)

The deprecated `trace(rgba, width, height, options)` takes one of these two
modes, with a palette you pick yourself. The presets choose them for you.

### `mode: 'palette'`: colour art

```ts
{ mode: 'palette', palette: string[], merge?: Record<string, string> }
```

Each pixel takes the nearest `palette` colour (`#rrggbb`), judged in OKLab so
"nearest" matches what you see. A pixel between two colours (anti-aliasing)
takes the nearest colour among its neighbours, so an edge never grows a sliver
of an in-between colour.

Three helpers pick a palette from the pixels:

- `peakPalette(rgba, maxColors, { width })`: the sharp peaks of the colour histogram,
  which are flat art's real colours. Close colours (under 0.07 apart in OKLab)
  count as one. A colour needs 0.2% of the image, or 0.05% if it isn't a blend
  of two colours already picked (so a small decal counts, an anti-aliased edge
  doesn't); all three can be changed with a third argument,
  `{ minDistance, minShare, minDetail }`. Pass the image's `width` too: then
  pale tints are found by their flatness (a light fill on white, too close to
  white to count as a peak), and a blend that is never flat is left out at any
  share under 2%. `minTint` (0.02) and `minFlat` (0.001) tune the tints, which are only ever pale (OKLab lightness 0.85 or more).
- `exactPalette(rgba, maxColors)`: the exact colours, most-used first. For
  pixel art, where a one-pixel eye matters and two close shades are on
  purpose.
- `quantizePalette(rgba, maxColors)`: the colours that best summarise the
  image, by k-means in OKLab. For photos, which have no histogram peaks.
  Deterministic: the same image gives the same palette every time.

`merge` folds colours together before any shape is built, so the edge between
them disappears: `{ '#e9a13b': '#d9542b' }` traces the yellow as red.

### `mode: 'binary'`: line art

```ts
{ mode: 'binary', threshold: number | 'auto' | null }
```

Ink is anything darker than `threshold` (0–255), and only ink is drawn. With
`'auto'`, the threshold is the image's own split between ink and paper
(Otsu's), so a mid-blue line traces as well as a black one; on a blank page
with nothing to split it falls back to 128. With `null`, each pixel is compared with its neighbourhood instead, for photos of
paper under uneven light. For light ink on a dark background, invert the
pixels first.

### `closeGaps`

With `closeGaps: true`, a line broken by a small gap is joined before it's
traced: in line art's ink (`mode: 'binary'`), in Outline art's lines
(`strokes: true`), and in `centerline`'s ink. Two line ends that point at each
other across a gap join, and so does a line that stops just short of another
(a T). A join crosses one gap only, at most 1.6 times the line's width and
5.5 px, so dashes and gaps left on purpose stay open. Off by default.

## The presets

These are the Inlay app's presets, and what each sets.

| Preset | Sets |
| --- | --- |
| `logo` | palette from peaks, `colors: 8`, `speckle: 8`, `tolerance: 1`, `cornerAngle: 45`, `shapes: true`, cut out |
| `illustration` | palette from peaks, `colors: 24`, `speckle: 4`, `tolerance: 0.75`, `cornerAngle: 60`, `shapes: true`, `layers: true`, `gradients: true` |
| `outline` | Illustration's, plus `strokes: true`, `closeGaps: true` |
| `lineart` | one ink, `threshold: 'auto'`, `speckle: 6`, `tolerance: 1`, `cornerAngle: 45`, `shapes: true`, `closeGaps: true` |
| `centerline` | one ink as strokes, `threshold: 'auto'`, `speckle: 4`, `tolerance: 1`, `cornerAngle: 45`, `closeGaps: true` |
| `poster` | palette by clustering, photo clean-up, `colors: 24`, `speckle: 8`, `tolerance: 0.75`, `cornerAngle: 90`, `layers: true` |
| `pixel` | exact colours, pixel staircases, `colors: 32`, `speckle: 0`, `tolerance: 0.25`, `cornerAngle: 0` |

Small images trace better upscaled first: the app scales anything under 512 px
up to about 1024 px, with smoothing, before tracing (except pixel art).
