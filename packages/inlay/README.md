# Inlay

A raster-to-vector tracer whose shapes **share their edges exactly**, like
inlaid wood: every boundary between two colours is traced and fitted once and
used by both neighbours, so layers never gap or overlap. Straight edges come out
as single lines, corners as single sharp points, and round things as smooth
curves. Pixel art keeps its exact staircase.

Pure TypeScript with no DOM and no WebAssembly: it runs in browsers, Web
Workers and Node. MIT licensed.

It is the tracer behind every preset of the [Inlay app](https://inlaytrace.com/app/),
from logos and pixel art to photos.

## Install

```bash
npm install inlaytrace
```

ESM only, with type declarations. Node 20 or newer, any current browser, and
Web Workers. No dependencies and no install scripts. Each release is published
from this repo's release workflow with
[provenance](https://docs.npmjs.com/generating-provenance-statements), so npm
shows which commit built it.

Versions are 0.x while the API settles: a minor version (0.1 → 0.2) may change
it, and the [changelog](https://github.com/mtblck/inlaytrace/blob/main/packages/inlay/CHANGELOG.md)
says how.
From 1.0, a minor version can change the traced output (different paths or
colours) but not the API, and never makes the measured quality worse; a major
version is any change to an export, option, preset or result type. Pin an exact
version if you need byte-identical SVGs. The [full policy](https://github.com/mtblck/inlaytrace/blob/main/docs/package.md#versions)
says what counts as what.

## Use

```ts
import { trace, toSvg } from 'inlaytrace'

// Anything shaped like ImageData: { data: RGBA bytes, width, height }
const result = trace(image, { preset: 'logo' })

result.paths // [{ d: 'M…Z', fill: '#rrggbb' }, …] largest first, nonzero fill;
             // lines (Outline art, Centerline) are { d, fill, stroke: width }, stroked in `fill`, unfilled
toSvg(result) // '<svg …>…</svg>'
```

### Command line

```bash
npx inlaytrace logo.png -o logo.svg
npx inlaytrace photo.jpg -o photo.svg --preset poster --colors 16
```

PNGs need nothing else. For JPEG, WebP, GIF or TIFF, install
[sharp](https://sharp.pixelplumbing.com/) beside it (`npm install sharp`). Without
`-o` the SVG goes to stdout. `npx inlaytrace --help` lists the options.

### Presets

| Preset | For |
| --- | --- |
| `logo` (default) | Few flat colours (8), crisp corners, shapes cut out to tile, exact circles and rectangles. |
| `illustration` | More colours (24), smooth curves, shapes in layers (each whole, a disc behind a bar stays a disc), soft shading as gradients. |
| `outline` | Illustration, with thin drawn outlines (2.5–8 px; give `scale` if the image was enlarged) traced down their middle as round-capped strokes, and the shapes either side meeting beneath them. |
| `lineart` | Ink drawings and scans: ink darker than the image's own ink/paper split (Otsu; coloured ink works too), small breaks in lines closed. Only the ink is drawn. |
| `centerline` | Single strokes down the middle of the ink, at the width measured from it, for pen plotters and engraving. |
| `poster` | Photos as flat colour bands: colours clustered (k-means in OKLab, deterministic), each shape whole, larger first. |
| `pixel` | Pixel art: exact colours, no clean-up of lone pixels, no curve fitting; every boundary is its pixel staircase. |

Any option overrides the preset: `colors`, `palette` (your own colours, as
`#rrggbb`), `merge` (`{ '#from': '#into' }`), `speckle`, `tolerance`,
`cornerAngle`, `layers`, `shapes`, `strokes`, `gradients`, `closeGaps`,
`threshold`, `invert`, `strokeWidth`, `sharpen`, `smoothShading`, `keepOutlines`, `grayscale` and
`scale`. [Options](https://github.com/mtblck/inlaytrace/blob/main/docs/package/options.md)
says what each does.

### Also exported

- `fitChain(points, closed, options)`: the curve fitter on its own, for any
  chain of points about a pixel apart (corners, straight runs, Schneider
  Béziers between them).
- `parsePath(d)` / `serializePath(subpaths)`: path data as editable nodes with
  absolute handles, and back. Round trips are idempotent after the first pass.
- `centerline(rgba, width, height, options)` / `traceCenterline(…)`: single
  strokes down the middle of the ink, for pen plotters and engraving, with the
  stroke width measured from the ink (or set).
- `detectSymmetry(rgba, width, height)`: the likeliest mirror axes and
  rotational orders in an image, each scored by how much of the drawing
  matches (the app offers to enforce one at 95% or more).
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

The full write-up, with measurements, is in the
[docs](https://github.com/mtblck/inlaytrace/blob/main/docs/how-it-works/inlay.md);
[getting started](https://github.com/mtblck/inlaytrace/blob/main/docs/package/getting-started.md)
covers reading pixels in the browser and in Node, and the
[API reference](https://github.com/mtblck/inlaytrace/blob/main/docs/package/api.md)
every export.

## Measured

On a 640 px JPEG of a five-colour badge, scored by rendering at 4× against the
clean source art: 0.54% wrong pixels with 175 nodes with `shapes` on (0.70%
and 177 without), against 0.85% with 271 nodes for VTracer tracing each colour
on its own. At 2048 px it traces in about
1.3 s (VTracer: 17.5 s, timed by hand). On pixel art both draw every pixel exactly; Inlay uses
about 14% fewer nodes and is about 4× faster on a 1024 px sprite.

On three photos (quantized palette, stacked), rendered back and compared with
each photo: a mean error of 11.8 against VTracer's 14.3, with 57% fewer shapes
and a 30% smaller file.

## License

MIT. Source, issues and the app: [mtblck/inlaytrace](https://github.com/mtblck/inlaytrace).
