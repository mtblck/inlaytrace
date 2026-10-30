---
order: 2
---

# Palettes from histogram peaks

How Logo and Illustration decide which colours the image has
(`packages/inlay/src/palette.ts`).

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

## Peaks spread over several bins

Counting each bin alone failed on a product photo: a grey ship with red
lettering and yellow decals came out black, white, greys and one blue, 6
colours at a cap of 8 or 64. A photographed colour spreads over many
neighbouring bins, none of them 0.2% of the image, and the walk stopped at the
first such bin. So:

- A bin's weight is every pixel within half the distinct-colour distance of it,
  and only local peaks (no bin nearby holds more pixels) are candidates, so a
  flat colour is still its own bin, not a neighbour that borrowed its weight.
- Below 0.2%, down to 0.05%, a colour is a detail: it's kept unless it lies on
  the line between two colours already picked (mixed in sRGB, as a renderer
  mixes an anti-aliased edge), which is what edge shades are.

On that photo Illustration went from 6 colours to 12, red and yellow among
them (mean error 7.79 → 5.98); the clean-art scores (`npm run score`) are
unchanged. Weighing alone shifted the badge's colours onto neighbouring bins
(0.54% → 0.80% of pixels wrong) until candidates were limited to peaks; a flat
0.05% floor let edge shades in (0.77%) until blends were excluded.

## Pale tints and flat pixels

Peaks missed the fills of an outline illustration: thin blue outlines on
white, the shapes filled with pale tints of the same blue. A pale fill is 0.03
from white in OKLab, under the 0.07 that makes a colour distinct, and lies on
the line from white to the blue, so it read as an edge between them. Meanwhile
the outlines' own anti-aliasing was plentiful enough (past 0.2%) to take a
slot as a colour.

What tells a fill from an edge is that a fill is *flat*: its pixels match their
four neighbours (within 8 per channel), and an anti-aliased edge's never do.
Given the image's width, `peakPalette` counts flat pixels per bin, then:

- a blend of two picked colours that is almost never flat (under 5% of its
  pixels) is an edge and is left out, at any share under 2% (above that,
  1 px rules and dithered fills, never flat either, are colours of their own);
- spare slots go to flat tints: peaks of flat pixels alone, at least 0.02 from
  every colour picked, flat over at least 0.1% of the image, and pale (OKLab
  lightness 0.85 or more). A photo's smooth sky or shadow is flat too, and
  without the lightness bar its dark shades filled Illustration's colours
  with near-copies, doubling the SVG.

On the outline fixture in `npm run score` Logo went from 13.0% to 2.1% of
pixels wrong; the badge's palette is unchanged.

## Where it doesn't apply

Photos have no peaks. On a photo the same change made things worse (9.9 →
15.3), so Poster quantizes instead: `quantizePalette` runs k-means in OKLab
over a colour histogram, each bin weighted by its pixel count. It's seeded
deterministically (the most common colour, then the colour farthest from
those chosen, weighted by how common it is), so a photo traces the same way
every time, and each colour reported is the mean of its cluster's pixels, so
it sits in the middle of the shades it stands for. The rule is per-preset because the measurements
said so.

## How the tracer uses it

The [Inlay](inlay.md) labels each pixel with its
nearest palette colour in OKLab. Pixels that sit between two colours are
decided by their neighbours, which keeps slivers of in-between colours off
every edge.
