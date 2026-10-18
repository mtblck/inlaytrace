/**
 * Opening an existing SVG to edit, rather than a raster to trace.
 *
 * The file is read as data, never as markup to show: its shapes (path, rect,
 * circle, ellipse, line, polyline, polygon, in any nesting of groups and
 * transforms) become paths in absolute M/L/C/Z written by our own serialiser,
 * with colours normalised to #rrggbb, so it goes through the same checks as a
 * trace. What the editor can't represent is reported, not dropped silently:
 * text, images, filters, clip paths and masks, <use>, opacity, style sheets.
 * Gradients and patterns are drawn in one colour (a gradient's first stop),
 * and said so. Even-odd fills are rewritten as nonzero by turning each
 * subpath the right way round for how deep it's nested.
 */
import { mapPoints, parsePath, serializePath, type Pt, type Subpath } from './pathdata'
import { multiply, parseTransform, type Matrix } from './doc'
import { normalizeHex, type Trace, type TracedPath } from './svg'

export type SvgImport = { trace: Trace; notes: string[] }

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const CONTAINERS = new Set(['svg', 'g', 'a', 'switch'])
/** Elements that never draw anything themselves. */
const SILENT = new Set(['defs', 'title', 'desc', 'metadata', 'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'filter', 'symbol', 'marker', 'style', 'script'])
/** What's reported when found, by element name. */
const UNSUPPORTED: Record<string, string> = { text: 'text', image: 'image', use: '<use> reference', foreignObject: 'embedded HTML' }

type Paint = { fill: string; stroke: string; strokeWidth: string; fillRule: string; display: string; visibility: string }

export function importSvg(text: string): SvgImport {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) throw new Error('That file isn’t an SVG this can read.')

  // The drawing's coordinate space: the viewBox, or the width and height.
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
  const length = (v: string | null) => {
    const m = /^([\d.]+)\s*(px|mm|cm|in|pt|pc)?$/.exec((v ?? '').trim())
    if (!m) return NaN
    return Number(m[1]) * ({ mm: 96 / 25.4, cm: 96 / 2.54, in: 96, pt: 4 / 3, pc: 16 } as Record<string, number>)[m[2] ?? ''] || Number(m[1])
  }
  let [x0, y0, width, height] = vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, length(root.getAttribute('width')), length(root.getAttribute('height'))]
  if (!(width > 0 && height > 0)) [x0, y0, width, height] = [0, 0, 300, 150] // the size browsers give an SVG with none
  const origin: Matrix = [1, 0, 0, 1, -x0, -y0]

  const counts = new Map<string, number>()
  const note = (what: string) => counts.set(what, (counts.get(what) ?? 0) + 1)
  const ids = new Map<string, Element>()
  for (const el of Array.from(doc.querySelectorAll('[id]'))) ids.set(el.getAttribute('id')!, el)
  if (doc.getElementsByTagName('style').length) note('style sheet (inline styles are read, <style> rules aren’t)')

  const paths: TracedPath[] = []
  const inherit: Paint = { fill: '#000000', stroke: 'none', strokeWidth: '1', fillRule: 'nonzero', display: 'inline', visibility: 'visible' }

  const walk = (el: Element, m: Matrix, parent: Paint) => {
    const name = el.localName
    if (SILENT.has(name)) return
    const paint = paintOf(el, parent)
    if (paint.display === 'none') return
    const t = el.getAttribute('transform')
    const here = t ? (parseTransform(t) ?? IDENTITY) : IDENTITY
    const mat = name === 'svg' && el !== root ? m : multiply(m, here)
    if (el.getAttribute('clip-path') || el.getAttribute('mask')) note('clip path or mask (drawn unclipped)')
    if (el.getAttribute('filter')) note('filter (left out)')
    const opacity = Number(styleOf(el).opacity ?? el.getAttribute('opacity') ?? 1)
    if (opacity < 1) note('transparency (drawn opaque)')
    if (CONTAINERS.has(name)) {
      for (const child of Array.from(el.children)) walk(child, mat, paint)
      return
    }
    if (UNSUPPORTED[name]) return note(UNSUPPORTED[name])
    if (!SHAPES.has(name)) return
    if (paint.visibility === 'hidden') return
    const d = shapePath(el)
    if (!d) return
    let subs = toSubpaths(d)
    if (!subs.length) return
    subs = mapPoints(subs, (p) => applyMatrix(mat, p))
    const fill = colourOf(paint.fill, ids, note)
    const stroke = colourOf(paint.stroke, ids, note)
    // A line has no inside to fill.
    if (fill && name !== 'line') {
      const closed = subs.map((s) => ({ ...s, closed: true }))
      const nonzero = paint.fillRule === 'evenodd' ? toNonzero(closed) : closed
      paths.push({ d: serializePath(nonzero), fill })
    }
    const sw = Number.parseFloat(paint.strokeWidth)
    if (stroke && sw > 0) {
      const scale = Math.sqrt(Math.abs(mat[0] * mat[3] - mat[1] * mat[2]))
      paths.push({ d: serializePath(subs), fill: stroke, stroke: Math.round(sw * scale * 100) / 100 })
    }
  }
  walk(root, origin, inherit)

  const notes = [...counts].map(([what, n]) => (n > 1 ? `${n} × ${what}` : what))
  return { trace: { width: Math.round(width * 1000) / 1000, height: Math.round(height * 1000) / 1000, paths }, notes }
}

