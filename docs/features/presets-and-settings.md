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
| **Logo** | Few flat colours, crisp corners | Shared edges | 8 colours, specks 8 px, smoothing 1.5, corners 45° |
| **Illustration** | More colours, smooth curves | Shared edges | 16 colours, specks 4 px, smoothing 1, corners 60° |
| **Line art** | Ink drawings and scans, one colour | Shared edges | Threshold 128, specks 6 px, smoothing 1.5, corners 45° |
| **Poster** | Photos flattened into colour bands | VTracer | 24 colours, specks 8 px, smoothing 1, corners 90°, stacked |
| **Pixel art** | Hard edges, nothing smoothed | VTracer (pixel mode) | 32 colours, no speck filter, up to 4096 px |

## Settings

**Colours** (2–64): the cap on palette colours. Fewer means a smaller file. Set
it a little *above* the number of colours you see: anti-aliased edge shades
compete for slots, and with too low a cap two real colours merge into one.

**Ink is** (Line art): *Dark on light* or *Light on dark*. Line art keeps one
side and makes the rest transparent; *Light on dark* inverts first. It's chosen
automatically when the image's border is dark, which turns a white logo on black
into black shapes on transparent in one step.

**Ink threshold** (Line art, 1–254): which grey counts as ink. *Adapt to uneven
lighting* compares each pixel with its surroundings instead, for photos of
paper.

**Ignore specks** (0–32 px): regions smaller than this many pixels squared merge
into their surroundings. Raise it for noisy scans or JPEG speckle.

**Smoothing** (0–3): how loosely the outline is followed. For the shared-edge
tracer it sets the fitting tolerance: 0.25 + 0.5 × smoothing px, so the Logo
default of 1.5 is 1 px, and the slider shows that tolerance (±1.00 px). Higher
means fewer nodes and a smaller file. For Poster it is VTracer's
simplification, and 0 turns it off.

**Corners** (0–180°): bends sharper than this stay corners; gentler ones become
curves. See [Curve fitting](../how-it-works/curve-fitting.md) for how a corner
is told apart from a tight curve.

**Shapes** (Poster and Pixel art only): *Stacked* shapes sit on top of each
other (smaller files); *Cut out* shapes never overlap (for vinyl and screen
print layers). Flat-art presets always share edges exactly, so they don't need
the choice.

## Small and large images

Images under 512 px are upscaled to 1024 px before tracing, and images over
2048 px are traced at 2048 px. The panel says when it happens. See
[The pipeline](../how-it-works/pipeline.md).

## Changing settings after editing

Colour edits survive a re-trace. Shape edits (nodes, deletes, mirror) can't, so
once you've made one, changing a trace setting asks first. See
[Undo and the edit model](undo-and-edits.md).
