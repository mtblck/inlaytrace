---
order: 1
---

# Getting started

## Install

```sh
npm install inlaytrace
```

The package is ES modules only, with type declarations. Node 18 or newer, any
current browser, and Web Workers.

## Trace in the browser

Inlay takes RGBA pixels, which a canvas gives you for any image the browser can
decode:

```ts
import { trace, toSvg, peakPalette } from 'inlaytrace'

const bitmap = await createImageBitmap(file) // a File, Blob or <img>
const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
const ctx = canvas.getContext('2d')!
ctx.drawImage(bitmap, 0, 0)
const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

const result = trace(data, width, height, {
  mode: 'palette',
  palette: peakPalette(data, 8), // the image's main colours
  speckle: 8, // merge specks smaller than 8 × 8 px
  tolerance: 1, // px the outline may stray from the pixels
  cornerAngle: 45, // sharper turns stay corners
})

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
import { trace, toSvg, peakPalette } from 'inlaytrace'

const { data, info } = await sharp('logo.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true })

const result = trace(data, info.width, info.height, {
  mode: 'palette',
  palette: peakPalette(data, 8),
  speckle: 8,
  tolerance: 1,
  cornerAngle: 45,
})

await writeFile('logo.svg', toSvg(result))
console.log(`${result.paths.length} shapes`)
```

Run it as an ES module (`"type": "module"` in `package.json`, or a `.mjs`
file) so the top-level `await` works.

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
- [Try it in the app](https://mattblack.space/tools/img-to-svg/), which uses
  the same tracer.