// ---- Style -----------------------------------------------------------------------

function styleOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {}
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
  }
  return out
}

function paintOf(el: Element, parent: Paint): Paint {
  const style = styleOf(el)
  const get = (name: string, prev: string) => {
    const v = style[name] ?? el.getAttribute(name)
    return v == null || v === 'inherit' ? prev : v.trim()
  }
  return {
    fill: get('fill', parent.fill),
    stroke: get('stroke', parent.stroke),
    strokeWidth: get('stroke-width', parent.strokeWidth),
    fillRule: get('fill-rule', parent.fillRule),
    display: style.display ?? el.getAttribute('display') ?? 'inline',
    visibility: get('visibility', parent.visibility),
  }
}

/** A paint as #rrggbb, a gradient or pattern as its first colour (noted), or null for none. */
function colourOf(paint: string, ids: Map<string, Element>, note: (what: string) => void): string | null {
  if (!paint || paint === 'none' || paint === 'transparent') return null
  const ref = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(paint)
  if (ref) {
    const target = ids.get(ref[1])
    const stop = target ? firstStop(target, ids) : null
    note(target?.localName === 'pattern' ? 'pattern (drawn in one colour)' : 'gradient (drawn in its first colour)')
    return stop ?? '#000000'
  }
  const hex = normalizeHexSafe(paint)
  if (!hex) note(`colour it couldn’t read (${paint.slice(0, 24)}), left out`)
  return hex
}

function firstStop(el: Element, ids: Map<string, Element>, depth = 0): string | null {
  const stop = el.getElementsByTagName('stop')[0]
  if (stop) return normalizeHexSafe(styleOf(stop)['stop-color'] ?? stop.getAttribute('stop-color') ?? 'black')
  // A gradient can borrow another's stops with href.
  const href = (el.getAttribute('href') ?? el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').replace(/^#/, '')
  const next = ids.get(href)
  return next && depth < 8 ? firstStop(next, ids, depth + 1) : null
}

// ---- Geometry ----------------------------------------------------------------------

const num = (el: Element, name: string) => {
  const v = Number.parseFloat(el.getAttribute(name) ?? '0')
  return Number.isFinite(v) ? v : 0
}
const K = 0.5522847498307936

/** A basic shape as path data, as the SVG spec defines it. */
function shapePath(el: Element): string | null {
  switch (el.localName) {
    case 'path':
      return el.getAttribute('d')
    case 'rect': {
      const x = num(el, 'x')
      const y = num(el, 'y')
      const w = num(el, 'width')
      const h = num(el, 'height')
      if (w <= 0 || h <= 0) return null
      let rx = el.hasAttribute('rx') ? num(el, 'rx') : num(el, 'ry')
      let ry = el.hasAttribute('ry') ? num(el, 'ry') : rx
      rx = Math.min(Math.max(0, rx), w / 2)
      ry = Math.min(Math.max(0, ry), h / 2)
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      const kx = rx * K
      const ky = ry * K
      return (
        `M${x + rx} ${y}H${x + w - rx}C${x + w - rx + kx} ${y} ${x + w} ${y + ry - ky} ${x + w} ${y + ry}` +
        `V${y + h - ry}C${x + w} ${y + h - ry + ky} ${x + w - rx + kx} ${y + h} ${x + w - rx} ${y + h}` +
        `H${x + rx}C${x + rx - kx} ${y + h} ${x} ${y + h - ry + ky} ${x} ${y + h - ry}` +
        `V${y + ry}C${x} ${y + ry - ky} ${x + rx - kx} ${y} ${x + rx} ${y}Z`
      )
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(el, 'cx')
      const cy = num(el, 'cy')
      const rx = el.localName === 'circle' ? num(el, 'r') : num(el, 'rx')
      const ry = el.localName === 'circle' ? rx : num(el, 'ry')
      if (rx <= 0 || ry <= 0) return null
      const kx = rx * K
      const ky = ry * K
      return (
        `M${cx + rx} ${cy}C${cx + rx} ${cy + ky} ${cx + kx} ${cy + ry} ${cx} ${cy + ry}` +
        `C${cx - kx} ${cy + ry} ${cx - rx} ${cy + ky} ${cx - rx} ${cy}` +
        `C${cx - rx} ${cy - ky} ${cx - kx} ${cy - ry} ${cx} ${cy - ry}` +
        `C${cx + kx} ${cy - ry} ${cx + rx} ${cy - ky} ${cx + rx} ${cy}Z`
      )
    }
    case 'line':
      return `M${num(el, 'x1')} ${num(el, 'y1')}L${num(el, 'x2')} ${num(el, 'y2')}`
    case 'polyline':
    case 'polygon': {
      const v = (el.getAttribute('points') ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
      if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return null
      let d = `M${v[0]} ${v[1]}`
      for (let i = 2; i + 1 < v.length; i += 2) d += `L${v[i]} ${v[i + 1]}`
      return el.localName === 'polygon' ? d + 'Z' : d
    }
  }
  return null
}

const applyMatrix = ([a, b, c, d, e, f]: Matrix, p: Pt): Pt => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f })

