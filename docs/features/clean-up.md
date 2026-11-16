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

## Brush (B) and eraser (E)

- **Brush:** paint to close a gap in an outline, fill a hole or join a broken
  letter (a hard brush), or to even out a blotchy fill or a gradient that
  splits into two inks (a soft one). Pick its colour from the image (*Pick
  from image*, or ⌥/Alt-click with the brush), from the trace's own colours,
  or with the colour picker, so a fix lands in the right ink.
- **Eraser:** paints the image's background colour (the commonest colour
  round its edge), not transparency, so dust, stray marks and signatures
  trace as nothing. On a transparent image it erases to transparent.
- **Size and hardness** are sliders in the panel; **[ and ]** make the brush
  smaller and bigger, **Shift [ and Shift ]** softer and harder. A pen or
  Apple Pencil's pressure sets the width as you draw.
- Each stroke is one undo step.

## Despeckle (D) and heal (J)

Two more brushes, with the same size, hardness and pressure as the brush:

- **Despeckle:** paint over JPEG noise and specks. Where you paint, the image
  is smoothed with the tracer's own edge-preserving filter (the one behind
  *Smooth shading*), then every patch of one colour smaller than a quarter of
  the brush merges into the colour it shares the most edge with. It's
  *Ignore specks* for one area: raising that for the whole image would wipe
  out small detail elsewhere. Shapes bigger than that stay.
- **Heal:** paint over a mark (a stain, a watermark, a stray pen line) to
  fill it in from the pixels round it, a ring at a time from the outside in.
  Each pixel takes the colour of a neighbour, not an average of them, so a
  flat colour stays flat and an edge that runs through the mark carries on
  sharp rather than blurring into a band the trace would pick up.

While you paint, the stroke shows as a tint; the fix is worked out when you
let go.

## Keep (K) and Remove (R): fixing background removal

*Remove the background* (in Trace) finds the subject with an AI model,
U²-Net, which sometimes takes a pale edge or a thin part of the subject, or
leaves a shadow behind. Once it's on, two more brushes in Clean up paint over
its mask instead of running it again:

- **Keep** paints back in what it took but should have kept.
- **Remove** takes away what it left but should have taken.

With either brush, the image shows what's removed as a tint. The strokes are
part of the clean-up list, so Undo and the session carry them, and they're
laid over the mask each time background removal runs, through any crop, turn
or flip you make afterwards, so changing the image doesn't lose them. If you
change the image's pixels, leave Clean up once to remove the background again
before painting its mask. Painting the mask never runs the model again.

## Fill (G) and the magic wand (W)

- **Fill:** click the image to fill the area you click in the brush colour: a
  blotchy background made one colour, a speckled fill made flat, a letter's
  inside filled in. ⌥/Alt-click picks the colour, as with the brush.
- **Magic wand:** click to select an area of one colour, shown tinted with its
  edge drawn; ⇧ Shift-click adds another. Then **Fill** it in the brush
  colour, or **Clear** it to the background colour (as the eraser does), so a
  watermark, a stamp or a coloured backdrop traces as nothing. Delete clears,
  Esc deselects.
- **Tolerance** is how far a colour may stray from the one you clicked and
  still count: 0 takes that exact colour, more takes in a JPEG's noise and
  the soft pixels along an edge. With **Touching only** off, the click takes
  that colour everywhere in the image, not just the area it's in. Both apply
  to the wand's selection as you change them.
- Each fill, and each fill or clear of a selection, is one undo step.

To paint detail, zoom in: pinch, ⌘/Ctrl + the wheel (or a trackpad pinch),
⌘/Ctrl + and −, or the zoom buttons over the image; *Fit* or ⌘/Ctrl 0 goes
back to the whole image. Two fingers, the wheel, Space-drag or a
middle-button drag pans. On a phone, the brush's size, hardness and colour sit
in a bar along the bottom of the image, so they're at hand while you paint.

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

Clean-up is a list of operations (crop, rotate, flip, levels, threshold,
brush, eraser, despeckle and heal strokes, fills, and Keep and Remove
strokes)
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
move. A stroke is stored as the points you drew (in fractions of the image,
with pen pressure) plus the brush's size and hardness, and replays as round
dabs stamped along them into a coverage mask, so overlapping dabs don't build
up; drawing uses the same code a segment at a time, so what you see while
painting is what's traced. A new stroke replays only itself, on top of the
last result. Keep and Remove strokes change no pixels: the replay skips them, and
they're carried point by point through the crops, turns and flips after them
onto background removal's mask (`maskStrokes`). A fill is stored as the points clicked, the tolerance and
whether only touching pixels count, and finds its area again on replay from
the pixels as they are at that step, so it fills exactly what you saw
selected. The mode's code loads the first time you open it.
