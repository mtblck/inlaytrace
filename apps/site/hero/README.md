# The hero loop

`inlay-hero.js` is the [isogram](https://getisogram.com) diagram behind the landing page's loop
(`public/media/inlay-hero.{webm,mp4,webp}`). It defines an `inlay` look in the site's own colours
(the cutting mat `#1b352d` as its background, the yellow mark as its accent), so the video and the
mat-green hero card read as one piece in either theme.

To re-render, with the isogram skill's `scripts/build.py`:

1. `python3 build.py inlay-hero.js --out out` and open `out/inlay.html` to review it.
2. Render 360 frames (12 s at 30 fps) at 800 × 614 with no card chrome:
   `el.toCanvas({ t, width: 800, frame: false, labels: false, progress: false, look: 'inlay', theme: 'dark' })`,
   and the poster with `t: 'still'` (the pen tracing the edges).
3. Encode: `ffmpeg -framerate 30 -i f%04d.png -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 -pix_fmt yuv420p -an inlay-hero.webm`,
   `ffmpeg -framerate 30 -i f%04d.png -c:v libx264 -crf 22 -preset slow -pix_fmt yuv420p -movflags +faststart -an inlay-hero.mp4`,
   and the poster PNG to WebP (quality 88).
