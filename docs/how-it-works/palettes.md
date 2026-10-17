---
order: 2
---

# Palettes from histogram peaks

How Logo and Illustration decide which colours the image has
(`src/lib/palette.ts`).

## The problem with quantizers

A quantizer groups similar pixels and averages each group. On flat art that
average drifts: anti-aliased edge pixels between gold and navy pull the gold
group towards navy. On the sample badge the gold sun came out pale peach,
plainly wrong in the Difference view and wrong enough to break a brand colour.

A second surprise: **a colour cap equal to the number of colours is too low.**
With a cap of 6 on a 5-colour badge, anti-aliased shades took slots and the red
mountain and green hill merged into one brown (8.75% of pixels wrong). A cap of
8 fixed it (1.39%). That's why Logo defaults to 8, and why the Colours hint
says to raise the cap if two colours merge.

## Peaks instead of averages

Flat art's real colours are sharp peaks in its histogram; anti-aliasing is a
thin spread of low counts between them. So:

1. Build a histogram at 5 bits per channel, keeping each bin's true mean colour.
2. Walk the bins from most to least frequent. Accept a bin as a new colour only
   if it is perceptually distinct (OKLab distance ≥ 0.07) from every colour
   already accepted and holds a meaningful share of the image.
3. Stop at the colour cap.

That recovered the sample's colours almost exactly (mean error 3.28 → 1.47) and
cut mean error on a real illustration from 11.1 to 4.3.

## Where it doesn't apply

Photos have no peaks. On a photo the same change made things worse (9.9 →
15.3), so the Poster preset keeps VTracer's own quantizer. The rule is
per-preset because the measurements said so.

## How the tracer uses it

The [shared-edge tracer](shared-edge-tracer.md) labels each pixel with its
nearest palette colour in OKLab. Pixels that sit between two colours are
decided by their neighbours, which keeps slivers of in-between colours off
every edge.