/** Path data to subpaths, arcs turned into cubics first (the path reader draws an arc as a line). */
function toSubpaths(d: string): Subpath[] {
  return parsePath(arcsToCubics(d))
}

const TOKEN = /[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g
const PARAMS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/**
 * Rewrite any arc commands as cubic curves, everything else untouched (as
 * absolute commands). Arc flags may be written run together ("a1 1 0 01.5.5"),
 * which the tokeniser splits correctly for every other number.
 */
export function arcsToCubics(d: string): string {
  if (!/[Aa]/.test(d)) return d
  const tokens = d.match(TOKEN) ?? []
  const out: string[] = []
  let cmd = ''
  let i = 0
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  const take = () => Number(tokens[i++])
  // Arc flags are single digits that may touch the next number: "011" is 0, 1, 1.
  const flag = () => {
    const t = tokens[i]
    if (t.length > 1 && (t[0] === '0' || t[0] === '1') && t[1] !== '.') {
      tokens[i] = t.slice(1)
      return Number(t[0])
    }
    i++
    return Number(t)
  }
  while (i < tokens.length) {
    if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++]
    else if (!cmd) break
    const up = cmd.toUpperCase()
    const rel = cmd !== up
    if (up === 'Z') {
      out.push('Z')
      cx = sx
      cy = sy
      if (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) i++ // stray number after Z
      continue
    }
    const n = PARAMS[up]
    // An arc's flags may share a token ("0110" is 0, 1, 10), so it can need fewer.
    if (i + (up === 'A' ? 5 : n) > tokens.length) break
    if (up === 'A') {
      const rx = take()
      const ry = take()
      const rot = take()
      const large = flag()
      const sweep = flag()
      let x = take()
      let y = take()
      if (![rx, ry, rot, large, sweep, x, y].every(Number.isFinite)) break
      if (rel) {
        x += cx
        y += cy
      }
      for (const c of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)) out.push(`C${c.join(' ')}`)
      cx = x
      cy = y
      continue
    }
    const v = tokens.slice(i, i + n).map(Number)
    i += n
    // Track the current point; pass the command on in absolute form.
    const abs = (k: number, ox: number, oy: number) => (rel ? v[k] + (k % 2 === 0 ? ox : oy) : v[k])
    if (up === 'H') {
      cx = rel ? cx + v[0] : v[0]
      out.push(`L${cx} ${cy}`)
    } else if (up === 'V') {
      cy = rel ? cy + v[0] : v[0]
      out.push(`L${cx} ${cy}`)
    } else {
      const pts = v.map((_, k) => abs(k, cx, cy))
      out.push(`${up}${pts.join(' ')}`)
      cx = pts[n - 2]
      cy = pts[n - 1]
      if (up === 'M') {
        sx = cx
        sy = cy
        cmd = rel ? 'l' : 'L' // later pairs after a moveto are linetos
      }
    }
  }
  return out.join('')
}

