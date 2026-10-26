---
'inlaytrace': minor
---

Flat outline illustrations (thin coloured outlines on white, pale tinted fills) now trace. Speck clean-up folds a speck into its nearest colour, and no longer dissolves a thin stroke that lossy compression split into two shades of its ink. `peakPalette` takes a new `width` option: given it, pale tints are found by their flatness (new options `minTint`, `minFlat`), and a colour that is only ever an anti-aliased edge is left out. Slivers under 2 px wide fold into a neighbour of nearly the same colour. Binary and centerline modes take `threshold: 'auto'` (Otsu). A thin closed shape (a 3 px letter stem) no longer collapses to a line, and the fitter no longer grows spikes on thin letters. On a new outline fixture, Logo went from 13.0% to 2.1% of pixels wrong; the badge and emblems score the same.
