# The hero loop

`inlay-hero.js` is the [isogram](https://getisogram.com) diagram behind the landing page's loop
(`public/media/inlay-hero.{webm,mp4,webp}`). It defines an `inlay` look in the site's own colours
(the cutting mat `#1b352d` as its background, the yellow mark as its accent), so the video and the
mat-green hero card read as one piece in either theme.

To re-render, with the isogram skill's scripts (ffmpeg installed for the video):

```sh
python3 scripts/build.py inlay-hero.js --out out
node scripts/export.mjs out/inlay.html --looks inlay --theme dark --formats webm,mp4,png --no-frame --width 800 --out out
```

That writes `inlay-inlay-dark.webm` and `.mp4` (800 × 614, 30 fps, constant-quality VP9 / H.264) and the
poster PNG at the diagram's `still` frame (the pen tracing the edges); convert the PNG to WebP (quality 88)
and copy the three into `public/media/` as `inlay-hero.*`.
