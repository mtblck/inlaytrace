---
order: 3
---

# Inlay

Inlay is our shared-edge tracer, behind every preset
(`packages/inlay/src/inlay.ts`). Like inlaid wood, every piece is cut to fit its
neighbours exactly. It replaced VTracer for flat art in October 2026, for
pixel art soon after, and for photos (Poster) last, once it had a quantized
palette and stacked shapes ([VTracer](vtracer.md) has the numbers).

## Why we wrote our own

VTracer traces every colour region on its own and smooths each outline into
curves without knowing where the corners are. On the sample badge that turned
straight mountain slopes into slow S-bends and peaks into rounded bumps with two
nodes a pixel apart. None of its settings gave straight lines *and* sharp
corners.

The obvious fix, refitting each traced shape, opened a worse problem: hairline
gaps. In cut-out mode every edge between two colours is traced twice, once per
shape, and two independent fits land a fraction of a pixel apart, so the
background shows through. The answer was to trace each edge **once**.

## The steps

### 1. Label every pixel

Each pixel gets the nearest [palette](palettes.md) colour in OKLab (Line art:
ink or paper, by one threshold for the whole image, the image's own Otsu split
by default, or a local-mean one for photos of paper).
Transparent pixels are left out.

A pixel that sits clearly between two colours (anti-aliasing, JPEG ringing)
takes the closest colour **among its neighbours** rather than the closest
overall. Otherwise an edge between red and blue grows a one-pixel purple
sliver along its whole length.

### 2. Clean the map

- **Spurs:** a pixel whose eight neighbours are at least seven of one other
  colour takes that colour. JPEG noise leaves exactly these single-pixel spurs
  and nicks where colours meet, and fitted they became bumps and notches.
- **Specks:** regions smaller than *Ignore specks*² pixels merge into the
  nearest colour among their neighbours, smallest first (on photos, Poster,
  the colour they share most edge with). Lossy compression splits a thin
  stroke into two shades of its ink, and by shared edge each piece joined the
  paper it mostly touches, so the stroke dissolved.
- **Slivers** (flat art): regions under 2 px wide on average merge into a
  neighbour within 0.12 of their colour in OKLab, so a letter stem dark at its
  edges and lighter down its middle becomes one shape, not a spike-prone
  strip inside another. A hairline of a colour of its own has no neighbour
  that close and stays.

### 3. Walk the boundaries

Regions are 4-connected components of one colour. The tracer walks the cracks
between differently labelled pixels. Where three or more regions meet (or two
meet diagonally) is a **junction**; each boundary between two junctions is one
**chain**, with one region on each side. Boundaries with no junction (an island
inside one colour) are closed loops.

### 4. Fit each chain once

Every chain becomes lines and curves exactly once, by the
[curve fitter](curve-fitting.md). Nothing about the fit depends on which side
it's viewed from.

With `shapes` on, a closed chain (one neighbour all the way round) is first
checked against exact shapes (`packages/inlay/src/shapes.ts`). The pixel
region's area, centroid and second moments give the candidate directly: an
ellipse with semi-axes a and b has variances a²/4 and b²/4 along its axes, a
w × h rectangle w²/12 and h²/12, and a rounded rectangle's corner radius is
what its corners lose from the bounding box's area. A regular polygon's size
comes from its area and its turn from the corners the fitter found. The
candidate is kept only if the midpoints of the outline's pixel edges lie within
0.3 px of it (RMS) and 0.85 px at worst; otherwise the chain is fitted as
usual. Because the chain is shared, both neighbours get the same exact shape.

### 5. Build the shapes

Each region's outline is its chains joined end to end, reversing the ones it
sees from the other side. Where a region touches itself at a corner, the walk
turns left, which keeps diagonal neighbours as separate shapes. Holes are
wound the opposite way, so the default fill rule cuts them. Each region is one
`<path>`, largest first.

**Result:** neighbouring shapes share the *same* fitted edge. No gaps, no
overlaps, which is also what a vinyl cutter or a screen printer needs. A unit
test traces a three-colour image and checks the shapes' areas add up to the
whole image to within 0.2%.

## Numbers

On the sample badge, scored at 4× against the clean art
(see [Measuring quality](measuring-quality.md)):

| | Wrong pixels | Nodes | Size |
| --- | --- | --- | --- |
| VTracer (previous Logo settings) | 0.86% | 259 | 7.3 KB |
| Shared edges, first version | 0.74% | 167 | 5.0 KB |
| Corners by their sides, round ends | 0.70% | 177 | 5.4 KB |
| Current: + exact shapes | 0.54% | 175 | 5.4 KB |

On a 2048 px image it traces in about 1.3 s, where VTracer took 17.5 s on the
same image.

## Limits

- A line one pixel wide survives the spur cleanup but loses up to two pixels at
  each end, because an end pixel looks exactly like a spur. Small images are
  upscaled first, so this rarely matters.
- Gradients become bands, one region per palette colour. Use Poster for photos.

## Pixel art

Pixel art skips the clean-up and the fitting (`pixels: true`):

- **Palette:** the image's exact colours, most-used first
  (`exactPalette` in `packages/inlay/src/palette.ts`). Histogram peaks would drop a
  one-pixel eye for being rare and fold two close shades into one.
- **No despur:** a lone pixel is deliberate.
- **No fitting:** each boundary is its exact pixel staircase, with straight
  runs joined into single lines (`staircase`). Every node sits on a pixel
  corner, with no handles.

On a 16 × 16 test sprite (7 colours, two close skin shades, a one-pixel eye)
both Inlay and VTracer's pixel mode draw every pixel exactly. Inlay used 240
nodes against VTracer's 278 and about the same bytes, with 31 paths against 25,
because its shapes are cut out to tile rather than stacked. On a 1024 px
sprite it took 0.2 s against 0.85 s; on a 1024 px photo picked as pixel art
(a worst case), 6.5 s and 12 MB against 27 s and 20 MB.
(`apps/app/src/engine/pixel.test.ts` checks the sprite on every run.)

