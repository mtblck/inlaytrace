/**
 * Export sizes, and the drawing as PDF and EPS, built here rather than by a
 * library: both are a handful of path operators per shape. Every shape becomes
 * a filled vector path (nonzero fill, as in the SVG), so print shops and
 * cutters get real curves, not a picture.
 */
import { zlibSync, strToU8 } from 'fflate'
import { parsePath } from './pathdata'

export type Unit = 'px' | 'mm' | 'in' | 'pt'
export const UNITS: Unit[] = ['px', 'mm', 'in', 'pt']
/** Points (1/72 in) per unit, with CSS's 96 px to the inch. */
const PT: Record<Unit, number> = { px: 0.75, mm: 72 / 25.4, in: 72, pt: 1 }
export const toPt = (v: number, u: Unit) => v * PT[u]
export const convert = (v: number, from: Unit, to: Unit) => (v * PT[from]) / PT[to]

export type ExportSize = { width: number; height: number; unit: Unit }

/** Shapes as drawn: colour already resolved (recolours applied, removed inks gone). */
export type Drawable = { width: number; height: number; background: string | null; paths: { d: string; fill: string }[] }

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

/**
 * Set the root <svg>'s width and height (with units), keeping its viewBox, so
 * it opens at that physical size and still scales cleanly. SVGO may have
 * dropped or kept the attributes; either way exactly one of each is written.
 */
export function withSize(svg: string, size: ExportSize): string {
  const unit = size.unit === 'px' ? '' : size.unit
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    const stripped = tag.replace(/\s(width|height)="[^"]*"/g, '')
    return stripped.replace(/^<svg/, `<svg width="${fmt(size.width)}${unit}" height="${fmt(size.height)}${unit}"`)
  })
}

/** The size in pixels for a PNG: px sizes times `scale`; physical sizes at `dpi`. */
export function pngPixels(size: ExportSize, scale: number, dpi: number) {
  const px = (v: number) => (size.unit === 'px' ? v * scale : (toPt(v, size.unit) / 72) * dpi)
  return { width: Math.max(1, Math.round(px(size.width))), height: Math.max(1, Math.round(px(size.height))) }
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)

/**
 * Path operators shared by PDF and PostScript (they name them differently).
 * Coordinates are mapped from the drawing's viewBox to points, with y flipped:
 * both put the origin at the bottom-left.
 */
function pathOps(d: string, map: (x: number, y: number) => [number, number], ops: { m: string; l: string; c: string; h: string }) {
  const out: string[] = []
  const p = (x: number, y: number) => map(x, y).map(fmt).join(' ')
  for (const s of parsePath(d)) {
    const n = s.nodes
    if (!n.length) continue
    out.push(`${p(n[0].x, n[0].y)} ${ops.m}`)
    const seg = (a: (typeof n)[number], b: (typeof n)[number]) => {
      if (!a.out && !b.in) out.push(`${p(b.x, b.y)} ${ops.l}`)
      else {
        const c1 = a.out ?? a
        const c2 = b.in ?? b
        out.push(`${p(c1.x, c1.y)} ${p(c2.x, c2.y)} ${p(b.x, b.y)} ${ops.c}`)
      }
    }
    for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i])
    if (s.closed) {
      if (n.length > 1 && (n[n.length - 1].out || n[0].in)) seg(n[n.length - 1], n[0])
      out.push(ops.h)
    }
  }
  return out.join('\n')
}

function body(drawing: Drawable, wPt: number, hPt: number, ops: { m: string; l: string; c: string; h: string; color: (c: number[]) => string; fill: string }) {
  const sx = wPt / drawing.width
  const sy = hPt / drawing.height
  const map = (x: number, y: number): [number, number] => [x * sx, hPt - y * sy]
  const parts: string[] = []
  if (drawing.background) parts.push(`${ops.color(rgb(drawing.background))}\n${['0 0', `${fmt(wPt)} 0`, `${fmt(wPt)} ${fmt(hPt)}`, `0 ${fmt(hPt)}`].map((q, i) => `${q} ${i ? ops.l : ops.m}`).join('\n')}\n${ops.h}\n${ops.fill}`)
  for (const path of drawing.paths) {
    const geometry = pathOps(path.d, map, ops)
    if (geometry) parts.push(`${ops.color(rgb(path.fill))}\n${geometry}\n${ops.fill}`)
  }
  return parts.join('\n')
}

/** A one-page PDF, the page exactly the export size, its content Flate-compressed. */
export function buildPdf(drawing: Drawable, size: ExportSize, title = 'img-to-svg'): Uint8Array {
  const w = toPt(size.width, size.unit)
  const h = toPt(size.height, size.unit)
  const content = body(drawing, w, h, { m: 'm', l: 'l', c: 'c', h: 'h', color: (c) => `${c.map(fmt).join(' ')} rg`, fill: 'f' })
  const stream = zlibSync(strToU8(content), { level: 9 })
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?')
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(w)} ${fmt(h)}] /Contents 4 0 R /Resources << >> >>`],
    [`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, stream, '\nendstream'],
    [`<< /Title (${esc(title)}) /Producer (img-to-svg, mattblack.space) >>`],
  ]
  const chunks: Uint8Array[] = []
  let offset = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? strToU8(part) : part
    chunks.push(bytes)
    offset += bytes.length
  }
  // The binary comment line tells transfer tools the file isn't plain text.
  push('%PDF-1.4\n')
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  const offsets: number[] = []
  objects.forEach((parts, i) => {
    offsets.push(offset)
    push(`${i + 1} 0 obj\n`)
    parts.forEach(push)
    push('\nendobj\n')
  })
  const xref = offset
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(offset)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

/** Encapsulated PostScript: plain text, bounding box the export size in points. */
export function buildEps(drawing: Drawable, size: ExportSize, title = 'img-to-svg'): string {
  const w = toPt(size.width, size.unit)
  const h = toPt(size.height, size.unit)
  const content = body(drawing, w, h, { m: 'moveto', l: 'lineto', c: 'curveto', h: 'closepath', color: (c) => `${c.map(fmt).join(' ')} setrgbcolor`, fill: 'fill' })
  return [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(w)} ${Math.ceil(h)}`,
    `%%HiResBoundingBox: 0 0 ${fmt(w)} ${fmt(h)}`,
    `%%Title: ${title.replace(/[\r\n]/g, ' ')}`,
    '%%Creator: img-to-svg, mattblack.space',
    '%%Pages: 1',
    '%%EndComments',
    'gsave',
    content,
    'grestore',
    'showpage',
    '%%EOF',
    '',
  ].join('\n')
}
