---
order: 5
---

# Mirror

Edit tab → *Mirror*. Make a drawing exactly symmetrical: keep one half and
reflect it onto the other, or keep one slice and repeat it round a centre. For
logos that should be symmetrical but weren't drawn (or scanned) quite that way.

## Detected symmetry

When an image opens, Inlay looks for symmetry in it: a vertical or horizontal
mirror axis, or a turn that repeats it 2 to 8 times. If 95% or more of the
drawing matches, the Mirror tool opens set up for it and says what it found,
for example *The image mirrors across a vertical axis at x = 512: 99% of it
matches*. Change the axis and *Use this axis* puts the detected one back.

Detection reads the image, not the trace, so trace settings don't change it.
It runs in the tracing worker and takes about 0.3 s, once per image.

## Mirror

1. Choose the **Axis**: *Vertical* (left/right) or *Horizontal* (top/bottom).
2. Choose which side to **Keep**. The other side is washed out on the canvas.
3. Set the **Position**: drag the dashed line, type a value, or *Centre*.
4. Press *Mirror left onto right* (or the matching label). The tool switches back
   to Select so you can see the result. It's one undo step.

## Turn

1. Choose *Turn* as the **Axis**.
2. Set **Repeats** (2 to 12): how many times the drawing goes round.
3. Set the **centre**: drag the dot, or type *Centre x* and *Centre y*.
4. Press *Repeat the top slice 5 times* (or the matching number).

Inside the dotted circle, the slice pointing straight up is kept and the
washed-out rest is replaced by copies of it. The circle is the largest that fits
the picture round the centre; anything outside it stays as it was, so a square
background keeps its corners.

Afterwards, the *Difference* view shows how far the result is from your
original, and Undo puts it back.

## How it works

For each shape, in paint order:

1. Intersect it with the kept half (or slice).
2. Reflect it across the axis (or turn it by each multiple of 360° ÷ repeats).
3. Unite the pieces.

A shape that crossed the axis comes out as **one seamless shape**, not two
halves meeting at a hairline. Shapes entirely on the discarded side are dropped;
fills and paint order are kept.

The booleans are [paper.js](http://paperjs.org) (MIT), loaded only the first
time you open the Mirror tool: 71 KB gzipped, against a 110 KB app. The unit
tests run the same build, and the browser tests render the exported SVG and
compare each half pixel by pixel: 0.0% of pixels differ on a symmetrical logo.

Detection is `detectSymmetry` in the [package](../package/api.md). It finds the
background (the most common colour round the border), takes the centroid of
everything else, which lies on any mirror axis and at any centre of turn, and
scores candidates near it: the share of the drawing whose reflection or turn
lands on the same colour. On the test emblem in `npm run score` the axis it
finds is exact, and mirroring takes the trace from 0.25% asymmetric to 0.00%;
see [Measuring quality](../how-it-works/measuring-quality.md).

Mirroring is a shape edit, so afterwards changing a trace setting asks first.
