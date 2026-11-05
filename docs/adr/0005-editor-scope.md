---
public: false
---

# 0005: The editor draws and cuts, for fixing traces only

- **Status:** Accepted
- **Date:** 2026-11-05
- **PR:** (this PR)

## Context

The roadmap listed "a general vector editor" as not planned: edits exist to fix
traces, and Figma and Illustrator do everything else better. The Edit tab grew
anyway (select, nodes, mirror, groups, rotate, simplify, colours, SVG import),
but it can't make a shape or cut one. Patching a hole, folding a speck into its
neighbour or slicing off a border still means leaving Inlay. Many bad traces are
also cheaper to fix in the image before tracing (a speck, grey paper, a broken
outline, a crooked scan) than in the paths afterwards.

Two proposals on 2026-11-05 scoped both editors: an SVG Edit mode (epic #197)
and a raster Clean up mode (epic #214). They need the same chrome: one canvas, a
mode switcher, a tool rail, a properties panel and undo. That chrome lived in
`App.tsx`, with Edit as a tab in the Trace sidebar.

We considered embedding an editor instead (SVG-Edit, Graphite, Penpot,
Inkscape; Fabric, Konva, miniPaint or Photopea for pixels). Each replaces our
`Doc` and ink model, adds a second app inside ours, needs GPL code or a server,
or (Photopea) sends the image off the device.

## Decision

We grow the existing editor into a workspace with modes (Clean up · Trace ·
Edit) on one canvas, built on our own `Doc`, paper.js (lazy-loaded) and Canvas
2D. Edit gains drawing and cutting (pen and shapes, boolean ops, eraser and
knife); Clean up gains crop, rotate, brushes and levels, stored as an op list
replayed on the original image. Both are scoped to fixing a trace.

## Consequences

- The roadmap's "not a general vector editor" line now reads: drawing and
  cutting, yes, for trace clean-up; artboards, symbols, masks, clip paths,
  filters, text layout, layers and plugins, no. Copy SVG still gets you to the
  tools that do those.
- `components/Workspace.tsx` holds the mode switcher and the tool rail; each
  mode fills its own rail and panel. Edit's tools moved there from the tab
  (#198). Clean up adds its mode with #199.
- The tracer, presets and Prepare don't change for either editor: Clean up
  hands the tracer a new `Source`, so `npm run score` doesn't move.
- No new dependencies in the main chunk, and the app's CSP stays as it is
  (nothing needs WebAssembly).
- Revisit if people ask for features outside the line above, or if keeping
  shapes tiling exactly through edits (#212) needs more than the tracer's
  shared-edge data.
