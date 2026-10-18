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
- **Rotate** by dragging the round handle above the box (⇧ snaps to 15°), with
  *↺ 90°* and *↻ 90°*, or by typing an angle (clockwise; negative turns
  anticlockwise). Rotation is about the centre of the selection's box, and the
  box stays square to the page: it is the bounds of the rotated shapes.
  Quarter turns are exact, so four of them put every point back.
- **Simplify** re-fits the selected shapes with fewer nodes, using the tracer's
  own fitter at the tolerance on the slider. The button says how many nodes
  you'll have before you press it. Neighbouring shapes no longer share the
  simplified edges exactly, so a hairline can show between them.
- **Double-click** a shape to edit its nodes.

The box is the exact bounds of the drawn outline, not of the curve handles
(which usually reach past the curve), so it sits tight on the shape.

## Groups and paint order

With shapes selected, *Arrange* in the Edit panel:

- **Group** (⌘G) makes the selection one group: clicking any of its shapes
  selects them all, and a marquee that catches one catches the group. The
  members move together to where the topmost of them was painted, so the
  picture only changes where one sat between two others. **Ungroup** (⇧⌘G)
  undoes it. A group exports as a `<g>` round its paths.
- **Forward** and **Back** (⌘] and ⌘[) move the selection one step up or down
  the paint order, past one shape or one whole group; **To front** and **To
  back** (⇧⌘] and ⇧⌘[) move it to the top or bottom. In cut-out traces shapes
  don't overlap, so order only shows once shapes are moved onto each other;
  in stacked ones (Poster, Illustration) it decides what's on top.

Both are shape edits: one undo step each, and they detach the drawing from
the trace like any other.

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
- **Double-click the outline** to add a node there. The curve is split
  exactly, so the shape doesn't move, and the new node is selected.
- **Smooth** gives the selected nodes two handles in line (pointing from the
  previous node towards the next), so the curve passes through without a kink.
- **Sharpen** drops their handles, making sharp points.
- **Round corner** replaces each selected corner with an arc that starts the
  given radius along each side (at most 45% of a side, so neighbouring corners
  never overlap), shaped like a circular arc for that turn. Smooth nodes and
  the open ends of a line are left alone.
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
(`apps/app/src/lib/pathdata.ts`). Numbers are written to three decimals and the writer is
idempotent, so touching one node never nudges the rest of the drawing. The
first shape edit copies the trace into an editable document; see
[Undo and the edit model](undo-and-edits.md).

Moving, scaling and rotating (`apps/app/src/lib/transform.ts`) are one affine matrix
applied to every point and handle. Adding, smoothing, sharpening, rounding and
simplifying are in `apps/app/src/lib/nodeops.ts`: adding splits the cubic with
de Casteljau's construction; rounding cuts each side at the radius and joins
the cuts with a cubic whose handles are (4/3)·tan(φ/4) of the arc's radius for
a turn of φ; simplifying samples the outline about a pixel apart and runs it
back through `fitChain`. During a drag, each update is applied to the
shapes as they were when the drag began, not to the previous update, so a long
drag never accumulates rounding; the whole drag is one undo step.

Busy traces stay responsive: each shape is a memoised element and path data is
validated once per shape, so on a 2,500-shape trace a node drag takes about
25 ms per move.
