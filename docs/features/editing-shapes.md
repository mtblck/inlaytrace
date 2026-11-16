---
order: 4
---

# Editing shapes

Edit mode, from the *Trace · Edit* switch above the canvas. Its tools are in
the rail beside the canvas (above it, on a phone): *Select* (V) for whole
shapes, *Nodes* (A) for one shape's outline, *Mirror* (M), *Fill* (K), *Pen* (P), *Shape* (U), *Eraser* (E) and *Knife* (C), then *Undo* and
*Redo*. The panel (on the right; below the canvas on a phone) shows the chosen tool's settings, then the
colours. Selecting a shape from the canvas switches to Edit mode; going back
to Trace mode deselects and puts the tool back to Select.

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
  you'll have before you press it. It works edge by edge: an edge a shape
  shares with a neighbour is re-fitted once and changes in both, so they still
  meet exactly (see *Shared edges* below). The nodes where three shapes meet
  stay put.
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

### Group by object

**Group by object**, at the foot of the Select panel, groups the whole drawing
at once: each set of shapes that touch (sharing an edge, crossing, or one
inside another) becomes one group, so a sheet of icons or stickers comes apart
into pieces you can click, move and export one at a time. Pieces closer than a
quarter of their size, like the letters of a word or the dot of an *i*, count
as one object, so a logo stays whole. A shape as big as the drawing is the
background and stays out of every group, and so do hidden colours. Shapes you
grouped yourself stay together. The panel says how many objects it found;
doing it again changes nothing. It's one undo step.

## Align, distribute and snap

With shapes selected, *Align* in the Edit panel lines them up on the
selection's bounds: **Left**, **Centre** and **Right** side to side, **Top**,
**Middle** and **Bottom** up and down. A group counts as one item and keeps
its shape. With one shape or one group selected, it lines up with the drawing
instead, so **Centre** then **Middle** centres it on the page. **Space
across** and **Space down** (three or more items) make the gaps between them
even; the two at the ends stay where they are. Each is one undo step.

*Snap*, in the Select and Nodes panels, makes drags land exactly:

- **To nodes** (on at first): a node or handle dragged within 6 screen pixels
  of another shape's node lands on it, and a ring shows where. Moving shapes
  snaps the same way, by whichever of their nodes is nearest a node of the
  shapes standing still, so redrawn pieces meet their neighbours with no gap.
- **To whole pixels**: a dragged node lands on a whole pixel of the trace, and
  moved shapes keep the top-left of their box on one.

Hold ⌘ (Ctrl on Windows and Linux) while dragging to turn snapping off for
that drag. Both settings are remembered on this device. Scaling, rotating and
the arrow keys don't snap.

## Combine: unite, subtract, intersect, divide

With two or more filled shapes selected, *Combine* in the Edit panel joins or
cuts them, the usual fixes for a trace: fold a speck into the shape beside
it, cut a shape out of the background, join two halves.

- **Unite** makes one shape of their combined area.
- **Subtract** cuts the shapes in front out of the one at the back. A shape
  that sits wholly inside leaves a hole.
- **Intersect** keeps only the area every shape covers. If they don't all
  overlap it says so and changes nothing.
- **Divide** splits the selection at every edge into pieces that don't
  overlap, each in the colour that was on top there, so each can be
  recoloured, moved or deleted on its own.

