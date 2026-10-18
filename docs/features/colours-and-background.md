---
order: 3
---

# Colours and background

Edit tab → *Colours*. Every colour the trace found is listed with how many
shapes use it, most-used first. Selecting a shape highlights its colour.

## Replace a colour

Click a swatch and pick a new colour. Every shape in that colour changes. The
row shows the original colour beside the new one, and *Reset* puts it back. One
session in the colour picker is one undo step, however much you drag it around.

## Pick a colour from the image

The pipette beside each swatch (and the background's) arms the eyedropper.
Click anywhere on the image and that colour, read from the **original**
pixels, replaces the ink, whichever view you're in: you get what the artist
used, not the trace's approximation of it. In Chrome and Edge, *Pick from
screen* in the banner picks from anywhere on your screen instead. Esc or
*Cancel* puts it away. A pick is one undo step.

## Merge two colours

Logo, Illustration and Pixel art. *Merge* on a row, then a swatch under *Into*,
folds that colour into the other. Unlike making them the same colour, this
re-traces with one colour fewer, so the edge between the two disappears and
their shapes become one: fewer paths, and no seam for a cutter to follow.

Because it re-traces, merging asks first if you've edited shapes (like any
trace setting). Merged colours are listed under the colours with *Unmerge*,
which brings one back. Choosing another preset clears merges.

## Remove a colour

*Remove* deletes every shape in that colour, so those areas become transparent,
or show the background if you've added one. This is the quickest way to drop an
image's background. *Restore* brings a colour back; *Restore all* resets every
colour edit.

## Background

The last row. *Add* puts a colour (white to start) behind every shape; click
the swatch to change it, *Remove* to go back to transparent.

The background only shows where nothing covers it: shapes you deleted, colours
you removed, or transparent areas of the original. It exports as the SVG's first
element, so everything sits on top of it, and as its own layer in the layers zip.
Adding it and changing its colour are separate undo steps.

## How it works

Merges are a trace setting (`merge: { from: into }`, traced colours).
Inlay labels every pixel with the full palette first, so
anti-aliased edges are judged against both colours, then relabels merged
colours as their targets (following chains) before any region is built
(`mergeLabels` in `packages/inlay/src/inlay.ts`). Poster's colours are cluster
averages rather than the image's real colours, so it doesn't offer it; Line
art has one colour.

The eyedropper reads the original image's pixels once per image into a
full-size buffer (`colourAt` in `apps/app/src/lib/image.ts`) and maps the click from the
canvas to the original's pixel grid, so it works at any zoom and on upscaled
traces.

Colour edits don't touch geometry. They're stored by the *traced* colour
(`{ recolor: { "#e9a13d": "#123456" }, removed: [...] }`), alongside the
background, and applied when drawing and exporting. So they survive re-tracing,
as long as the tracer still finds that colour. See
[Undo and the edit model](undo-and-edits.md).
