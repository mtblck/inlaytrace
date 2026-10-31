---
order: 41
---

# Changelog

What changed in each release of [`inlaytrace`](https://www.npmjs.com/package/inlaytrace),
the tracing package (see [The package](package.md)). The [app](https://inlaytrace.com/app/)
and this site update as changes land and aren't versioned. Changes waiting for
the next release are in [`.changeset/`](../.changeset/); the
[GitHub releases](https://github.com/mtblck/inlaytrace/releases) carry the same notes.

<!-- Written by scripts/changelog.mjs from packages/inlay/CHANGELOG.md: edit that (or the changesets), not this. -->

## 0.3.0

### Minor Changes

- Painted lines stay through smoothing and clean-up: `boostLines` can mark the pixels it darkens (a `lines` array), `smoothShading` takes a `keep` mask it leaves alone, and the tracer's new `lines` option stops a marked line from being folded into a neighbour as a sliver. A dark outline between two dark areas (trousers against a night background) now keeps them apart.
- New `boostLines(rgba, width, height, radius?)`: darkens faint painted outlines (thin lines darker than both their sides, found with a black-hat filter) before the palette is picked, so a mouth on a shadowed face or a line between two near-equal colours labels apart from them instead of being lost. Short dark marks are left alone as texture.
- New `smoothShading(rgba, width, height)`: an edge-preserving (bilateral) filter for painted art, run before picking the palette. Brush and JPEG noise inside a shadow evens out, so the shadow traces as one shape instead of flecks of its two nearest colours, while the edges between colours stay sharp.

### Patch Changes

- `centerlineToSvg` escapes the drawing's width and height like every other value it writes.
- Faster colour labelling: converting colours to OKLab reads linear light from a table instead of a power per channel, which cut a 24-colour trace of an 820 × 1162 painted poster from 20 s to 11 s with the same output.
- Gradient fills no longer smear one shape into its neighbour on painted art (a face into the hair or shadow beside it): a gradient must stay within 20 RGB levels of the image, and must draw each of the bands it replaces no worse than that band's own colour did.
- Smaller files with Keep painted outlines: with the tracer's `lines` option, the pieces one painted line labels as (a few dark shades along its length) now join each other instead of each staying a shape, and a marked piece too short to part anything folds into its neighbour like any sliver. 9–15% smaller on a painted film poster, with its outlines kept.
- Strokes keep sharp corners sharp (a flag's swallowtail no longer comes out rounded), and in outline art a dot drawn on a line's end (a flagpole's knob) stays a shape instead of being lost under the stroke.

## 0.2.0

### Minor Changes

- `stacked: true` now works for flat art too: shapes come back to front, each whole, with the parts hidden behind other shapes completed (a disc behind a bar traces as a whole disc). Which shape is in front is read from the junctions where two shapes' shared edge ends. Photos (`photo: true`) stack as before.
- Flat outline illustrations (thin coloured outlines on white, pale tinted fills) now trace. Speck clean-up folds a speck into its nearest colour, and no longer dissolves a thin stroke that lossy compression split into two shades of its ink. `peakPalette` takes a new `width` option: given it, pale tints are found by their flatness (new options `minTint`, `minFlat`), and a colour that is only ever an anti-aliased edge is left out. Slivers under 2 px wide fold into a neighbour of nearly the same colour. New option `photo` keeps the old clean-up for photos (specks join the colour they share the most edge with, no sliver pass), which is what a stacked `quantizePalette` trace wants. Binary and centerline modes take `threshold: 'auto'` (Otsu, falling back to 128 on a page with nothing to split). A thin closed shape (a 3 px letter stem) no longer collapses to a line, and the fitter no longer grows spikes on thin letters. On a new outline fixture, Logo went from 13.0% to 2.1% of pixels wrong; the badge, emblems and photos (with `photo`) score the same.
- New `strokes` option for flat outline art: in palette mode, the colours drawn mostly as thin, long lines are traced down their middle as one stroked path each (`InlayPath.stroke` is the width measured from the ink), with their anti-aliased edges and darker shades joined in, and the shapes either side meet beneath them. Small lettering, short marks and solid shapes stay shapes. `scale` says how far the image was enlarged, so the line widths scale with it. Off by default; output without it is unchanged.

  `toSvg` and `centerlineToSvg` now escape the attribute values they write, so a palette colour given with a quote in it can't end its attribute.
- `peakPalette` finds colours spread over several histogram bins (a photo's red lettering, a small decal) instead of stopping at the greys; flat art's palettes are unchanged. New option `minDetail`. Stacked shapes now reach under the neighbours painted after them, so no hairline seam shows where two shapes meet (12% closer on photos, about a third more path data).
- Lines within a degree of horizontal, vertical or 45° are now exactly that, so a square stays square after JPEG and lines either side of a junction line up. `fitChain` takes `snap: false` to keep lines as fitted.

### Patch Changes

- `centerline(rgba, width, height, options)` (and `traceCenterline`, `centerlineToSvg`): single strokes down the middle of the ink, for pen plotters and engraving, with the stroke width measured from the ink or set.
- Add a funding link (Ko-fi) to the package metadata.
- New `gradients` option: soft shading that a palette splits into bands of tints is traced as one shape with a linear or radial gradient (`path.gradient`, written by `toSvg` as `<linearGradient>` / `<radialGradient>`), when the gradient fits much better than a flat colour. Off by default.
- Lines about a pixel wide stay in one piece at a slant, instead of breaking into dashes or vanishing.
- Centerline and outline-art strokes run straight through junctions. Thinning bends the skeleton toward each junction, so an X of thick strokes came out pinched at its crossing and a T's stem bent to meet the bar; within a stroke width of a junction the arms are now cut back and drawn straight on to where their own lines meet.
- Small text and dots beside flat art now trace. Thin anti-aliased strokes (1.5 px grey letters) were labelled as the paper, pale edges as a nearby colour, and each letter then cleared as a speck. In flat art (not `photo`), a pixel between colours and close to none of them is now read as a mix of the pair that explains it best; one next to only one other colour keeps its own; and a speck that stands well apart from every colour around it stays from an eighth of the speck area up, so raising `speckle` still clears it. Poster output is unchanged.
- In images with exactly flat colours, such as most PNG exports, edges are placed between pixels from their anti-aliasing instead of on the pixel grid: straight sides land where they really are, and small shapes come out cleaner (2–16% fewer wrong pixels on the PNG fixtures, for the same nodes). Whether an image qualifies is judged from its pixels, so typical JPEG and WebP traces and Poster are unchanged.
- `toSvg` escapes the drawing's width and height like every other value it writes.
- Lines one or two pixels wide keep their width to their ends. Where such a line's outline turned back at its end inside one fitted run (an arm of a T or a Y), its two sides were joined at a point, so each arm tapered to nothing and thin outlines looked broken.

## 0.1.3

### Patch Changes

- New `shapes` option: a closed outline that is a circle, an ellipse, a rectangle, a rounded rectangle or a regular polygon is drawn as that exact shape instead of fitted curves (on the sample badge, 0.70% → 0.54% wrong pixels). Off by default.
- `detectSymmetry(rgba, width, height, options?)` finds the likeliest mirror axes (vertical and horizontal) and rotational orders (2–8 by default) in an image, each scored by the share of the drawing that matches its reflection or turn.

## 0.1.2

### Patch Changes

- Photos: `quantizePalette(rgba, n)` picks a photo's colours by k-means in OKLab (deterministic), and the `stacked` option draws each shape whole, larger shapes first, instead of cutting holes (same picture, less path data, no hairline seams). Also fixes speck merging, which could strand fragments of merged specks as new specks: on photos that left thousands of extra shapes, and a larger `speckle` gave more shapes rather than fewer.

## 0.1.1

### Patch Changes

- The npm page says the package has no dependencies or install scripts, and that releases carry provenance. No code changes.

## 0.1.0

First published release: the tracer the [Inlay app](https://inlaytrace.com/app/)
uses for logos, illustrations, line art and pixel art, built as ESM with type
declarations.

- `trace(rgba, width, height, options)` in `palette` mode (flat colour, with
  optional `merge` and `pixels` for pixel art) and `binary` mode (line art).
- `toSvg`, `traceInlay`, `peakPalette`, `exactPalette`, `oklab`, `fitChain`,
  `isFlat`, `pointAt`, `parsePath`, `serializePath` and `mapPoints`.
- `mergeLabels`, `otsu` and `staircase` are exported for the app's tests and
  aren't part of the stable API.
