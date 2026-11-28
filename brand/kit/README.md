# Inlay brand kit

Trace images into vector shapes that fit together.

Start with `brand-guidelines.pdf`: it shows the logo, how to use it, the typefaces and the colours.

## Which file to use

| You need | Use |
| --- | --- |
| The logo on a website or in an app | `svg/horizontal.svg` (and `-dark.svg` on dark backgrounds) |
| The logo in a document, slide or email | `png/` at the width you need (transparent background) |
| The logo for a printer, sign shop or merch | `pdf/` (vector), or `svg/` if they accept it |
| Only one ink available (stamps, embroidery, engraving) | `svg/*-black.svg` or `svg/*-white.svg` |
| Favicons and app icons for a website | `icons/`: copy the files to the site root and paste `icons/head.html` into the page `<head>` |
| An App Store or Play Store icon | `icons/app-icon-1024.png` (square, opaque; the store rounds the corners) |
| A link preview (Open Graph) image | `social/og-image.png` (1200 × 630) |
| A profile picture | `social/avatar.png` (800 × 800) |
| An email signature | `templates/email/`: host `logo.png`, open `signature.html` in a browser, copy it and paste it into the mail settings |
| Business cards | `templates/business-card/business-card.pdf` (US 3.5 × 2 in, bleed included, front and back): send it to the printer as is |
| A presentation | `templates/slides/*.pptx` (PowerPoint, Keynote or Google Slides): add slides from its layouts |
| A social post, story or X header | `templates/social/`: a sample of each, plus a `-blank` version to design on |
| A case-study or portfolio page, or a Ko-fi cover | `portfolio/cover.webp` (2400 × 800, shown 1200 × 400) on wide screens, `portfolio/cover-mobile.webp` (1000 × 800) under 640 px, `portfolio/icon.png` (512, square corners), and `portfolio/alt.txt` as both covers' alt text |
| Colours for a website or app, light and dark | `web/palette.css` (or `web/palette.tailwind.css` on Tailwind v4, `web/tokens.json` for Figma or Style Dictionary); open `web/palette.html` to see every value and its contrast |

## Contents

- `brand-guidelines.pdf`: printable guidelines, US Letter (also `brand-guidelines.html` and a PNG per page)
- `svg/`: every logo: main, `-dark`, `-black`, `-white`
- `png/`: every logo at several widths, transparent
- `pdf/`: every logo as a vector PDF
- `icons/`: `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, PWA icons, `site.webmanifest`, `head.html`
- `social/`: link preview and avatar
- `templates/`: email signature, business card, slide template and social posts
- `portfolio/`: art for a case-study page and Ko-fi: a wide and a phone cover (WebP), a square icon, the alt text and a preview of them on a light and a dark page
- `web/`: the website palette: 12-step OKLCH scales and light and dark roles as CSS, a Tailwind v4 theme and W3C design tokens, with a preview and contrast report
- `check.png`: the logo at real pixel sizes, on light and dark, in browser tabs and on a home screen
- `LICENSE`: the license for everything here: all rights reserved, and not covered by any code license
- `TRADEMARKS.md`: what anyone may do with the name and logo without asking, and what not

## Using the name and logo

The Inlay name, logos and everything in this kit are all rights reserved and are not covered by the license of any code they ship with. `TRADEMARKS.md` says what you may do without asking, such as linking to Inlay or saying your project works with it. Anything else needs permission.

Typefaces: Archivo, free from fonts.google.com. The wordmark is already outlined, so the logo files don't need the font installed.
