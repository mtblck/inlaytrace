---
order: 8
---

# Keyboard shortcuts

Press **?** (or the keyboard icon in the header) for the list in the app. ⌘ on a Mac,
Ctrl elsewhere; ⌥ is Alt. Shortcuts don't fire while you're typing in a field.
The panel lists them by mode: Clean up's tools, Edit mode's tools, selection
and editing keys, then those that work in every mode (history and view). A tool key from Trace
mode switches to Edit mode.

## Clean up mode

| Keys | Does |
| --- | --- |
| C | Crop: drag a box on the image |
| Enter | Crop to the box |
| Esc | Cancel the box, or the wand's selection |
| L | Straighten: drag along a line that should be level or upright |
| B | Brush: paint over gaps, holes and blotches |
| E | Eraser: paint the background colour over stray marks |
| D | Despeckle: even out noise and specks where you paint |
| J | Heal: fill a mark in from the pixels round it |
| G | Fill: fill the area you click in the brush colour |
| W | Magic wand: select an area of one colour (⇧ click adds) |
| Delete | Clear the wand's selection to the background |
| K | Keep: paint back in what Remove the background took |
| R | Remove: take away what Remove the background left |
| [ / ] | Brush smaller, bigger (every brush) |
| Shift [ / Shift ] | Brush softer, harder |
| ⌥ click | Pick the brush colour from the image (Brush, Fill, Magic wand) |
| Space drag | Pan when zoomed in (or drag with the middle button) |
| ⌘ + / ⌘ − / ⌘ 0 | Zoom the image in, out, back to fit (pinch and ⌘ wheel too) |

## Tools (Edit mode)

| Keys | Does |
| --- | --- |
| V | Select: pick, move and scale shapes |
| A | Nodes: edit one shape's nodes and curves |
| M | Mirror |
| F | Fix in image: open Clean up zoomed on the selected shapes |
| K | Fill: fill a shape, or the area between shapes, with a colour |
| Tab, arrows, Enter | Fill or pick without a pointer: with Fill or the eyedropper on, Tab to the image, move the crosshair (⇧ for bigger steps), Enter fills or picks under it |
| P | Pen: click for corners, drag for curves, click the first node to close |
| Enter or Esc | Pen: end an open path as a line |
| Backspace | Pen: take back the last node |
| U | Shape: drag a rectangle, ellipse, polygon or line |
| ⇧ drag, ⌥ drag | Shape: a square, circle or 45° line; from the centre |
| Double-click a shape | Edit its nodes (from Select) |
| Double-click the outline | Add a node there (Nodes) |

## Selection (Edit mode)

| Keys | Does |
| --- | --- |
| ⌘A | Select all shapes, or all nodes of the shape with Nodes |
| ⇧ click | Add to or remove from the selection |
| Drag on empty canvas | Select shapes wholly inside (nodes inside, with Nodes) |
| ⇧ drag, ⌥ drag | Add to / remove from the selection |
| Esc | Put the eyedropper away; deselect nodes, then shapes; then go back to Select |

## Editing (Edit mode)

| Keys | Does |
| --- | --- |
| ← ↑ → ↓ | Nudge the selection 1 px (of the trace) |
| ⇧ + arrows | Nudge 10 px |
| ⇧ while dragging | Move along one axis; scale in proportion; rotate in 15° steps |
| ⌥ while dragging | Scale from the centre; bend one handle on its own |
| Delete, Backspace | Delete the selected nodes or shapes |
| ⌘G, ⇧⌘G | Group / ungroup the selected shapes |
| ⌘], ⌘[ | Bring forward / send backward |
| ⇧⌘], ⇧⌘[ | Bring to front / send to back |

## History (every mode)

| Keys | Does |
| --- | --- |
| ⌘Z | Undo |
| ⇧⌘Z, Ctrl + Y | Redo |

## View (every mode)

| Keys | Does |
| --- | --- |
| ⌘ = / ⌘ − | Zoom in / out around the pointer |
| ⌘ 0 | Fit to window |
| ⌘ 1 | 100% |
| ⌘ + scroll, pinch | Zoom around the pointer |
| ← → (⇧ for bigger steps), Home, End | Move the split handle, when it has focus |
| ? | Show the shortcuts panel |

## How it works

One list (`SHORTCUTS` in `apps/app/src/components/Shortcuts.tsx`) feeds the panel; the
handlers are in `App.tsx` (editing) and `Canvas.tsx` (zoom and drag modifiers).
The panel is a native modal `<dialog>`, so the browser traps focus, closes it on
Esc and makes the page behind it inert.
