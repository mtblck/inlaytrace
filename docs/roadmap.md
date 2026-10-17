---
order: 40
---

# Roadmap

Suggested improvements, drawn from the [comparison with other tools](how-it-differs.md),
the [research](research.md) and testing. Ordered by how much each would help
against how much it costs. Every item has a ticket on the board.

## Done: make the editor feel like an editor

The tracer was ahead of the field and the editor was the gap. These shipped
together; see [Editing shapes](features/editing-shapes.md) and
[Keyboard shortcuts](features/keyboard-shortcuts.md).

| Item | What shipped | Ticket |
| --- | --- | --- |
| **Scale and move shapes** | A Select tool with a bounding box: drag to move (⇧ one axis), square handles to scale (⇧ in proportion, ⌥ from the centre), typed X/Y/W/H, arrow nudges. | [#21](https://github.com/mtblck/img-to-svg/issues/21) |
| **Drag to select** | A marquee for shapes (wholly inside) and, with the Nodes tool, nodes. ⇧ adds, ⌥ removes; ⇧-click toggles; several nodes drag together. | [#22](https://github.com/mtblck/img-to-svg/issues/22) |
| **Smooth nodes** | Dragging one handle of a smooth node swings its partner round to stay in line. ⌥ breaks the pair; corners stay independent. | [#23](https://github.com/mtblck/img-to-svg/issues/23) |
| **Shortcuts and a shortcuts panel** | V, A, M for tools, arrows to nudge, ⌘A, and a panel on `?`. | [#24](https://github.com/mtblck/img-to-svg/issues/24) |
| **Fix the Smoothing "Off" label** | Flat-art presets show the tolerance (±0.25 px at the bottom); Poster keeps "Off", which is true there. | [#26](https://github.com/mtblck/img-to-svg/issues/26) |

## Done: close the gaps with the paid tools

See [Editing shapes](features/editing-shapes.md), [Colours and background](features/colours-and-background.md) and [Export](features/export.md).

| Item | What shipped | Ticket |
| --- | --- | --- |
| **Add node, convert node** | Double-click the outline to add a node (the curve is split exactly); *Smooth* and *Sharpen* on the selected nodes. | [#27](https://github.com/mtblck/img-to-svg/issues/27) |
| **Merge colours** | *Merge* on a colour re-traces with one fewer, so the edge between them goes; *Unmerge* takes it back. Logo and Illustration. | [#28](https://github.com/mtblck/img-to-svg/issues/28) |
| **Eyedropper** | A pipette on every colour and the background picks from the original image; *Pick from screen* in Chrome and Edge. | [#29](https://github.com/mtblck/img-to-svg/issues/29) |
| **Corner sharpen and round** | *Sharpen* drops a node's handles; *Round corner* replaces a corner with an arc of a chosen radius. | [#30](https://github.com/mtblck/img-to-svg/issues/30) |
| **Simplify selection** | Re-fits the selected shapes with the tracer's own fitter at a chosen tolerance, showing the node count first, and never collapses a thin shape. | [#31](https://github.com/mtblck/img-to-svg/issues/31) |
| **Rotate** | A handle above the box (⇧ snaps to 15°), quarter turns, or a typed angle. | [#32](https://github.com/mtblck/img-to-svg/issues/32) |
| **Export size and PNG** | Width and height in px, mm, in or pt for every export; PNG at 1–4× or 72–600 dpi. | [#33](https://github.com/mtblck/img-to-svg/issues/33) |
| **PDF and EPS export** | Built in the browser as real vector paths, one page at the export size. | [#34](https://github.com/mtblck/img-to-svg/issues/34) |
| **Session save** | Image, settings and edits kept in this browser's IndexedDB; *Start over* clears them. | [#35](https://github.com/mtblck/img-to-svg/issues/35) |

## Next: bigger bets

| Item | Why | Ticket |
| --- | --- | --- |
| **Symmetry detection** | Find mirror and rotational symmetry in the trace and enforce it, as Vectorizer.ai does. The manual mirror covers the common case. | [#36](https://github.com/mtblck/img-to-svg/issues/36) |
| **Shape fitting** | Recognise circles, ellipses, rounded rectangles and regular polygons and write them as exact shapes. | [#37](https://github.com/mtblck/img-to-svg/issues/37) |
| **Centerline tracing** | Single strokes for plotters, engraving and handwriting, rather than outlines. | [#38](https://github.com/mtblck/img-to-svg/issues/38) |
| **Background removal and upscaling** | In-browser models for photos and low-res logos, held to the licence rule (MIT/BSD/Apache weights only). | [#39](https://github.com/mtblck/img-to-svg/issues/39) |
| **Target file size** | "Make it under 10 KB": search the settings for the best trace that fits. | [#40](https://github.com/mtblck/img-to-svg/issues/40) |
| **Groups and layer reordering** | Treat several shapes as one; move a shape above or below another. | [#41](https://github.com/mtblck/img-to-svg/issues/41) |
| **DXF export** | For CNC and laser cutting. | [#42](https://github.com/mtblck/img-to-svg/issues/42) |
| **SVG import** | Open an SVG to edit its paths, so the editor is useful on its own. | [#43](https://github.com/mtblck/img-to-svg/issues/43) |
| **Batch** | Trace a folder of images with one preset, download a zip. | [#44](https://github.com/mtblck/img-to-svg/issues/44) |
| **Offline install** | A service worker and manifest so it installs as an app and works offline (SVGcode does this). | [#45](https://github.com/mtblck/img-to-svg/issues/45) |
| **HD mode** | A paid, server-side trace for very large images: a Vercel Function with spend caps, opt-in, clearly marked as leaving the device. No database. | [#46](https://github.com/mtblck/img-to-svg/issues/46) |

## Not planned

- **Uploading images by default.** Local is the point; HD mode would be opt-in.
- **GPL/AGPL code** (Potrace, AutoTrace, `@imgly/*`). The repo is MIT.
- **A general vector editor.** Edits exist to fix traces; Figma and Illustrator
  are better at everything else, and Copy SVG gets you there.
