---
public: true
---

# 0003: Text is drawn in the closest bundled font, matched by drawing it

- **Status:** Accepted
- **Date:** 2026-10-27
- **PR:** (this PR)

## Context

Traced text is the weakest part of most traces: letters come out lumpy, and
small text breaks into fragments. Designers fix it by hand, retyping the text
in a matching font and converting it to outlines. We wanted the app to do that:
find the text, pick the nearest font at the right size and weight, and outline
it.

Options for each part, within the app's rules (client-only, images never leave
the device, `connect-src 'self'`, no GPL, WebAssembly only in the AI worker):

- **Reading text.** Tesseract (Apache 2.0) as WebAssembly: about 1 MB of engine
  and a 3 MB English model. PaddleOCR on our existing ONNX Runtime is stronger on
  photos and rotated text, but heavier to set up. tesseract.js itself would start
  a worker of its own and fetch from a CDN, so we call its core directly.
- **Picking the font.** Font-ID classifiers exist (an Apache-licensed DINOv2 model
  of 394 Google families, about 350 MB; DeepFont-style embeddings; proprietary
  WhatTheFont and Adobe), but OCR already gives the letters. So each candidate
  font draws the same words, scaled onto the word's ink, and the best soft
  overlap (IoU) wins, giving size and position in the same pass. In a prototype
  (70 families, 60 images of known fonts), that picked the right family 92% of
  the time and the weight 87%, with sizes within about 1%, in a few hundred lines
  and no model. On shrunk JPEGs it held at 18 px and up (31 of 36) but not below.
- **The fonts.** Google Fonts can't be fetched from the app (CSP), and matching
  needs outlines, so we serve our own: about 100 popular families, 467 static
  styles, subset to Latin and kerning, as WOFF (7.3 MB). All OFL, Apache or UFL;
  outlines of them in a user's SVG are the user's artwork.

## Decision

We read text with Tesseract's core in the AI worker, match each block of text to
the bundled Google Fonts by drawing it in every style and keeping the best
overlap, and add the words to the trace as outlined glyph shapes, with the text
painted out of what's traced. It's an opt-in *Recognise text* step, marked
experimental, and a block that matches no font well stays traced.

## Consequences

- No new host, no new CSP: the engine, model and fonts come from this site and
  are cached on first use (about 11 MB). The main app still runs no WebAssembly.
- Matching costs about 2 s a text block on a laptop and grows with the font list,
  so the list stays curated. Searching all of Google Fonts (about 8,000 styles)
  needs a learned shortlist first, or the server (HD).
- Fonts outside Google Fonts (Helvetica, Futura, Proxima Nova) come back as the
  nearest lookalike. Small or damaged text is often a lookalike too.
- Horizontal Latin text on a flat background only, for now: no rotated, curved
  or vertical text, no letter-spacing fit, no ligatures (opentype.js can't read
  some fonts' substitution tables, so we lay out text ourselves), and text on a
  gradient or photo stays traced.
- Revisit if the curated list keeps missing common fonts, if speed matters more
  (a learned shortlist), or if a font picker per block lands (the user choosing
  among the top matches).
