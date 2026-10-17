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
and offers PNG, PDF and EPS.

- **Size**: width and height in px, mm, in or pt (96 px to the inch). Height
  follows the drawing's proportions. The SVG gets that width and height, so it
  opens at a physical size; its viewBox is untouched, so it still scales
  cleanly. *Reset to the traced size* goes back to the trace's own pixels.
- **PNG**: rendered by the browser from the vector, at the export size × 1–4
  (px sizes) or at 72–600 dpi (physical sizes). The button shows the pixel
  size you'll get. Transparent unless you've added a background.
- **PDF**: one page exactly the export size, every shape a filled vector path
  in its shown colour, with the background behind them if set. Built in the
  browser (`src/lib/vectorExport.ts`): five objects and a compressed content
  stream, checked with `qpdf --check` and by rendering it back.
- **EPS**: the same paths as PostScript, with a bounding box of the export
  size, for print and cutting software that still asks for it.

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

With the flat-art presets, neighbouring layers share their edges exactly, so
they register perfectly when printed or cut.
