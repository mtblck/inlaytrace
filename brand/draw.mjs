// Inlay's logo: a paper square with a yellow quarter-disc set into its corner.
// Two pieces, one shared edge, no gap and no overlap, which is what Inlay's
// tracer guarantees. Drawn on a 208 tile in Inlay's mat green.
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

// Geometry (208 grid): tile radius 46; the inlaid square is 128 (62 % of the
// tile), centred; the quarter-disc has radius 72 (9/16 of the square), centred
// on the square's bottom-right corner, so its arc is a true circle.
const T = 208, SQ = 128, Q = 72
function pieces(x, y, gap = 0) {
  const x2 = x + SQ, y2 = y + SQ
  // Paper: the square minus the quarter-disc (pulled back by the gap for one-colour use).
  const r = Q + gap
  const paper = `M${x} ${y}H${x2}V${y2 - r}A${r} ${r} 0 0 0 ${x2 - r} ${y2}H${x}Z`
  const inlay = `M${x2} ${y2 - Q}V${y2}H${x2 - Q}A${Q} ${Q} 0 0 1 ${x2} ${y2 - Q}Z`
  return { paper, inlay }
}
const tile = (fill) => `<path d="${rect(0, 0, T, T, 46)}" fill="${fill}"/>`
const art = (x, y, paperFill, inlayFill, gap = 0) => {
  const p = pieces(x, y, gap)
  return `<path d="${p.paper}" fill="${paperFill}"/><path d="${p.inlay}" fill="${inlayFill}"/>`
}

const o = (T - SQ) / 2
const markBody = tile(C.mat) + art(o, o, C.paper, C.mark)
// The tile carries the contrast, so one mark works on light and dark grounds.
write(out('mark.svg'), svg({ w: T, h: T, title: 'Inlay', body: markBody }))
// App-icon art (the export puts it on a mat tile at 62 %): the two pieces alone.
write(out('icon-art.svg'), svg({ w: SQ, h: SQ, title: 'Inlay', body: art(0, 0, C.paper, C.mark) }))
// One colour: no tile; a gap of 8 tells the two pieces apart instead of colour.
const mono = art(0, 0, '#000', '#000', 8)
write(out('mark-mono.svg'), svg({ w: SQ, h: SQ, title: 'Inlay', body: mono }))

const font = await loadFont('Archivo', 700)
for (const [layout, name] of [['horizontal', 'logo-horizontal'], ['stacked', 'logo-stacked']]) {
  for (const [suffix, color] of [['', C.ink], ['-dark', C.text]]) {
    const l = lockup({ mark: { body: markBody, w: T, h: T }, font, name: 'Inlay', layout, color, tracking: -0.02 })
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
    mark: { file: 'mark.svg', dark: 'mark.svg', black: 'mark-mono.svg', minWidth: 16 },
    horizontal: { file: 'logo-horizontal.svg', dark: 'logo-horizontal-dark.svg', black: 'logo-horizontal-mono.svg', minWidth: 96 },
    stacked: { file: 'logo-stacked.svg', dark: 'logo-stacked-dark.svg', black: 'logo-stacked-mono.svg', minWidth: 64 },
  },
  icon: { file: 'icon-art.svg', background: C.mat, favicon: 'mark.svg', themeColor: C.paper },
  clearSpace: 0.25,
  pngWidths: [512, 1024],
  out: 'kit',
}, null, 2) + '\n')
