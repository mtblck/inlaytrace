---
order: 7
---

# Export

The bottom of the panel, with live **Paths**, **Nodes** and **Size**.

| Button | Gives you |
| --- | --- |
| **Download SVG** | `<name>.svg`, optimised |
| **Copy SVG** | The same markup on the clipboard |
| **Layers (.zip)** | One SVG per colour, plus the background and the whole drawing |

## Size and other formats

*Size and other formats*, under the buttons, sets the size every download uses
and offers PNG, PDF, EPS and DXF.

- **Size**: width and height in px, mm, in or pt (96 px to the inch). Height
  follows the drawing's proportions. The SVG gets that width and height, so it
  opens at a physical size; its viewBox is untouched, so it still scales
  cleanly. *Reset to the traced size* goes back to the trace's own pixels.
- **PNG**: rendered by the browser from the vector, at the export size × 1–4
  (px sizes) or at 72–600 dpi (physical sizes). The button shows the pixel
  size you'll get. Transparent unless you've added a background.
- **PDF**: one page exactly the export size, every shape a filled vector path
  in its shown colour (Centerline strokes stay round-capped strokes, their
  width scaled with the page), with the background behind them if set. Built in the
  browser (`apps/app/src/lib/vectorExport.ts`): five objects and a compressed content
  stream, checked with `qpdf --check` and by rendering it back.
- **EPS**: the same paths as PostScript, with a bounding box of the export
  size, for print and cutting software that still asks for it.
- **DXF**: for CAD, CNC routers and laser cutters. One layer per colour (named
  for it, `INK_1E3C8C`, with the nearest CAD colour), every outline a closed
  polyline and every Centerline stroke an open one. Curves are flattened to
  within 0.05 px of the drawing (0.05 mm on a 640 px trace exported at
  640 mm), at the export size in its unit, with millimetres and inches named
  in the header. It's DXF R12, which every CAD and cutting program reads;
  checked by opening it with ezdxf, whose audit finds nothing to fix.

## What's in the SVG

- A `viewBox` at the traced size, so it scales cleanly.
- The background first (if set), then every visible shape, largest first.
- Removed colours are simply absent, so those areas are truly transparent.
- No editor furniture: overlays, selection and the mirror axis are never part
  of it.

It's optimised with SVGO (`preset-default`, multipass, two decimals) in the
background after each change. The numbers in the panel come from that
optimised file, so they're the numbers you download. SVGO may write the
background rectangle as a path.

## The layers zip

For screen printing, vinyl cutting or anything else that wants one file per
colour:

| File | Contains |
| --- | --- |
| `<name>-00-background-<hex>.svg` | The background alone, if set |
| `<name>-01-<hex>.svg`, `-02-…` | Each remaining colour, most-used first, named by its *shown* colour |
| `<name>-all.svg` | The whole drawing |

With every preset but Poster, neighbouring layers share their edges exactly, so
they register perfectly when printed or cut.
