---
order: 1
---

# Getting started

## Install

```sh
npm install inlaytrace
```

The package is ES modules only, with type declarations. Node 20 or newer, any
current browser, and Web Workers.

## Trace in the browser

Inlay takes RGBA pixels, which a canvas gives you for any image the browser can
decode:

```ts
import { trace, toSvg } from 'inlaytrace'

const bitmap = await createImageBitmap(file) // a File, Blob or <img>
const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
const ctx = canvas.getContext('2d')!
ctx.drawImage(bitmap, 0, 0)
const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

const result = trace(image, { preset: 'logo' })

document.body.insertAdjacentHTML('beforeend', toSvg(result))
```

A large image takes a second or more, so in an app run it in a Web Worker,
as the Inlay app does, and post the result back. The result is plain data
(`{ width, height, paths: [{ d, fill }] }`), so it crosses `postMessage` as is.

## Trace in Node

Decode the image with any library that gives raw RGBA pixels. With
[sharp](https://sharp.pixelplumbing.com/):

```ts
import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { trace, toSvg } from 'inlaytrace'

const { data, info } = await sharp('logo.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })

const result = trace({ data, width: info.width, height: info.height }, { preset: 'logo' })

await writeFile('logo.svg', toSvg(result))
console.log(`${result.paths.length} shapes`)
```

Run it as an ES module (`"type": "module"` in `package.json`, or a `.mjs`
file) so the top-level `await` works.

## From the command line

```sh
npx inlaytrace logo.png -o logo.svg
npx inlaytrace scan.png -o scan.svg --preset lineart
npx inlaytrace photo.jpg -o photo.svg --preset poster --colors 16
```

PNGs are read with Node's own zlib, so they need nothing else. JPEG, WebP,
GIF and TIFF go through [sharp](https://sharp.pixelplumbing.com/) when it's
installed beside inlaytrace (`npm install sharp`); without it the command says
so. Without `-o`, the SVG goes to stdout. The flags follow the options below:
`--preset`, `--colors`, `--palette '#111111,#e63946'`, `--speckle`,
`--tolerance`, `--corner`, `--grayscale`, `--sharpen`, `--layers` / `--no-layers`, `--exact-shapes` /
`--no-exact-shapes`, `--threshold`, `--invert` and `--stroke-width`.
`npx inlaytrace --help` lists them.

## Pick a preset

The preset says what the image is, and brings the palette, the clean-up and
the fitting the Inlay app uses for it:

| Preset | For |
| --- | --- |
| `logo` (the default) | Few flat colours, crisp corners, shapes cut out to tile |
| `illustration` | More colours, smooth curves, layered shapes, soft shading as gradients |
| `outline` | Illustration with its drawn outlines as stroked lines |
| `lineart` | Ink drawings and scans: one ink, only the ink drawn |
| `centerline` | Single strokes down the ink's middle, for plotters and engraving |
| `poster` | Photos flattened into colour bands |
| `pixel` | Pixel art: exact colours, every pixel edge kept |

Any [option](options.md) overrides the preset's default:

```ts
trace(image, { preset: 'poster', colors: 12 })
trace(image, { preset: 'logo', palette: ['#111111', '#ffffff', '#e63946'] }) // your own colours
trace(image, { preset: 'lineart', invert: true }) // light ink on a dark background
```

## What you get

`trace` returns the drawing's size and its shapes, largest first, which is
the order to paint them in:

```ts
{
  width: 200,
  height: 120,
  paths: [
    { d: 'M0 0L0 120L200 120L200 0Z…', fill: '#f3ede1' },
    { d: 'M110 20L110 100L180 100L180 20Z', fill: '#203b4e' },
    …
  ],
}
```

Each `d` is absolute `M`/`L`/`C`/`Z` path data, filled with the default nonzero
rule (holes are wound the other way). Neighbouring shapes share their edges
exactly, so they tile with no gaps and no overlaps: you can recolour, remove
or cut any of them separately.

`toSvg(result)` wraps them in an `<svg>` with a `viewBox`. For smaller files,
run that through [SVGO](https://svgo.dev/).

## Next

- [Options](options.md) for each kind of image.
- [How Inlay works](../how-it-works/inlay.md).
- [Try it in the app](https://inlaytrace.com/app/), which uses
  the same tracer.
