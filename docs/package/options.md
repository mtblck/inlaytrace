---
order: 2
---

# Options

Every trace takes the same fitting options and one of two modes.

## Fitting

| Option | Type | What it does |
| --- | --- | --- |
| `tolerance` | number, px | How far the fitted outline may stray from the pixels. Higher means fewer nodes and a smaller file. 1 suits most logos. |
| `cornerAngle` | number, degrees | Turns sharper than this stay sharp corners; gentler ones become curves. |
| `speckle` | number, px | Regions smaller than `speckle` × `speckle` pixels merge into whatever surrounds them. 0 keeps everything. In flat art (no `photo`), a region at least 0.25 (OKLab) from every colour around it, such as a letter, stays from an eighth of that area up (at least 6 px). |
| `smoothing` | number, px (optional) | Half-window of the smoothing over the pixel staircase. Default 12; it narrows by itself on tight curves. |
| `shapes` | boolean (optional) | Exact shapes: an outline that has one neighbour all the way round and is a circle, an ellipse, a rectangle, a rounded rectangle or a regular polygon (3–12 sides) is drawn as that shape exactly, rather than as fitted curves. Only outlines that fit within 0.3 px RMS (0.85 px at worst) qualify, so a shape that's nearly round stays as traced. Both sides of the edge get the same shape, so shapes still tile. Default false. |
| `pixels` | boolean (optional) | Pixel art: no clean-up and no curve fitting; every boundary is its exact pixel staircase. |
| `photo` | boolean (optional) | Photos: a speck joins the colour it shares the most edge with, and slivers are left alone. Without it (flat art) a speck joins the nearest colour, and slivers under 2 px wide fold into a neighbour of nearly the same colour, so a thin stroke that lossy compression split into two shades of its ink stays whole. |
| `stacked` | boolean (optional) | Stacked shapes, for photos: each shape is drawn whole, without the holes other shapes sit in, larger shapes first, and reaching under the neighbours drawn after it. The picture is the same as cut-out shapes, without the hairline seams where anti-aliased edges meet, for more path data. Holes onto transparency are kept. Default: cut out, which is what vinyl cutters and screen printers want. |

## Modes

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

## Starting points

These are the Inlay app's presets.

| Image | Options |
| --- | --- |
| Logo: few flat colours, crisp corners | `palette: peakPalette(px, 8, { width })`, `speckle: 8`, `tolerance: 1`, `cornerAngle: 45`, `shapes: true` |
| Illustration: more colours, smooth curves | `palette: peakPalette(px, 16, { width })`, `speckle: 4`, `tolerance: 0.75`, `cornerAngle: 60`, `shapes: true` |
| Line art: one ink | `mode: 'binary'`, `threshold: 'auto'`, `speckle: 6`, `tolerance: 1`, `cornerAngle: 45`, `shapes: true` |
| Pixel art | `palette: exactPalette(px, 32)`, `pixels: true`, `speckle: 0`, `tolerance: 0.25`, `cornerAngle: 0` |
| Poster: a photo in flat colour bands | `palette: quantizePalette(px, 24)`, `stacked: true`, `photo: true`, `speckle: 8`, `tolerance: 0.75`, `cornerAngle: 90` |

Small images trace better upscaled first: the app scales anything under 512 px
up to about 1024 px, with smoothing, before tracing (except pixel art).
