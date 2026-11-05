---
order: 3.5
---

# The SVG editor

Inlay's Edit mode is a small SVG editor for fixing and finishing drawings,
traced or opened as SVG. Three ways in:

- **Edit SVG**, beside *Download SVG*, switches a trace to Edit mode, so you
  can fix it before downloading. On a phone it's in the bar at the foot of the
  screen.
- **The *Edit* switch** above the canvas, or a tool's key (V, A, M).
- **[inlaytrace.com/svg-editor](https://inlaytrace.com/svg-editor/)** opens
  the app ready for an SVG (`/app/?mode=edit`): the first file you drop opens
  in Edit mode, and an image is traced first.

What you can do there:

- [Colours and background](colours-and-background.md): replace, pick, merge
  and remove colours; add a background.
- [Editing shapes](editing-shapes.md): select, move, scale, rotate, group and
  reorder shapes; edit nodes and curves; simplify.
- [Mirror](mirror.md): keep one half and reflect it, or repeat a slice.
- [Open an SVG](open-an-svg.md): what an imported SVG keeps.
- [Undo and the edit model](undo-and-edits.md): what happens to edits when
  you re-trace.
- [Export](export.md): SVG, PNG, PDF, EPS, DXF, layers and swatches.

It's meant for clean-up, not illustration
([ADR 0005](../adr/0005-editor-scope.md)): drawing and cutting shapes are on
the way, while artboards, text layout, masks and effects are left to Figma,
Illustrator and Inkscape. *Copy SVG* takes your shapes there.
