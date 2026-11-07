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

## Contents

- `brand-guidelines.pdf`: printable guidelines, US Letter (also `brand-guidelines.html` and a PNG per page)
- `svg/`: every logo: main, `-dark`, `-black`, `-white`
- `png/`: every logo at several widths, transparent
- `pdf/`: every logo as a vector PDF
- `icons/`: `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, PWA icons, `site.webmanifest`, `head.html`
- `social/`: link preview and avatar
- `check.png`: the logo at real pixel sizes, on light and dark, in browser tabs and on a home screen

Typefaces: Archivo, free from fonts.google.com. The wordmark is already outlined, so the logo files don't need the font installed.
