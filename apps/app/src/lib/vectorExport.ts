/**
 * Export sizes, and the drawing as PDF and EPS, built here rather than by a
 * library: both are a handful of path operators per shape. Every shape becomes
 * a filled vector path (nonzero fill, as in the SVG), or for centerline a
 * round-capped stroke, so print shops, cutters and plotters get real curves,
 * not a picture.
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
export type Drawable = { width: number; height: number; background: string | null; paths: { d: string; fill: string; stroke?: number }[] }

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

type Ops = { m: string; l: string; c: string; h: string; color: (c: number[]) => string; fill: string; strokeStyle: (c: number[], width: number) => string; stroke: string }

function body(drawing: Drawable, wPt: number, hPt: number, ops: Ops) {
  const sx = wPt / drawing.width
  const sy = hPt / drawing.height
  const map = (x: number, y: number): [number, number] => [x * sx, hPt - y * sy]
  const parts: string[] = []
  if (drawing.background) parts.push(`${ops.color(rgb(drawing.background))}\n${['0 0', `${fmt(wPt)} 0`, `${fmt(wPt)} ${fmt(hPt)}`, `0 ${fmt(hPt)}`].map((q, i) => `${q} ${i ? ops.l : ops.m}`).join('\n')}\n${ops.h}\n${ops.fill}`)
  for (const path of drawing.paths) {
    const geometry = pathOps(path.d, map, ops)
    if (!geometry) continue
    // A stroke's width scales with the drawing (the mean of the two scales, for a stretched export).
    if (path.stroke) parts.push(`${ops.strokeStyle(rgb(path.fill), (path.stroke * (sx + sy)) / 2)}\n${geometry}\n${ops.stroke}`)
    else parts.push(`${ops.color(rgb(path.fill))}\n${geometry}\n${ops.fill}`)
  }
  return parts.join('\n')
}

/** A one-page PDF, the page exactly the export size, its content Flate-compressed. */
export function buildPdf(drawing: Drawable, size: ExportSize, title = 'Inlay'): Uint8Array {
  const w = toPt(size.width, size.unit)
  const h = toPt(size.height, size.unit)
  const content = body(drawing, w, h, {
    m: 'm',
    l: 'l',
    c: 'c',
    h: 'h',
    color: (c) => `${c.map(fmt).join(' ')} rg`,
    fill: 'f',
    // Round caps and joins (1 J, 1 j), as in the SVG.
    strokeStyle: (c, width) => `${c.map(fmt).join(' ')} RG ${fmt(width)} w 1 J 1 j`,
    stroke: 'S',
  })
  const stream = zlibSync(strToU8(content), { level: 9 })
  const esc = (s: string) => s.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?')
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(w)} ${fmt(h)}] /Contents 4 0 R /Resources << >> >>`],
    [`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`, stream, '\nendstream'],
    [`<< /Title (${esc(title)}) /Producer (Inlay, an image-to-SVG tracer) >>`],
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
export function buildEps(drawing: Drawable, size: ExportSize, title = 'Inlay'): string {
  const w = toPt(size.width, size.unit)
  const h = toPt(size.height, size.unit)
  const content = body(drawing, w, h, {
    m: 'moveto',
    l: 'lineto',
    c: 'curveto',
    h: 'closepath',
    color: (c) => `${c.map(fmt).join(' ')} setrgbcolor`,
    fill: 'fill',
    strokeStyle: (c, width) => `${c.map(fmt).join(' ')} setrgbcolor ${fmt(width)} setlinewidth 1 setlinecap 1 setlinejoin`,
    stroke: 'stroke',
  })
  return [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(w)} ${Math.ceil(h)}`,
    `%%HiResBoundingBox: 0 0 ${fmt(w)} ${fmt(h)}`,
    `%%Title: ${title.replace(/[\r\n]/g, ' ')}`,
    '%%Creator: Inlay, an image-to-SVG tracer',
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

// ---- DXF ----------------------------------------------------------------------

/** How far a DXF polyline may stray from the curve it stands for, in drawing (trace) pixels. */
export const DXF_TOLERANCE = 0.05

/** AutoCAD's 255 indexed colours aren't needed: the nearest of the basic and grey ones is enough to tell layers apart. */
const ACI: [number, number[]][] = [
  [1, [255, 0, 0]],
  [2, [255, 255, 0]],
  [3, [0, 255, 0]],
  [4, [0, 255, 255]],
  [5, [0, 0, 255]],
  [6, [255, 0, 255]],
  [7, [0, 0, 0]],
  [8, [128, 128, 128]],
  [9, [192, 192, 192]],
  [30, [255, 127, 0]],
  [40, [255, 191, 0]],
]
const nearestAci = (hex: string) => {
  const c = rgb(hex).map((v) => v * 255)
  return ACI.reduce((best, [i, a]) => {
    const d = (a[0] - c[0]) ** 2 + (a[1] - c[1]) ** 2 + (a[2] - c[2]) ** 2
    return d < best.d ? { i, d } : best
  }, { i: 7, d: Infinity }).i
}

