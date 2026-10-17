# Inlay

A raster-to-vector tracer whose shapes **share their edges exactly**, like
inlaid wood: every boundary between two colours is traced and fitted once and
used by both neighbours, so layers never gap or overlap. Straight edges come out
as single lines, corners as single sharp points, and round things as smooth
curves. Pixel art keeps its exact staircase.

Pure TypeScript with no DOM and no WebAssembly: it runs in browsers, Web
Workers and Node. MIT licensed.

It is the tracer behind the [Inlay app](https://mattblack.space/tools/img-to-svg/)
for logos, illustrations, line art and pixel art.

> Status: lives in the Inlay repo beside the app, as a workspace package, while
> its API settles. Not yet published to npm.

## Use

```ts
import { trace, toSvg, peakPalette } from 'inlaytrace'

// RGBA pixels, e.g. from canvas getImageData().data
const result = trace(rgba, width, height, {
  mode: 'palette',
  palette: peakPalette(rgba, 8), // the image's main colours, as #rrggbb
  speckle: 8,      // merge regions smaller than 8 × 8 px into their surroundings
  tolerance: 1,    // px the fitted outline may stray from the pixels
  cornerAngle: 45, // turns sharper than this stay corners
})

result.paths // [{ d: 'M…Z', fill: '#rrggbb' }, …] largest first, nonzero fill
toSvg(result) // '<svg …>…</svg>'
```

### Modes

| Options | For |
| --- | --- |
| `mode: 'palette', palette` | Flat colour art. `palette` is the colours to label pixels with: `peakPalette(rgba, n)` takes the sharp peaks of the histogram (flat art's real colours); `exactPalette(rgba, n)` takes the image's exact colours, most-used first. |
| `mode: 'palette', palette, merge` | Fold colours together before regions are built, so the edge between them disappears: `{ '#from': '#into' }`. |
| `mode: 'palette', palette: exactPalette(…), pixels: true` | Pixel art: no clean-up of lone pixels, no curve fitting; every boundary is its pixel staircase with straight runs joined. |
| `mode: 'binary', threshold` | Line art: ink darker than `threshold` (0–255), or adaptive per neighbourhood when `null`. Only the ink is drawn. |

### Also exported

- `fitChain(points, closed, options)`: the curve fitter on its own, for any
  chain of points about a pixel apart (corners, straight runs, Schneider
  Béziers between them).
- `parsePath(d)` / `serializePath(subpaths)`: path data as editable nodes with
  absolute handles, and back. Round trips are idempotent after the first pass.
- `oklab(rgb)`: the perceptual colour space the palette and labelling use.

## How it works

1. **Label** every pixel with a palette colour in OKLab. A pixel between two
   colours (anti-aliasing) takes the nearest colour *among its neighbours*, so
   a red/blue edge never grows a purple sliver.
2. **Clean up**: a pixel whose neighbours nearly all disagree joins them;
   regions smaller than `speckle`² merge into their surroundings.
3. **Walk the cracks** between differently labelled pixels. Where three regions
   meet is a junction; each boundary between junctions is one chain, with one
   region on either side.
4. **Fit each chain once**: corners are two straight sides meeting near the
   outline; straight runs become single lines; the rest become least-squares
   cubic Béziers with matching tangents, smoothed only as much as the local
   curvature allows.
5. **Assemble** each region from its chains (reversed where it sees them from
   the other side). Neighbours share the same fitted edge exactly.

The full write-up, with measurements, is in the repo's
[docs](../../docs/how-it-works/inlay.md).

## Measured

On a 640 px JPEG of a five-colour badge, scored by rendering at 4× against the
clean source art: 0.70% wrong pixels with 177 nodes and no gaps between shapes,
against VTracer's 0.86% with 259 nodes. At 2048 px it traces in about 1.3 s
(VTracer: 17.5 s). On pixel art both draw every pixel exactly; Inlay uses
about 14% fewer nodes and is about 4× faster on a 1024 px sprite.

## License

MIT
