---
order: 1
---

# Presets and settings

The Trace tab. A preset is a starting point: it picks the tracer and sensible
defaults, and every setting can be changed afterwards. Changing anything
re-traces within about 120 ms of the last change.

## Presets

| Preset | For | Tracer | Defaults |
| --- | --- | --- | --- |
| **Logo** | Few flat colours, crisp corners | Inlay | 8 colours, specks 8 px, smoothing 1.5, corners 45° |
| **Illustration** | More colours, smooth curves | Inlay | 16 colours, specks 4 px, smoothing 1, corners 60° |
| **Line art** | Ink drawings and scans, one colour | Inlay | Threshold Auto, specks 6 px, smoothing 1.5, corners 45° |
| **Centerline** | Single strokes for plotters and engraving | Inlay (skeleton) | Threshold Auto, specks 4 px, smoothing 1.5, corners 45°, stroke width measured |
| **Poster** | Photos flattened into colour bands | Inlay (quantized palette) | 24 colours, specks 8 px, smoothing 1, corners 90°, stacked |
| **Pixel art** | Hard edges, nothing smoothed | Inlay (pixel staircase) | Its exact colours (up to 32); on an image that isn't pixel art (its top colours cover under 90% of it), clustered colours as Poster picks them. No speck filter, up to 4096 px |

**A photo gets a suggestion.** When an image opens on another preset and looks
like a photo (it takes more than 30 colours, at 4 bits a channel, to cover 90% of
it drawn at 96 px), a line under the presets suggests Poster, with a button to
switch. It never switches by itself, and once you pick a preset for that image
it doesn't come back.

## Prepare

Two optional AI steps run before tracing, in your browser:

- **Remove the background**: U²-Net finds the subject and everything else
  becomes transparent, so it isn't traced. Best on photos and product shots;
  logos on a plain background usually don't need it (removing that colour in
  Edit → Colours is exact).
- **Upscale 4× with AI** (images under 512 px): Real-ESRGAN rebuilds a small,
  blurry image at four times the size, with sharper edges, before tracing.

The models download from this site the first time (4.4 and 4.9 MB, plus the
3.7 MB runtime), then the browser caches them; the image isn't uploaded. The
traced, compared-against image is the prepared one. Both settings are kept
when you change preset.

## Settings

**Colours** (2–64): the cap on palette colours. Fewer means a smaller file. Set
it a little *above* the number of colours you see: anti-aliased edge shades
compete for slots, and with too low a cap two real colours merge into one.

**Ink is** (Line art, Centerline): *Dark on light* or *Light on dark*. Line art keeps one
side and makes the rest transparent; *Light on dark* inverts first. It's chosen
automatically when the image's border is dark, which turns a white logo on black
into black shapes on transparent in one step.

**Ink threshold** (Line art, Centerline): which grey counts as ink. *Auto* (the
default) splits ink from paper by the image's own shades, so coloured ink
works as well as black. *Manual* sets the level yourself (1–254). *Uneven
light* compares each pixel with its surroundings instead, for photos of paper.

**Stroke width** (Centerline, Auto or 0.5–24 px): Centerline draws each line
of ink as one stroke down its middle, rather than the outline round it, which
is what a pen plotter, a laser engraving a single line, or a cutting plotter
with a pen wants. *Auto* uses the width measured from the ink (shown beside
it); set it to your pen or bit and the strokes keep their path. Widths are in
the traced image's pixels, like every other setting. Where lines cross or
branch, strokes that carry straight on stay one stroke, so the pen lifts less.
Strokes can be recoloured, moved, scaled (their width scales with them) and
node-edited like shapes; *Mirror* works on filled shapes only, so it's off for
them. A 2048 px drawing with thick ink traces in about 1.5 s.

**Ignore specks** (0–32 px): regions smaller than this many pixels squared merge
into their surroundings. Raise it for noisy scans or JPEG speckle.

**Smoothing** (0–3): how loosely the outline is followed. It sets the fitting
tolerance: 0.25 + 0.5 × smoothing px, so the Logo default of 1.5 is 1 px, and
the slider shows that tolerance (±1.00 px). Higher means fewer nodes and a
smaller file.

**Corners** (0–180°): bends sharper than this stay corners; gentler ones become
curves. See [Curve fitting](../how-it-works/curve-fitting.md) for how a corner
is told apart from a tight curve.

**Exact shapes** (Logo, Illustration, Line art; on by default): an outline
that is a circle, an ellipse, a rectangle, a rounded rectangle or a regular
polygon is drawn as that exact shape, with true right angles and equal sides,
instead of curves fitted to its pixels. Only outlines that follow the shape
closely all the way round count, and only those with a single colour round
them (a circle overlapping another shape stays fitted). Turn it off to keep
every outline as traced.

**Shapes** (Poster only): *Stacked* draws each shape whole, larger shapes
first, so smaller ones sit on top, and each shape also reaches under the
neighbours drawn after it, so no hairline seam shows where two shapes meet
(on photos, 12% closer to the photo, for about a third more path data). *Cut out* gives every shape holes where others sit,
so none overlaps (for vinyl and screen print layers). Both look the same, and
both share every edge exactly. The flat-art presets are always cut out.

## Target size

Under the settings, *Target size*: type a size in KB and press *Find
settings*. The app traces the image again and again, starting from the current
settings, and each time takes whichever change costs the least accuracy for
the bytes it saves: smoother curves (+0.5 smoothing), a bigger speck filter, or
one colour fewer (bigger steps while the file is far over). It stops once the
file fits, or after 30 traces. Then it says what it chose and what it cost, and
nothing changes until you press *Use these settings*.

Size is the optimised SVG, exactly as exported. Accuracy is the average
difference per colour channel (0–255) between the trace, drawn back, and your
image. The search runs in a worker of its own, so the preview keeps tracing
while it works; *Stop* ends it.

On the sample badge (4.3 KB), asking for 3.9 KB raised smoothing from 1.5 to 2:
3.9 KB, average error 2.5 → 2.6. On a 600 px photo with Poster (145 KB), asking
for 60 KB took 16 traces and 10 s: 52 KB with 15 colours, specks 24 px and
smoothing 3, error 10.7 → 13.7. When nothing fits, it offers the smallest trace
it found.

## Small and large images

Images under 512 px are upscaled to 1024 px before tracing, and images over
2048 px are traced at 2048 px. The panel says when it happens. See
[The pipeline](../how-it-works/pipeline.md).

## Changing settings after editing

Colour edits survive a re-trace. Shape edits (nodes, deletes, mirror) can't, so
once you've made one, changing a trace setting asks first. See
[Undo and the edit model](undo-and-edits.md).