/** A cubic as points, split until each piece is within `tol` of a straight line. */
function flattenCubic(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }, tol: number, out: { x: number; y: number }[], depth = 0) {
  // Control points' distance from the chord bounds the curve's.
  const dx = d.x - a.x
  const dy = d.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const off = Math.max(Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx), Math.abs((c.x - a.x) * dy - (c.y - a.y) * dx)) / len
  if (off <= tol || depth > 16) {
    out.push(d)
    return
  }
  const m = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
  const ab = m(a, b)
  const bc = m(b, c)
  const cd = m(c, d)
  const abc = m(ab, bc)
  const bcd = m(bc, cd)
  const mid = m(abc, bcd)
  flattenCubic(a, ab, abc, mid, tol, out, depth + 1)
  flattenCubic(mid, bcd, cd, d, tol, out, depth + 1)
}

/**
 * DXF (R12, the version every CAD and cutting program reads): one layer per
 * colour, named for it, each outline (or centerline stroke) a 2D polyline,
 * curves flattened to within DXF_TOLERANCE px of the drawing, scaled to the
 * export size in its unit (y up, as DXF has it). Closed outlines are closed
 * polylines; a cutter cuts holes as their own loops.
 */
export function buildDxf(drawing: Drawable, size: ExportSize): string {
  const sx = size.width / drawing.width
  const sy = size.height / drawing.height
  const map = (p: { x: number; y: number }) => [p.x * sx, size.height - p.y * sy]
  const layers = [...new Set(drawing.paths.map((p) => p.fill))]
  const layerName = (hex: string) => `INK_${hex.slice(1).toUpperCase()}`
  const out: (string | number)[] = []
  const g = (code: number, value: string | number) => out.push(code, value)
  // Header: units for programs that read them ($INSUNITS: 1 in, 4 mm; 0 unitless for px and pt).
  g(0, 'SECTION')
  g(2, 'HEADER')
  g(9, '$ACADVER')
  g(1, 'AC1009')
  g(9, '$INSUNITS')
  g(70, size.unit === 'mm' ? 4 : size.unit === 'in' ? 1 : 0)
  g(9, '$EXTMIN')
  g(10, 0)
  g(20, 0)
  g(9, '$EXTMAX')
  g(10, fmt(size.width))
  g(20, fmt(size.height))
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'TABLES')
  g(0, 'TABLE')
  g(2, 'LAYER')
  g(70, layers.length)
  for (const hex of layers) {
    g(0, 'LAYER')
    g(2, layerName(hex))
    g(70, 0)
    g(62, nearestAci(hex))
    g(6, 'CONTINUOUS')
  }
  g(0, 'ENDTAB')
  g(0, 'ENDSEC')
  g(0, 'SECTION')
  g(2, 'ENTITIES')
  const tol = DXF_TOLERANCE
  for (const path of drawing.paths) {
    for (const s of parsePath(path.d)) {
      const n = s.nodes
      if (n.length < 2 && !(s.closed && n.length)) continue
      const pts = [{ x: n[0].x, y: n[0].y }]
      const segs = s.closed ? n.length : n.length - 1
      for (let i = 0; i < segs; i++) {
        const a = n[i]
        const b = n[(i + 1) % n.length]
        if (!a.out && !b.in) pts.push({ x: b.x, y: b.y })
        else flattenCubic(a, a.out ?? a, b.in ?? b, b, tol, pts)
      }
      // A closed loop ends where it starts; the closed flag draws that edge.
      if (s.closed && pts.length > 1) pts.pop()
      g(0, 'POLYLINE')
      g(8, layerName(path.fill))
      g(66, 1)
      g(10, 0)
      g(20, 0)
      g(30, 0)
      g(70, s.closed ? 1 : 0)
      for (const p of pts) {
        const [x, y] = map(p)
        g(0, 'VERTEX')
        g(8, layerName(path.fill))
        g(10, fmt(x))
        g(20, fmt(y))
        g(30, 0)
      }
      g(0, 'SEQEND')
      g(8, layerName(path.fill))
    }
  }
  g(0, 'ENDSEC')
  g(0, 'EOF')
  return out.join('\n') + '\n'
}
