---
order: 4
---

# Curve fitting

How a boundary of pixel steps becomes the fewest straight lines and curves that
follow it (`src/lib/fit.ts`). The goal is what a designer would draw: straight
edges as single lines, corners as single sharp points, round things as smooth
curves, and no clusters of nodes.

The input is a chain of points about a pixel apart: either an open run between
two junctions, whose ends stay fixed, or a closed loop.

## 1. Find the corners

A corner is **two straight sides meeting at a point**. For each point that turns
by more than the *Corners* angle over 6 px either side:

1. Fit a line to each side, 3–9 px out (past the anti-aliased rounding), on a
   lightly smoothed copy so pixel steps don't read as bending.
2. Require both sides to be straight (RMS under 0.6 px, bending under 14°) and
   to turn by more than the *Corners* angle between them.
3. Require them to meet close to the outline. An outline that misses the
   meeting point by *d* at an interior angle θ is rounded with radius
   *d* / (1/sin(θ/2) − 1). A real corner is rounded by anti-aliasing, about a
   pixel; a corner rounded by more than 1.5 px is a curve.

That last test is what tells a stroke's 4 px round end (two parallel sides,
not a corner) from a square end (four corners). Measuring the turn alone could
not: at 4 px a round end is a run of 90° pixel steps.

Then:

- Keep only the sharpest candidate within 6 px, and merge corners closer than
  6 px into one, so a blunted tip stays one point.
- Put each corner where its sides meet, undoing the rounding.
- Very acute points (a 15° sliver is under a pixel wide for its last few px)
  may meet further out, in proportion to how acute they are, so they're drawn
  sharp.
- Drop corners within 4 px of a junction: the junction is already a node, and
  a corner beside it would only add a stub.

## 2. Smooth, in two strengths

The pixel staircase and JPEG ripple (colour is stored in 16 px blocks) have to
go before fitting. Smoothing comes in two versions:

- **Flat:** a moving average over ±12 px. It removes ripple almost completely,
  which is what deciding "is this straight?" needs, but it pulls curves
  inwards, so nothing is fitted to it.
- **True:** the same average, but each point's window is limited by the local
  curvature. Averaging over ±h on a curve of radius ρ shrinks it by about
  h²/6ρ, so the window is held to √(0.9ρ) and never reaches a tighter spot.

Curvature is estimated at two scales (5 and 15 px) and the larger radius kept,
then median-filtered: over 5 px, half a pixel of JPEG noise made a 270 px
circle look like radius 30. Small loops get at most a sixteenth of their length
as a window, so a 10 px dot keeps its size.

## 3. Fit each run between corners

1. **One line**, if every point of the flat-smoothed run is within 1.5×
   tolerance of the chord. Straight edges are favoured: a ripple along one is
   almost always JPEG noise. The last 3 px into each end are ignored, since
   anti-aliasing blurs them most.
2. Otherwise, **lines inside the run**: straight stretches at least 12 px long,
   not bowed to one side (an arc bows; ripple averages out), and long compared
   with the curves beside them (at least 2.5√r). That last rule stops a
   pixelated circle's flat top from becoming a facet. Ends are trimmed back to
   where the outline really sits on the line, so a line never chamfers the bend
   after it.
3. **Curves between the lines**, by least squares (Schneider, *An Algorithm for
   Automatically Fitting Digitized Curves*, 1990). They leave and arrive along
   the lines' directions, so every join is smooth. Each curve turns at most
   about 100°, so a circle is four curves, the way it's drawn by hand. A run with
   a tight bend is fitted to a tighter tolerance (radius / 8), so one curve
   can't cut across a round end and overshoot it.

Curves that came out flat are written as lines.

## What it was measured against

Each rule above fixed a measured failure: wobbly slopes and rounded peaks
(VTracer), gaps (per-shape fitting), hooked stroke ends and a bump at a snow
cap's tip (found in Matt's browser, reproduced by sweeping JPEG quality), and
nodes 1–3 px apart at junctions (found in review). The unit tests in
`src/engine/shapes.test.ts` pin each one, including one on a real JPEG crop of
the sample.
