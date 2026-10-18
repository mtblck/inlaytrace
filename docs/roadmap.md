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
| **Scale and move shapes** | A Select tool with a bounding box: drag to move (⇧ one axis), square handles to scale (⇧ in proportion, ⌥ from the centre), typed X/Y/W/H, arrow nudges. | [#21](https://github.com/mtblck/inlaytrace/issues/21) |
| **Drag to select** | A marquee for shapes (wholly inside) and, with the Nodes tool, nodes. ⇧ adds, ⌥ removes; ⇧-click toggles; several nodes drag together. | [#22](https://github.com/mtblck/inlaytrace/issues/22) |
| **Smooth nodes** | Dragging one handle of a smooth node swings its partner round to stay in line. ⌥ breaks the pair; corners stay independent. | [#23](https://github.com/mtblck/inlaytrace/issues/23) |
| **Shortcuts and a shortcuts panel** | V, A, M for tools, arrows to nudge, ⌘A, and a panel on `?`. | [#24](https://github.com/mtblck/inlaytrace/issues/24) |
| **Fix the Smoothing "Off" label** | Flat-art presets show the tolerance (±0.25 px at the bottom). Since Poster moved to Inlay (#53) it shows one too. | [#26](https://github.com/mtblck/inlaytrace/issues/26) |

## Done: close the gaps with the paid tools

See [Editing shapes](features/editing-shapes.md), [Colours and background](features/colours-and-background.md) and [Export](features/export.md).

| Item | What shipped | Ticket |
| --- | --- | --- |
| **Add node, convert node** | Double-click the outline to add a node (the curve is split exactly); *Smooth* and *Sharpen* on the selected nodes. | [#27](https://github.com/mtblck/inlaytrace/issues/27) |
| **Merge colours** | *Merge* on a colour re-traces with one fewer, so the edge between them goes; *Unmerge* takes it back. Logo and Illustration. | [#28](https://github.com/mtblck/inlaytrace/issues/28) |
| **Eyedropper** | A pipette on every colour and the background picks from the original image; *Pick from screen* in Chrome and Edge. | [#29](https://github.com/mtblck/inlaytrace/issues/29) |
| **Corner sharpen and round** | *Sharpen* drops a node's handles; *Round corner* replaces a corner with an arc of a chosen radius. | [#30](https://github.com/mtblck/inlaytrace/issues/30) |
| **Simplify selection** | Re-fits the selected shapes with the tracer's own fitter at a chosen tolerance, showing the node count first, and never collapses a thin shape. | [#31](https://github.com/mtblck/inlaytrace/issues/31) |
| **Rotate** | A handle above the box (⇧ snaps to 15°), quarter turns, or a typed angle. | [#32](https://github.com/mtblck/inlaytrace/issues/32) |
| **Export size and PNG** | Width and height in px, mm, in or pt for every export; PNG at 1–4× or 72–600 dpi. | [#33](https://github.com/mtblck/inlaytrace/issues/33) |
| **PDF and EPS export** | Built in the browser as real vector paths, one page at the export size. | [#34](https://github.com/mtblck/inlaytrace/issues/34) |
| **Session save** | Image, settings and edits kept in this browser's IndexedDB; *Start over* clears them. | [#35](https://github.com/mtblck/inlaytrace/issues/35) |

## Done: bigger bets

| Item | What shipped | Ticket |
| --- | --- | --- |
| **Offline install** | A manifest and a service worker: installable, and offline after one visit; the AI models cached on first use. See [Install and offline](features/install-and-offline.md). | [#45](https://github.com/mtblck/inlaytrace/issues/45) |
| **Batch** | Drop or choose several images: each is traced with the current settings on a worker of its own, and one zip comes back. See [Batch](features/batch.md). | [#44](https://github.com/mtblck/inlaytrace/issues/44) |
| **SVG import** | Drop an .svg and its shapes open in the editor (groups, transforms, arcs and even-odd fills handled); gradients, text and the like are listed, not dropped silently. See [Open an SVG](features/open-an-svg.md). | [#43](https://github.com/mtblck/inlaytrace/issues/43) |
| **Groups and layer order** | Group and ungroup (a group selects as one and exports as a `<g>`), and forward, backward, to front and to back, with shortcuts. See [Editing shapes](features/editing-shapes.md#groups-and-paint-order). | [#41](https://github.com/mtblck/inlaytrace/issues/41) |
| **Background removal and upscaling** | *Prepare*: U²-Net (Apache 2.0) removes the background, Real-ESRGAN (BSD 3-Clause) upscales small images 4×, both in the browser with ONNX Runtime (MIT), the models from this site on first use. Only that worker may run WebAssembly. See [Presets and settings](features/presets-and-settings.md#prepare). | [#39](https://github.com/mtblck/inlaytrace/issues/39) |
| **Target file size** | *Target size* under the settings: type a size and the app searches the settings (smoothing, specks, colours), taking the cheapest step in accuracy each time, then shows what it chose before applying it. See [Presets and settings](features/presets-and-settings.md#target-size). | [#40](https://github.com/mtblck/inlaytrace/issues/40) |
| **Centerline tracing** | A *Centerline* preset: single strokes down the middle of the ink (a skeleton, pruned and joined through crossings, fitted like outlines), with the width measured or set. On a pen drawing, 6 strokes for the 6 drawn, width within 1%. Our own code; AutoTrace is GPL. See [Presets and settings](features/presets-and-settings.md). | [#38](https://github.com/mtblck/inlaytrace/issues/38) |
| **Shape fitting** | *Exact shapes* (on for Logo, Illustration and Line art) draws an outline that is a circle, ellipse, (rounded) rectangle or regular polygon as that shape exactly; on the sample badge, 0.70% → 0.54% wrong pixels. See [Presets and settings](features/presets-and-settings.md). | [#37](https://github.com/mtblck/inlaytrace/issues/37) |
| **Symmetry detection** | The Mirror tool opens set up for the mirror axis or turn the image has (95%+ match), and gains *Turn*: keep one slice and repeat it round a centre. See [Mirror](features/mirror.md). | [#36](https://github.com/mtblck/inlaytrace/issues/36) |
| **DXF export** | *DXF* in Size and other formats: R12, one layer per colour, outlines as closed polylines and strokes as open ones, curves within 0.05 px, at the export size and unit. See [Export](features/export.md#size-and-other-formats). | [#42](https://github.com/mtblck/inlaytrace/issues/42) |

## Next: bigger bets

| Item | Why | Ticket |
| --- | --- | --- |
| **HD mode** | A paid, opt-in server-side trace, clearly marked as leaving the device, paid for with credit packs through Paddle; buying needs an account (Supabase). The free app is unchanged. [Plan](hd-mode.md). | [#46](https://github.com/mtblck/inlaytrace/issues/46) |

## Not planned

- **Uploading images by default.** Local is the point; HD mode would be opt-in.
- **GPL/AGPL code** (Potrace, AutoTrace, `@imgly/*`). The repo is MIT.
- **A general vector editor.** Edits exist to fix traces; Figma and Illustrator
  are better at everything else, and Copy SVG gets you there.
