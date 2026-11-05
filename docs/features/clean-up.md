---
order: 0.5
---

# Clean up

Clean up mode, the first of the *Clean up · Trace · Edit* tabs above the
canvas, fixes the image before it is traced. A border, a crooked scan or grey
paper each trace badly; fixing them in the image is quicker than fixing the
shapes they become. It's there for images (PNG, JPG, WebP, GIF, BMP), not for
an SVG opened to edit.

The canvas shows the cleaned image, with the current trace as a faint outline
over it while the two still line up. Nothing is traced while you work: leaving
Clean up (for Trace or Edit) traces the cleaned image once. If the drawing has
shape edits, it asks first, because the new trace replaces them; Undo brings
them back.

## Crop (C)

Drag a box on the image, then drag its edges or corners (or type X, Y, W and
H) and press **Crop** or Enter. Esc cancels. Cutting away a scanner edge, a
frame or a watermark keeps it out of the trace, and a smaller image traces
faster.

## Straighten (L), rotate and flip

- **Straighten:** drag along something that should be level or upright (a
  horizon, a border, a line of text). The image turns by the angle between
  your line and the nearest level or upright. The new corners are filled with
  the image's background colour, so they trace as nothing rather than as a
  frame.
- **⟲ 90° and ⟳ 90°** turn by quarter turns, exactly. Type an angle and press
  **Rotate** to turn by any amount, clockwise.
- **Flip ↔ and Flip ↕** mirror the image left to right or top to bottom.

## Levels and threshold

- **Levels:** the *black point* turns everything that dark or darker black,
  which brings faded ink back; the *white point* turns everything that light
  or lighter white, so grey paper becomes clean white; *midtones* brighten or
  darken the greys between.
- **Threshold** (*Black and white only*) makes every pixel black or white by
  its brightness, at the level you set: the one-click fix for line art.

Both preview live, and each slider drag is one undo step.

## Before and after, and the cleaned PNG

*Show original* swaps in the image as you opened it, to compare.
*Download PNG* saves the cleaned image. *Undo all clean-up* goes back to the
original, as one undoable step.

## How it works

Clean-up is a list of operations (crop, rotate, flip, levels, threshold)
stored with your edits, so Undo and Redo step through it like any other edit,
and it is saved with the session, so a reload brings it back
(`apps/app/src/lib/cleanup.ts`). Replaying the list onto the original makes
the cleaned image, which becomes the image the tracer, the presets and the
AI steps (*Remove background*, *Upscale*, *Recognise text*) take; none of
them change. The original file is never touched.

The replay is plain pixel arithmetic (`apps/app/src/lib/cleanupPixels.ts`),
so it is exact and tested without a browser. It works at the original's size,
up to 2048 px on the long edge. Quarter turns and flips move pixels; any
other angle samples bilinearly onto a canvas grown to fit; a crop is stored in
fractions of the image, so it doesn't depend on that size. Levels and
threshold are adjustments, at most one of each, edited in place as the sliders
move. The mode's code loads the first time you open it.
