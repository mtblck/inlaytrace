---
order: 2
---

# Comparing and zooming

The bar under the image.

## Views

| View | Shows | Use it to |
| --- | --- | --- |
| **Split** | The original on the left, the SVG on the right, with a handle to drag | Compare detail side by side |
| **Difference** | The SVG blended over the original: black where they match, bright where they don't | Find every place the trace is wrong at a glance |
| **Vector** | The SVG on its own, over a check pattern where it's transparent | See exactly what you'll export, and edit |

A new image opens on **Split**. The first time you start editing (open the Edit
tab or click a shape) the view switches to **Vector**, so the original is out of
the way. That happens once per image, and never over a view you picked yourself.

The split handle is a real slider: focus it and use ← → (Shift for bigger
steps), Home and End.

## Overlays

**Paths** draws every shape's outline; **Nodes** draws every node. Each has its
own colour picker, remembered in your browser. Neither ever exports.

On very busy traces (a Poster of a photo can have 60,000 nodes) the node overlay
is skipped past 20,000 nodes, with a note; select a shape to see its own nodes.

## Zoom

- **Slider** with − and +: logarithmic, √2 per step. Steps stop at *Fit* and at
  *100%* rather than skipping past them.
- **Fit** follows the window; **100%** is one pixel of the original image per
  screen pixel, however large it was traced.
- **Trackpad pinch** over the image zooms around the cursor. So does ⌘/Ctrl +
  scroll wheel. Plain scrolling still scrolls.
- **Keys** with the pointer over the image: ⌘/Ctrl + = and − zoom in and out, 0
  fits, 1 goes to 100%.

**How the point stays put.** Zoom is stored as screen pixels per original pixel.
Each zoom records where the cursor was on the image and scrolls so that point is
under the cursor again. Past fit, the image gets half a window of padding on
each side, so even a point near an edge can stay put (0.1% drift over a 1,100%
pinch in the browser tests). Chrome, Firefox and Edge report pinches as
ctrl+wheel and Safari as gesture events; both are handled.

Nodes, handles and the mirror axis stay the same size on screen at every zoom.
