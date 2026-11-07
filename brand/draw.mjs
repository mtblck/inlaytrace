// Inlay's logo: a green square with a yellow quarter-disc set into its corner.
// Two pieces, one shared edge, no gap and no overlap, which is what Inlay's
// tracer guarantees. No tile around it: the square is the logo, and the app
// icons use it full bleed.
//
//   BRAND_KIT=<brand-kit>/skills/logo/scripts node brand/draw.mjs
//   node $BRAND_KIT/export.mjs brand/brand.json   (writes brand/kit/)
// BRAND_KIT is the scripts folder of the brand-kit plugin in mtblck/claude-marketplace.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kit = process.env.BRAND_KIT
if (!kit) throw new Error("Set BRAND_KIT to the brand-kit plugin's skills/logo/scripts folder")
const { loadFont, lockup, rect, svg, write } = await import(join(kit, 'brand.mjs'))
const here = dirname(fileURLToPath(import.meta.url))
const out = (f) => join(here, f)

const C = { mat: '#23443a', paper: '#f5f6f2', mark: '#f2c230', ink: '#16201c', text: '#eef2ee', night: '#131e1a', green: '#23614c' }

// Geometry: a 128 square; the quarter-disc has radius 72 (9/16 of the side),
// centred on the square's bottom-right corner, so its arc is a true circle.
const SQ = 128, Q = 72
function pieces(gap = 0) {
  // Square minus the quarter-disc (pulled back by the gap for one-colour use).
  const r = Q + gap
  const square = `M0 0H${SQ}V${SQ - r}A${r} ${r} 0 0 0 ${SQ - r} ${SQ}H0Z`
  const inlay = `M${SQ} ${SQ - Q}V${SQ}H${SQ - Q}A${Q} ${Q} 0 0 1 ${SQ} ${SQ - Q}Z`
  return { square, inlay }
}
const art = (squareFill, inlayFill, gap = 0, cls = '') => {
  const p = pieces(gap)
  return `<path${cls ? ` class="${cls}"` : ''} d="${p.square}" fill="${squareFill}"/><path d="${p.inlay}" fill="${inlayFill}"/>`
}

const markBody = art(C.mat, C.mark)
// Light grounds: mat green. Dark grounds: the square turns paper.
write(out('mark.svg'), svg({ w: SQ, h: SQ, title: 'Inlay', body: markBody }))
write(out('mark-dark.svg'), svg({ w: SQ, h: SQ, title: 'Inlay', body: art(C.paper, C.mark) }))
// Favicon: the mark, switching to the paper square in a dark browser theme.
write(out('favicon.svg'), svg({ w: SQ, h: SQ, title: 'Inlay', body: `<style>@media (prefers-color-scheme: dark){.sq{fill:${C.paper}}}</style>` + art(C.mat, C.mark, 0, 'sq') }))
// One colour: a gap of 8 tells the two pieces apart instead of colour.
const mono = art('#000', '#000', 8)
write(out('mark-mono.svg'), svg({ w: SQ, h: SQ, title: 'Inlay', body: mono }))

const font = await loadFont('Archivo', 700)
for (const [layout, name] of [['horizontal', 'logo-horizontal'], ['stacked', 'logo-stacked']]) {
  for (const [suffix, color] of [['', C.ink], ['-dark', C.text]]) {
    const body = suffix ? art(C.paper, C.mark) : markBody
    const l = lockup({ mark: { body, w: SQ, h: SQ }, font, name: 'Inlay', layout, color, tracking: -0.02 })
    write(out(`${name}${suffix}.svg`), svg({ w: l.w, h: l.h, title: 'Inlay', body: l.body }))
  }
  const m = lockup({ mark: { body: mono, w: SQ, h: SQ }, font, name: 'Inlay', layout, color: '#000', tracking: -0.02 })
  write(out(`${name}-mono.svg`), svg({ w: m.w, h: m.h, title: 'Inlay', body: m.body }))
}

write(out('brand.json'), JSON.stringify({
  name: 'Inlay',
  tagline: 'Trace images into vector shapes that fit together.',
  colors: [
    { name: 'Ink', hex: C.ink, role: 'primary' },
    { name: 'Mat', hex: C.mat, role: 'mat' },
    { name: 'Mark', hex: C.mark, role: 'accent' },
    { name: 'Paper', hex: C.paper, role: 'paper' },
    { name: 'Green', hex: C.green, role: 'link' },
    { name: 'Night', hex: C.night, role: 'dark' },
  ],
  type: { display: { family: 'Archivo', weight: 700 }, text: { family: 'Archivo', weight: 400 } },
  logos: {
    mark: { file: 'mark.svg', dark: 'mark-dark.svg', black: 'mark-mono.svg', minWidth: 16 },
    horizontal: { file: 'logo-horizontal.svg', dark: 'logo-horizontal-dark.svg', black: 'logo-horizontal-mono.svg', minWidth: 96 },
    stacked: { file: 'logo-stacked.svg', dark: 'logo-stacked-dark.svg', black: 'logo-stacked-mono.svg', minWidth: 64 },
  },
  // Full bleed: the square is the icon. Platforms round or mask the corners.
  icon: { file: 'mark.svg', background: C.mat, scale: 1, maskableScale: 1, favicon: 'favicon.svg', themeColor: C.paper },
  clearSpace: 0.25,
  pngWidths: [512, 1024],
  out: 'kit',
}, null, 2) + '\n')
