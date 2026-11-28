// Inlay's portfolio covers: one scene, drawn twice (2400 × 800 and 1000 × 800).
//
// Verb: Inlay *traces* pixels into shapes that fit together. Picture (the
// "split" pattern), seen straight from above on a green cutting mat: the same
// small landscape twice, once as a coarse pixel tile and once as inlaid
// vector pieces, with the yellow sun (the one accent, the mark's own colour)
// being set into its slot. Shapes in the vector tile share their edges
// exactly, as the tracer's do.
//
//   BRAND_KIT=<brand-kit>/skills/logo/scripts node brand/portfolio/draw.mjs
//   (brand/draw.mjs imports this file, so running that writes the covers too)
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kit = process.env.BRAND_KIT
if (!kit) throw new Error("Set BRAND_KIT to the brand-kit plugin's skills/logo/scripts folder")
const { circle, rect, svg, write } = await import(join(kit, 'brand.mjs'))
const here = dirname(fileURLToPath(import.meta.url))

const C = {
  mat: '#23443a', matLine: '#2a4d42', paper: '#f5f6f2', slot: '#dde3df', green: '#23614c', ink: '#16201c',
  mark: '#f2c230', ochre: '#c9a94a', onMat: '#b3c0b8',
}

// The picture, on a 512 tile: sky, a back hill, a front hill, the sun.
const T = 512
const SUN = { x: 352, y: 168, r: 78 }
const BACK = { x: 130, y: 600, r: 330 }
const FRONT = { x: 480, y: 700, r: 330 }
const inC = (c, x, y) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r ** 2
const colourAt = (x, y) => (inC(FRONT, x, y) ? C.ink : inC(BACK, x, y) ? C.green : inC(SUN, x, y) ? C.ochre : C.paper)

// The hills as tile-clipped arcs (worked out by hand so the paths stay exact).
const backY = BACK.y - Math.sqrt(BACK.r ** 2 - BACK.x ** 2) // where it meets the left edge
const backX = BACK.x + Math.sqrt(BACK.r ** 2 - (BACK.y - T) ** 2) // where it meets the bottom
const frontX = FRONT.x - Math.sqrt(FRONT.r ** 2 - (FRONT.y - T) ** 2)
const frontY = FRONT.y - Math.sqrt(FRONT.r ** 2 - (T - FRONT.x) ** 2)
const f = (n) => Math.round(n * 100) / 100
const backHill = `M0 ${T}V${f(backY)}A${BACK.r} ${BACK.r} 0 0 1 ${f(backX)} ${T}Z`
const frontHill = `M${f(frontX)} ${T}A${FRONT.r} ${FRONT.r} 0 0 1 ${T} ${f(frontY)}V${T}Z`

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const toHex = (rgb) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

/** The pixel tile: 16 × 16 cells, each the average of 4 × 4 samples, so the edges show as soft steps. */
function pixelTile() {
  const N = 16, cell = T / N, S = 4
  const byColour = new Map()
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const acc = [0, 0, 0]
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const c = hex(colourAt((i + (sx + 0.5) / S) * cell, (j + (sy + 0.5) / S) * cell))
          for (let k = 0; k < 3; k++) acc[k] += c[k] / (S * S)
        }
      const key = toHex(acc)
      byColour.set(key, (byColour.get(key) || '') + rect(i * cell, j * cell, cell, cell))
    }
  return [...byColour].map(([fill, d]) => `<path d="${d}" fill="${fill}"/>`).join('')
}

/** The inlay tile: the same picture as pieces, with the sun lifted out of its slot and about to drop in. */
function inlayTile() {
  const lift = { x: 26, y: -30 }
  return (
    `<rect width="${T}" height="${T}" fill="${C.paper}"/>` +
    `<path d="${circle(SUN.x, SUN.y, SUN.r)}" fill="${C.slot}"/>` +
    `<path d="${backHill}" fill="${C.green}"/>` +
    `<path d="${frontHill}" fill="${C.ink}"/>` +
    // The sun's shadow falls in the slot, then the sun itself, the one accent.
    `<path d="${circle(SUN.x + lift.x * 0.4, SUN.y + lift.y * 0.4 + 6, SUN.r)}" fill="#000" fill-opacity="0.12"/>` +
    `<path d="${circle(SUN.x + lift.x, SUN.y + lift.y, SUN.r)}" fill="${C.mark}"/>`
  )
}

/** A tile placed at (x, y) scaled to `size`, with one soft shadow straight below it (top-down light). */
const tile = (body, x, y, size) => {
  const s = size / T
  return `<rect x="${x + 10}" y="${y + 14}" width="${size}" height="${size}" fill="#000" fill-opacity="0.12"/>` + `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s * 1e4) / 1e4})">${body}</g>`
}

function scene(W, H, { size, gap, title }) {
  const cx = W / 2, cy = H / 2 - 10
  const parts = [`<rect width="${W}" height="${H}" fill="${C.mat}"/>`]
  // The cutting mat's grid, faint, edge to edge.
  let grid = ''
  for (let x = 40; x < W; x += 80) grid += rect(x - 1, 0, 2, H)
  for (let y = 40; y < H; y += 80) grid += rect(0, y - 1, W, 2)
  parts.push(`<path d="${grid}" fill="${C.matLine}"/>`)
  const x0 = cx - gap / 2 - size, x1 = cx + gap / 2, y = cy - size / 2
  parts.push(tile(pixelTile(), x0, y, size))
  parts.push(tile(inlayTile(), x1, y, size))
  // Between them, three steps from small to large: pixels in, shapes out.
  const step = gap / 4
  parts.push([0.5, 0.75, 1].map((k, i) => `<path d="${circle(cx - step + i * step, cy, (gap / 22) * k)}" fill="${C.onMat}"/>`).join(''))
  return svg({ w: W, h: H, title, body: parts.join('') })
}

export const alt =
  'On a green cutting mat, the same small landscape of two hills and a sun appears twice, first as a coarse grid of square pixels and then as smooth pieces that fit together, with the yellow sun being lowered into its round slot.'

write(join(here, 'cover.svg'), scene(2400, 800, { title: alt, size: 580, gap: 200 }))
write(join(here, 'cover-mobile.svg'), scene(1000, 800, { title: alt, size: 270, gap: 60 }))