The back shape is the lowest in paint order. Unite and Intersect leave one
shape in its colour, gradient and group, painted where the topmost selected
shape was (as Group does), so nothing that was above a selected shape ends up
under it; Subtract leaves the back shape where it was. Divide makes one piece
per separate area. The result is selected. If nothing would change (shapes
that don't overlap), it says so and leaves the drawing alone. Lines (Centerline and Outline art strokes) have no inside, so they can't
be combined. One undo step each, and they detach the drawing from the trace.

## Fill and stroke

With shapes selected (Select tool), *Fill and stroke* sets their own style:

- **Fill:** a colour of their own. They leave their colour in the Colours
  list for one of the new colour, so recolouring the old one no longer changes
  them. A gradient fill becomes flat. (If the colour you pick is one you've
  replaced or removed in the Colours list, they get the nearest colour that
  isn't, one step of blue away, so they don't vanish or turn another colour.)
- **Outline only** draws them as a stroke in their colour instead of filling
  them, at the *stroke width* you set; untick it to fill them again.
- **Opacity** makes them see-through, in the SVG and PNG too. PDF, EPS and
  DXF draw them solid.

A value the selection doesn't share shows as *Mixed*; changing it sets them
all. Each change is one undo step (a slider's drag is one), and it detaches
the drawing from the trace.

## Fill (K): colour in a line drawing

The *Fill* tool works like a paint bucket. Pick a colour (or one of the
drawing's own) and click:

- **On a shape:** it takes the colour, as a colour of its own (see *Fill and
  stroke* above).
- **Between shapes:** the area they enclose there (the paper inside an outline
  traced as Line art, a gap in a colouring-book page, or the background round
  everything) becomes a new shape in that colour, at the back, so the lines stay
  on top. Its edges are cut from the lines themselves, so there's no gap or
  overlap, and it exports like any other shape (SVG, PDF, EPS, DXF and the
  layers zip).

Hidden shapes don't stop a fill (it runs on under them); locked ones do, and
keep their own colour. Line art closes breaks of a few pixels when it traces
(*Close small gaps*); a wider break in a hand-drawn line lets the fill run
through to the next area, so close it first, or fill the larger area and cut
it with *Combine*. Lines traced as strokes (Centerline) have no inside, so Fill is off
for those traces. Each fill is one undo step and detaches the drawing from the
trace.

Fill works from the keyboard too. With the tool on, Tab to the image: a
crosshair appears in the middle. The arrow keys move it (8 screen pixels a
step, 40 with Shift) and Enter or Space fills under it. The eyedropper works
the same way while it's armed.

## Pen (P) and Shape (U): draw new shapes

The *Pen* draws a path node by node. Click to put down a corner, or drag to
pull out a curve: the handle follows the pointer and its partner mirrors it, so
the node is smooth. Click the first node again to close the path into a filled
shape, or press Enter or Esc to end it open, as a line. Backspace takes back the
last node.

The *Shape* tool draws a rectangle (with rounded corners if you give it a
*Corner radius*), an ellipse, a regular polygon (3 to 24 *Sides*, a corner at
the top) or a straight line. Drag from corner to corner. Hold ⇧ for a square, a
circle or a line at a multiple of 45°, and ⌥ to draw from the centre out.

New shapes are drawn in the tool's colour, which is shared with *Fill*: type
one, click a swatch from the drawing, or *Pick* one from the original image.
Lines take the *Line width* set in the panel. A new shape goes just above the
selected one (or on top of everything with nothing selected) and becomes the
selection, so the next one lands above it. Each is one undo step, and is made
of the same nodes and curves as a traced shape, so *Nodes* reshapes it and every
export draws it.

On a phone or tablet, where there's no Enter key, the panel has *Finish line*
and *Cancel* while the Pen has nodes down.

## Eraser (E) and Knife (C): rub out and cut

The vector twins of Clean up's eraser: they change the shapes themselves, so
nothing is traced again.

The *Eraser* is a round brush (*Eraser width* in the panel). Drag over shapes to
rub out what it covers. The edge it leaves is cut cleanly: anything thinner than
half a pixel along it goes too, so there are no hairline slivers. A shape rubbed
out entirely is deleted.

The *Knife* cuts along a straight line (⇧ keeps it to 45°). Each shape the line
goes right through comes apart into pieces that keep its colour, group and place
in the paint order, and meet exactly along the cut. It cuts through holes (a
ring cut across makes two halves), and a compound shape loses only the parts the
line crosses. A cut that stops inside a shape leaves it whole.

Both work on the selected shapes if there are any, and otherwise on every
visible, unlocked shape. Lines (strokes) are left alone, since they have no
inside, and both tools are off for traces made of lines. Each drag is one undo
step.

## Shapes: find, hide and lock

The *Shapes* list in the Edit panel lists every shape, by colour (as the
Colours list groups them) or by group, in paint order or biggest first. Open
a colour or group to list its shapes; a big one lists a page at a time. Click
a row to select its shape, even one too small to click on the canvas; ⇧ or
⌘/Ctrl-click adds it to the selection.

- **The eye hides** a shape from the canvas while you work on what's behind it.
- **The padlock locks** it: still drawn, but clicks and marquees go through it,
  so it can't be moved by accident.
- The buttons on a colour or group's row hide or lock all of it; *Show all*
  and *Unlock all* undo the lot. A shape in a group hides and locks with its
  group, so a group never splits.

Hidden and locked are editing state only: both still export, as usual. They
undo like any edit and are saved with the session. They're kept by shape, so,
like a shape edit, the first one detaches the drawing from the trace.

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

### Shared edges

Inlay traces each boundary between two colours once, so neighbouring shapes
share the very same edge, and they tile with no gap. Editing keeps it that
way: moving a node or bending a handle on a shared edge moves the neighbour's
copy too, and a node where three shapes meet moves in all three. Smooth,
Sharpen and the arrow keys follow the same rule. Locked shapes keep their edge.

To reshape one side only (pulling a shape away from its neighbour on
purpose), untick *Move shared edges with neighbours* in the Nodes panel. It
also turns off edge-by-edge Simplify.

A press only becomes a drag after 3 px of movement, so clicking a node selects
it without nudging it. The node keeps its offset from the pointer instead of
jumping to it. A whole drag is one undo step.

Nodes, handles and their invisible hit targets are drawn in layers: hit targets
underneath, visible handles above them, visible nodes on top. A neighbour's
larger target can never take the press from the node under your pointer.
Everything stays the same size on screen at any zoom.

## Fix in image (F)

When a shape is wrong because the image is (a speck, a gap in an outline, a
blotchy fill), fixing the pixels is often quicker than fixing the shape.
Select it and press **Fix in image** in the panel, or F: Clean up opens
zoomed on it, with its outline picked out, and leaving Clean up traces again.
See [Clean up](clean-up.md).

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
back through `fitChain`. Combine uses paper.js's booleans
(`apps/app/src/lib/boolean.ts`), loaded only when first used, like Mirror's,
and writes each result back through the same path writer. During a drag, each update is applied to the
shapes as they were when the drag began, not to the previous update, so a long
drag never accumulates rounding; the whole drag is one undo step.

Busy traces stay responsive: each shape is a memoised element and path data is
validated once per shape, so on a 2,500-shape trace a node drag takes about
25 ms per move.
