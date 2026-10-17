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
| `speckle` | number, px | Regions smaller than `speckle` × `speckle` pixels merge into whatever surrounds them. 0 keeps everything. |
| `smoothing` | number, px (optional) | Half-window of the smoothing over the pixel staircase. Default 12; it narrows by itself on tight curves. |
| `pixels` | boolean (optional) | Pixel art: no clean-up and no curve fitting; every boundary is its exact pixel staircase. |

## Modes

### `mode: 'palette'`: colour art

```ts
{ mode: 'palette', palette: string[], merge?: Record<string, string> }
```

Each pixel takes the nearest `palette` colour (`#rrggbb`), judged in OKLab so
"nearest" matches what you see. A pixel between two colours (anti-aliasing)
takes the nearest colour among its neighbours, so an edge never grows a sliver
of an in-between colour.

Two helpers pick a palette from the pixels:

- `peakPalette(rgba, maxColors)`: the sharp peaks of the colour histogram,
  which are flat art's real colours. Close colours (under 0.07 apart in OKLab)
  count as one, and colours under 0.2% of the image are ignored; both can be
  changed with a third argument, `{ minDistance, minShare }`.
- `exactPalette(rgba, maxColors)`: the exact colours, most-used first. For
  pixel art, where a one-pixel eye matters and two close shades are on
  purpose.

`merge` folds colours together before any shape is built, so the edge between
them disappears: `{ '#e9a13b': '#d9542b' }` traces the yellow as red.

### `mode: 'binary'`: line art

```ts
{ mode: 'binary', threshold: number | null }
```

Ink is anything darker than `threshold` (0–255), and only ink is drawn. With
`null`, each pixel is compared with its neighbourhood instead, for photos of
paper under uneven light. For light ink on a dark background, invert the
pixels first.

## Starting points

These are the Inlay app's presets.

| Image | Options |
| --- | --- |
| Logo: few flat colours, crisp corners | `palette: peakPalette(px, 8)`, `speckle: 8`, `tolerance: 1`, `cornerAngle: 45` |
| Illustration: more colours, smooth curves | `palette: peakPalette(px, 16)`, `speckle: 4`, `tolerance: 0.75`, `cornerAngle: 60` |
| Line art: one ink | `mode: 'binary'`, `threshold: 128`, `speckle: 6`, `tolerance: 1`, `cornerAngle: 45` |
| Pixel art | `palette: exactPalette(px, 32)`, `pixels: true`, `speckle: 0`, `tolerance: 0.25`, `cornerAngle: 0` |

Small images trace better upscaled first: the app scales anything under 512 px
up to about 1024 px, with smoothing, before tracing (except pixel art).
Photos have no flat colours to share edges between; Inlay will trace them,
but a tracer built for photos may suit them better.