/** An SVG arc (endpoint form) as cubic Béziers, each at most 90°, per the SVG spec's appendix. */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, rotDeg: number, large: number, sweep: number, x2: number, y2: number): number[][] {
  if (x1 === x2 && y1 === y2) return []
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]]
  const phi = (rotDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x1 - x2) / 2
  const dy = (y1 - y2) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const sign = large === sweep ? -1 : 1
  const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const coef = sign * Math.sqrt(Math.max(0, num2 / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)))
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  const parts = Math.ceil(Math.abs(dt) / (Math.PI / 2))
  const step = dt / parts
  const k = (4 / 3) * Math.tan(step / 4)
  const point = (t: number) => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]
  const deriv = (t: number) => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos]
  const out: number[][] = []
  for (let p = 0; p < parts; p++) {
    const a = t1 + p * step
    const b = a + step
    const [ax, ay] = point(a)
    const [bx, by] = point(b)
    const [dax, day] = deriv(a)
    const [dbx, dby] = deriv(b)
    out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, p === parts - 1 ? x2 : bx, p === parts - 1 ? y2 : by])
  }
  return out
}

// ---- Even-odd to nonzero ------------------------------------------------------------

/**
 * Even-odd fill as nonzero: each subpath runs one way if it's nested an even
 * number of subpaths deep (an outline) and the other if odd (a hole). Exact
 * for subpaths that don't cross each other or themselves, which is what
 * even-odd icons nearly always are.
 */
function toNonzero(subs: Subpath[]): Subpath[] {
  const polys = subs.map(flatten)
  return subs.map((s, i) => {
    const probe = polys[i][0]
    if (!probe) return s
    let depth = 0
    polys.forEach((poly, j) => {
      if (j !== i && inside(poly, probe)) depth++
    })
    const area = signedArea(polys[i])
    const wantPositive = depth % 2 === 0
    return area > 0 === wantPositive ? s : reverseSub(s)
  })
}

function flatten(s: Subpath): Pt[] {
  const pts: Pt[] = []
  const n = s.nodes
  for (let i = 0; i < n.length; i++) {
    const a = n[i]
    const b = n[(i + 1) % n.length]
    const c1 = a.out ?? a
    const c2 = b.in ?? b
    for (let k = 0; k < 8; k++) {
      const t = k / 8
      const u = 1 - t
      pts.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y })
    }
  }
  return pts
}
const signedArea = (p: Pt[]) => p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0)
function inside(poly: Pt[], p: Pt) {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}
const reverseSub = (s: Subpath): Subpath => ({ closed: s.closed, nodes: [...s.nodes].reverse().map((n) => ({ x: n.x, y: n.y, in: n.out, out: n.in })) })

// ---- Colours -----------------------------------------------------------------------

/** The CSS colour names an SVG is likely to use; anything else is resolved by a canvas if there is one. */
const NAMES: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', orange: '#ffa500',
  purple: '#800080', gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', navy: '#000080', teal: '#008080',
  olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', fuchsia: '#ff00ff', magenta: '#ff00ff', brown: '#a52a2a',
  pink: '#ffc0cb', gold: '#ffd700', currentcolor: '#000000',
}

/** Any CSS colour as #rrggbb, or null. */
function normalizeHexSafe(value: string): string | null {
  const v = value.trim().toLowerCase()
  const hex = normalizeHex(v)
  if (hex) return hex
  if (NAMES[v]) return NAMES[v]
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(v)
  if (rgb) {
    const ch = (c: string) => Math.max(0, Math.min(255, Math.round(c.endsWith('%') ? (parseFloat(c) * 255) / 100 : parseFloat(c))))
    return '#' + [rgb[1], rgb[2], rgb[3]].map((c) => ch(c).toString(16).padStart(2, '0')).join('')
  }
  // Other names and functions (hsl(), rebeccapurple): a canvas knows them all.
  try {
    const ctx = new OffscreenCanvas(1, 1).getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#010203'
      ctx.fillStyle = v
      if (ctx.fillStyle !== '#010203' || v === '#010203') return normalizeHex(String(ctx.fillStyle))
    }
  } catch {
    // No canvas here (tests): unknown colours are left out below.
  }
  return null
}
