# Inlay brand

Inlay's logo: a green square with a yellow quarter-disc set into its corner.
Two pieces, one shared edge, no gap and no overlap, which is the promise of
the tracer. On dark grounds the square turns paper; the app icons use the
square full bleed, and the favicon switches with the browser's theme. The wordmark is Archivo 700 (the site's own
typeface), outlined so it never depends on the font being installed.

- `draw.mjs` draws every logo from code, and `brand.json` lists the logos,
  colours, typeface and icon settings.
- `kit/` is the generated output. `brand-guidelines.pdf` is the printable
  guide (US Letter, three pages; also as HTML and one PNG per page), `check.png` is the small-size and dark tests, `svg/` and `png/` hold
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
