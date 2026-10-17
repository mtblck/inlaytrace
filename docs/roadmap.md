---
order: 40
---

# Roadmap

Suggested improvements, drawn from the [comparison with other tools](how-it-differs.md),
the [research](research.md) and testing. Ordered by how much each would help
against how much it costs. Items with a ticket link are on the board; the rest
are ideas until they get one.

## Now: make the editor feel like an editor

The tracer is ahead of the field; the editor is the gap. These four make
everyday fixes faster and are the ones testing has asked for.

| Item | Why | Ticket |
| --- | --- | --- |
| **Scale and move shapes** | Fixing a trace often means nudging or resizing a whole shape, not dragging nodes one by one. Bounding-box handles, ⇧ to keep proportions, ⌥ to scale from the centre. | [#21](https://github.com/mtblck/img-to-svg/issues/21) |
| **Drag to select** | A marquee to select several shapes, or several nodes inside one, so moves, deletes and scales apply to all of them. ⇧ adds, ⌥ removes. | [#22](https://github.com/mtblck/img-to-svg/issues/22) |
| **Smooth nodes** | Dragging one handle of a smooth node should swing its partner to stay in line, as in Illustrator and Figma. Hold ⌥ to break the pair; corners stay independent. | [#23](https://github.com/mtblck/img-to-svg/issues/23) |
| **Shortcuts and a shortcuts panel** | Tool keys (V select, A nodes), arrow-key nudging (⇧ for 10 px), select all, and a panel on `?` listing everything. | [#24](https://github.com/mtblck/img-to-svg/issues/24) |
| **Fix the Smoothing "Off" label** | The slider reads "Off" at 0 but still smooths a little ([Presets and settings](features/presets-and-settings.md)). | — |

## Next: close the gaps with the paid tools

| Item | Why |
| --- | --- |
| **Add node, convert node** | Double-click a segment to add a node; toggle a node between corner and smooth. The two edits after moving that every editor has. |
| **Merge colours** | Pick two palette swatches and fold one into the other, re-tracing so the shared edge disappears (Vectorizer.ai's region merge). Today you can only make them the same colour. |
| **Eyedropper** | Pick a recolour from the original image, or from anywhere on screen with the EyeDropper API. |
| **Corner sharpen and round** | Per-node: snap a slightly rounded corner sharp, or round a sharp one by a radius. |
| **Simplify selection** | Re-fit the selected shapes with fewer nodes at a chosen tolerance. |
| **Rotate** | With scale (#21), the last of the basic transforms. |
| **Export size and PNG** | Set width and height (or units) on download; export a PNG at any scale from the vector. |
| **PDF and EPS export** | What print shops and cutters still ask for. PDF can be built in the browser; EPS is plain text. |
| **Session save** | Keep the image, settings and edits in IndexedDB so a reload doesn't lose work, with a clear "stored on this device" note. |

## Later: bigger bets

| Item | Why |
| --- | --- |
| **Symmetry detection** | Find mirror and rotational symmetry in the trace and enforce it, as Vectorizer.ai does. The manual mirror covers the common case. |
| **Shape fitting** | Recognise circles, ellipses, rounded rectangles and regular polygons and write them as exact shapes. |
| **Centerline tracing** | Single strokes for plotters, engraving and handwriting, rather than outlines. |
| **Background removal and upscaling** | In-browser models for photos and low-res logos, held to the licence rule (MIT/BSD/Apache weights only). |
| **Target file size** | "Make it under 10 KB": search the settings for the best trace that fits. |
| **Groups and layer reordering** | Treat several shapes as one; move a shape above or below another. |
| **DXF export** | For CNC and laser cutting. |
| **SVG import** | Open an SVG to edit its paths, so the editor is useful on its own. |
| **Batch** | Trace a folder of images with one preset, download a zip. |
| **Offline install** | A service worker and manifest so it installs as an app and works offline (SVGcode does this). |
| **HD mode** | A paid, server-side trace for very large images: a Vercel Function with spend caps, opt-in, clearly marked as leaving the device. No database. |

## Not planned

- **Uploading images by default.** Local is the point; HD mode would be opt-in.
- **GPL/AGPL code** (Potrace, AutoTrace, `@imgly/*`). The repo is MIT.
- **A general vector editor.** Edits exist to fix traces; Figma and Illustrator
  are better at everything else, and Copy SVG gets you there.
