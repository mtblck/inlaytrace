---
order: 7.5
---

# Batch

Drop several images at once, or choose several, and *Trace N images* opens:

1. It lists the images. **Trace all** traces each with the preset and settings
   you have now (whatever the Trace tab shows), optimises it as a download
   would be, and shows its size as it goes.
2. **Download zip** gives one SVG per image, named after it (`logo.png` →
   `logo.svg`; two files with the same name become `logo.svg` and
   `logo-2.svg`).

The image on screen isn't touched, and you can keep working while it runs:
the batch has a tracing worker of its own, and only one image's pixels are
held at a time. **Stop** ends it. SVG files in the batch are skipped (they're
already vectors; open one on its own to edit it), and an image that fails is
marked with the reason, without stopping the rest.

The AI steps (*Prepare*) and edits aren't applied in a batch: it's the trace
settings only.
