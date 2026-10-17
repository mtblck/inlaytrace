---
order: 5
---

# Mirror

Edit tab → *Mirror*. Keep one half of the drawing and reflect it onto the other,
for logos that should be symmetrical but weren't drawn (or scanned) that way.

## Use it

1. Choose the **Axis**: *Vertical* (left/right) or *Horizontal* (top/bottom).
2. Choose which side to **Keep**. The other side is washed out on the canvas.
3. Set the **Position**: drag the dashed line, type a value, or *Centre*.
4. Press *Mirror left onto right* (or the matching label). The tool switches back
   to Select so you can see the result. It's one undo step.

## How it works

For each shape, in paint order:

1. Intersect it with the kept half.
2. Reflect that across the axis.
3. Unite the two.

A shape that crossed the axis comes out as **one seamless shape**, not two
halves meeting at a hairline. Shapes entirely on the discarded side are dropped;
fills and paint order are kept.

The booleans are [paper.js](http://paperjs.org) (MIT), loaded only the first
time you open the Mirror tool: 72 KB gzipped, against an 89 KB app. The unit
tests run the same build, and the browser tests render the exported SVG and
compare each half pixel by pixel: 0.0% of pixels differ on a symmetrical logo.

Mirroring is a shape edit, so afterwards changing a trace setting asks first.
