---
order: 3
---

# Inlay

Inlay is our shared-edge tracer, behind Logo, Illustration, Line art and Pixel
art (`src/engine/inlay.ts`). Like inlaid wood, every piece is cut to fit its
neighbours exactly. It replaced VTracer for flat art in October 2026, and for
pixel art soon after.

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
ink or paper, by a fixed threshold or a local-mean one for photos of paper).
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
  colour they share most edge with, smallest first.

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
| Current | 0.70% | 177 | 5.4 KB |

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
  (`exactPalette` in `src/lib/palette.ts`). Histogram peaks would drop a
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
(`src/engine/pixel.test.ts` checks the sprite on every run.)

