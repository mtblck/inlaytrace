# Inlay brand

Inlay's logo: a paper square with a yellow quarter-disc set into its corner, on
the mat-green tile. Two pieces, one shared edge, no gap and no overlap, which
is the promise of the tracer. The wordmark is Archivo 700 (the site's own
typeface), outlined so it never depends on the font being installed.

- `draw.mjs` draws every logo from code, and `brand.json` lists the logos,
  colours, typeface and icon settings.
- `kit/` is the generated output. `brand-sheet.html` / `.png` is the one-page
  guide, `check.png` is the small-size and dark tests, `svg/` and `png/` hold
  every logo (light, dark, one-colour), and `icons/` holds the favicons, app
  icons and manifest snippet.

The favicons and app icons in `apps/app/public/` and `apps/site/public/` are
copied from `kit/icons/`.

To change the logo, edit `draw.mjs` and regenerate with the `brand-kit` plugin
from [mtblck/claude-marketplace](https://github.com/mtblck/claude-marketplace):

```bash
export BRAND_KIT=<path to plugins/brand-kit/skills/logo/scripts>
node brand/draw.mjs && node "$BRAND_KIT/export.mjs" brand/brand.json
```

Then copy the icons into the two `public/` folders again.
