---
order: 4
---

# Editing shapes

Edit tab → *Select*.

## Select

Click a shape to select it; its outline and nodes appear. Clicking a shape also
opens the Edit tab. Click empty canvas or press Esc to deselect (Esc first
deselects a node, then the shape).

Hit targets are invisible copies of every shape, so you can select on either
side of the Split view.

## Move nodes and bend curves

- **Squares are nodes.** Drag one to move it; its handles move with it.
- **Dots are handles.** Drag one to bend the curve on that side. (Today each
  handle moves on its own; keeping the opposite handle in line is on the
  [roadmap](../roadmap.md).)

A press only becomes a drag after 3 px of movement, so clicking a node selects
it without nudging it. The node keeps its offset from the pointer instead of
jumping to it. A whole drag is one undo step.

Nodes, handles and their invisible hit targets are drawn in layers: hit targets
underneath, visible handles above them, visible nodes on top. A neighbour's
larger target can never take the press from the node under your pointer.
Everything stays the same size on screen at any zoom.

## Delete

With a node selected, *Delete node* (or Delete/Backspace) removes it; the curve
closes up using its neighbours' handles. With only a shape selected, *Delete
shape* removes the whole shape. A subpath left with one node disappears.

## How it works

Editing converts each path to absolute M/L/C/Z nodes with explicit handles
(`src/lib/pathdata.ts`). Numbers are written to three decimals and the writer is
idempotent, so touching one node never nudges the rest of the drawing. The
first shape edit copies the trace into an editable document; see
[Undo and the edit model](undo-and-edits.md).

Busy traces stay responsive: each shape is a memoised element and path data is
validated once per shape, so on a 2,500-shape trace a node drag takes about
25 ms per move.
