---
order: 8
---

# HD (beta)

The app traces at most 2048 px on the long edge (4096 for pixel art), so a big
image loses some fine detail. **HD trace** traces the same image at its full
size on Inlay's server, with the same settings, and is paid for with
[credits](https://inlaytrace.com/pricing/).

It appears under **Size and other formats** whenever the image is bigger than
the app traces, with the image's size and what it costs. The trace you see in
the app is the free preview.

1. Open **HD trace** and choose **Trace in HD**. Nothing is sent yet.
2. Sign in if you haven't (an email address, no password), and buy credits if
   you need them.
3. Confirm. The image is uploaded, traced at full size, and deleted from the
   server as soon as the result is back. If the trace fails, the credits go
   straight back to your account.
4. **Download HD** saves the SVG; **Open to edit** opens it in the editor.

Settings that are measured in pixels (the speckle filter and a set stroke
width) are scaled up to the full-size image, so the result matches what you
saw. Smoothing isn't, so finer detail survives.

| Image size | Credits |
| --- | --- |
| Up to 4 megapixels | 1 |
| Up to 16 megapixels | 2 |
| Larger (up to 50 megapixels) | 4 |

## HD upscale

For small images (up to 0.5 megapixels, about 700 × 700), HD offers a 4×
upscale with Real-ESRGAN x4plus, a larger model than the in-browser upscaler,
for 2 credits. It takes a minute or two. **Trace it** opens the result
in the app to trace; **Download PNG** saves it.

Background removal stays in the browser for now: the server-sized model was
no better than remove.bg on busy photos (see `docs/hd-mode.md`).

HD is the only part of Inlay where an image leaves your device, and only when
you confirm it for that image. See [Privacy and security](privacy-and-security.md).
