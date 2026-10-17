---
order: 8
---

# Keyboard shortcuts

Press **?** (or the keyboard icon in the header) for the list in the app. ⌘ on a Mac,
Ctrl elsewhere; ⌥ is Alt. Shortcuts don't fire while you're typing in a field.

## Tools

| Keys | Does |
| --- | --- |
| V | Select: pick, move and scale shapes |
| A | Nodes: edit one shape's nodes and curves |
| M | Mirror |
| Double-click a shape | Edit its nodes (from Select) |

## Selection

| Keys | Does |
| --- | --- |
| ⌘A | Select all shapes, or all nodes of the shape with Nodes |
| ⇧ click | Add to or remove from the selection |
| Drag on empty canvas | Select shapes wholly inside (nodes inside, with Nodes) |
| ⇧ drag, ⌥ drag | Add to / remove from the selection |
| Esc | Deselect nodes, then shapes, then go back to Select |

## Editing

| Keys | Does |
| --- | --- |
| ← ↑ → ↓ | Nudge the selection 1 px (of the trace) |
| ⇧ + arrows | Nudge 10 px |
| ⇧ while dragging | Move along one axis; scale in proportion |
| ⌥ while dragging | Scale from the centre; bend one handle on its own |
| Delete, Backspace | Delete the selected nodes or shapes |
| ⌘Z | Undo |
| ⇧⌘Z, Ctrl + Y | Redo |

## View

| Keys | Does |
| --- | --- |
| ⌘ = / ⌘ − | Zoom in / out around the pointer |
| ⌘ 0 | Fit to window |
| ⌘ 1 | 100% |
| ⌘ + scroll, pinch | Zoom around the pointer |
| ← → (⇧ for bigger steps), Home, End | Move the split handle, when it has focus |
| ? | Show the shortcuts panel |

## How it works

One list (`SHORTCUTS` in `src/components/Shortcuts.tsx`) feeds the panel; the
handlers are in `App.tsx` (editing) and `Canvas.tsx` (zoom and drag modifiers).
The panel is a native modal `<dialog>`, so the browser traps focus, closes it on
Esc and makes the page behind it inert.
