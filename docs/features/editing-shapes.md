---
order: 4
---

# Editing shapes

Edit tab → *Select* (V) for whole shapes, *Nodes* (A) for one shape's outline.
Selecting a shape from the canvas opens the Edit tab.

## Select: pick, move and scale shapes

- **Click** a shape to select it. A dashed box goes round it with eight square
  handles.
- **⇧-click** adds a shape to the selection, or takes it out.
- **Drag on empty canvas** (or start in the margin round the image) to draw a
  marquee: it selects every shape wholly inside it. ⇧ adds to the selection,
  ⌥ removes from it. Shapes have to be *wholly* inside because a trace usually
  has one large shape behind everything, and "touching" would sweep it into
  every selection. ⌘/Ctrl + A selects every shape.
- **Drag a selected shape** to move the selection. ⇧ keeps the move to one
  axis. Pressing one shape of several and letting go without dragging selects
  just that one.
- **Drag a square handle** to scale. The opposite corner or edge stays put;
  ⇧ keeps proportions; ⌥ scales from the centre. Dragging past the opposite
  edge flips the selection, as in other editors.
- **Arrow keys** nudge by 1 px of the trace, ⇧ + arrows by 10 px.
- **X, Y, W, H** in the panel are the selection's bounds in pixels of the trace.
  Type a value to move or resize; *Keep proportions* links W and H. Each field
  is one undo step however many digits you type.
- **Double-click** a shape to edit its nodes.

The box is the exact bounds of the drawn outline, not of the curve handles
(which usually reach past the curve), so it sits tight on the shape.

## Nodes: move nodes and bend curves

Click a shape to show its nodes and handles.

- **Squares are nodes.** Drag one to move it; its handles move with it. ⇧-click
  adds nodes to the selection, and dragging any selected node moves them all.
- **Drag on the shape or empty canvas** to draw a marquee round nodes. ⇧ adds,
  ⌥ removes, ⌘/Ctrl + A selects every node of the shape.
- **Dots are handles.** Drag one to bend the curve on that side. On a *smooth*
  node (its two handles in line, within 10°) the other handle swings round to
  stay opposite, keeping its own length, so the curve stays smooth through the
  node. Hold ⌥ to bend one handle on its own. A corner's handles always move
  independently.
- **Arrow keys** nudge the selected nodes.

A press only becomes a drag after 3 px of movement, so clicking a node selects
it without nudging it. The node keeps its offset from the pointer instead of
jumping to it. A whole drag is one undo step.

Nodes, handles and their invisible hit targets are drawn in layers: hit targets
underneath, visible handles above them, visible nodes on top. A neighbour's
larger target can never take the press from the node under your pointer.
Everything stays the same size on screen at any zoom.

## Delete

Delete or Backspace (or the button in the panel) removes what's selected:

- With the Nodes tool and nodes selected, those nodes. The curve closes up using
  the neighbours' handles. A subpath left with one node disappears, and a shape
  left with none is deleted.
- Otherwise, the selected shapes.

## How it works

Editing converts each path to absolute M/L/C/Z nodes with explicit handles
(`src/lib/pathdata.ts`). Numbers are written to three decimals and the writer is
idempotent, so touching one node never nudges the rest of the drawing. The
first shape edit copies the trace into an editable document; see
[Undo and the edit model](undo-and-edits.md).

Moving and scaling (`src/lib/transform.ts`) are a scale and a translation
applied to every point and handle. During a drag, each update is applied to the
shapes as they were when the drag began, not to the previous update, so a long
drag never accumulates rounding; the whole drag is one undo step.

Busy traces stay responsive: each shape is a memoised element and path data is
validated once per shape, so on a 2,500-shape trace a node drag takes about
25 ms per move.
