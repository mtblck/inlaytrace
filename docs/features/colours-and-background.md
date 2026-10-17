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

Colour edits don't touch geometry. They're stored by the *traced* colour
(`{ recolor: { "#e9a13d": "#123456" }, removed: [...] }`), alongside the
background, and applied when drawing and exporting. So they survive re-tracing,
as long as the tracer still finds that colour. See
[Undo and the edit model](undo-and-edits.md).
