---
order: 4.5
---

# Open an SVG

Drop, paste or choose an `.svg` and it opens to **edit**, not to trace: its
own shapes become the drawing, straight in the Edit tab. Recolour, move,
scale, reshape nodes, group, mirror, then export it like any trace.

## What comes in

- Paths, rectangles (rounded too), circles, ellipses, lines, polylines and
  polygons, inside any nesting of groups and transforms (translate, scale,
  rotate, skew, matrix), which are applied to the shapes.
- Fills and strokes from attributes or inline `style`, inherited from groups.
  Colours by hex, `rgb()` or name. A stroke stays a stroke, its width scaled
  with its transform.
- Arcs, converted to curves. Even-odd fills, rewritten as nonzero by turning
  each hole the other way, so they look the same.
- The viewBox becomes the drawing's size, its corner moved to 0, 0.

## What doesn't, and is said so

The Trace tab lists anything the editor can't keep as it was:

- **Gradients and patterns** are drawn in one colour (a gradient's first stop).
- **Transparency** is drawn opaque.
- **Text, images, `<use>` references and embedded HTML** are left out.
- **Filters** are left out; **clip paths and masks** are ignored (shapes drawn
  whole).
- **`<style>` rules** aren't read (inline `style` attributes are).

*Trace it as an image instead* traces the SVG as drawn, like any picture.

## Safety

The file is read as data: its shapes are rebuilt as paths by our own writer
and colours normalised, and then go through the same checks as a trace before
any of it becomes markup. The original is only ever shown as an image, where
browsers run no scripts and load nothing else, so a script inside it never
runs (the browser tests check this).
