/**
 * Reading the tracer's output, and measuring what gets exported. Paths are
 * filled shapes, or (centerline) strokes: the colour is `fill` either way, so
 * colour edits work the same on both.
 *
 * The raw trace is parsed once into a flat list of paths, which src/lib/doc.ts
 * turns into the editable document. Paths keep their original order: in
 * stacked mode a path is painted over by the ones after it, so reordering (for
 * example by grouping per colour) would visibly change the picture.
 *
 * Nothing from the trace is trusted into markup unchecked. `d` and `fill` are
 * validated against what the tracer actually emits, so the inline preview cannot
 * become an injection point even if the engine misbehaves. A gradient is read
 * into numbers and colours (checkGradient), never copied as markup.
 */
import type { Gradient as TracedGradient } from 'inlaytrace'

/**
 * A gradient fill, in the drawing's pixels. `transform` (SVG's matrix(a b c d e
 * f)) is how the shape has been moved, scaled or turned since it was traced, so
 * the gradient goes with it.
 */
export type Gradient = TracedGradient & { transform?: [number, number, number, number, number, number] }

/**
 * A traced path: filled with `fill`, or, when `stroke` (a width in px) is set,
 * stroked in that colour and not filled. With `gradient`, filled with that,
 * and `fill` is its average colour: the ink it belongs to, and what anything
 * that can't draw a gradient draws.
 */
export type TracedPath = { d: string; fill: string; stroke?: number; transform?: string; gradient?: Gradient }
export type Trace = { width: number; height: number; paths: TracedPath[] }

const HEX = /^#[0-9a-f]{6}$/
const PATH_DATA = /^[\d\s,.eE+\-MmLlHhVvCcSsQqTtAaZz]*$/
const TRANSFORM = /^[\w\s(),.+\-]*$/

export function parseTrace(raw: string): Trace {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg') throw new Error('The tracer returned something that is not an SVG.')
  const width = Number(root.getAttribute('width'))
  const height = Number(root.getAttribute('height'))
  const gradients = new Map<string, Gradient>()
  for (const el of Array.from(root.querySelectorAll('linearGradient, radialGradient'))) {
    const g = readGradient(el)
    if (g && el.id) gradients.set(el.id, g)
  }
  const paths: TracedPath[] = []
  for (const el of Array.from(root.getElementsByTagName('path'))) {
    const d = el.getAttribute('d') ?? ''
    // A centerline stroke: fill="none", the colour in stroke, and a width.
    const width = Number(el.getAttribute('stroke-width'))
    const stroked = el.getAttribute('fill') === 'none' && Number.isFinite(width) && width > 0
    const paint = (el.getAttribute(stroked ? 'stroke' : 'fill') ?? '').trim()
    // A gradient: url(#id), then the flat colour as its fallback.
    const url = stroked ? null : /^url\(#([\w-]+)\)\s*(\S*)$/.exec(paint)
    const gradient = url ? gradients.get(url[1]) : undefined
    const fill = normalizeHex(url ? url[2] : paint) ?? (gradient ? meanOf(gradient) : null)
    const transform = el.getAttribute('transform') ?? undefined
    if (!d || !PATH_DATA.test(d) || !fill) continue
    if (transform && !TRANSFORM.test(transform)) continue
    paths.push({ d, fill, ...(stroked ? { stroke: Math.min(width, 1000) } : {}), ...(transform ? { transform } : {}), ...(gradient ? { gradient } : {}) })
  }
  return { width, height, paths }
}

/** A gradient element as Inlay writes it (userSpaceOnUse, no transform), or null. */
function readGradient(el: Element): Gradient | null {
  if (el.getAttribute('gradientUnits') !== 'userSpaceOnUse') return null
  const n = (name: string) => Number(el.getAttribute(name))
  const stops = Array.from(el.getElementsByTagName('stop')).map((s) => {
    const o = (s.getAttribute('offset') ?? '').trim()
    return { offset: o.endsWith('%') ? Number(o.slice(0, -1)) / 100 : Number(o), color: normalizeHex(s.getAttribute('stop-color') ?? '') ?? '' }
  })
  const g: Gradient =
    el.localName === 'linearGradient' ? { type: 'linear', x1: n('x1'), y1: n('y1'), x2: n('x2'), y2: n('y2'), stops } : { type: 'radial', cx: n('cx'), cy: n('cy'), r: n('r'), stops }
  return checkGradient(g)
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A gradient with every number finite and every colour a hex, copied field by field; null if anything is off. */
export function checkGradient(x: unknown): Gradient | null {
  if (!x || typeof x !== 'object') return null
  const g = x as Record<string, unknown>
  if (!Array.isArray(g.stops) || g.stops.length < 1 || g.stops.length > 16) return null
  const stops: Gradient['stops'] = []
  for (const s of g.stops as unknown[]) {
    const st = s as Record<string, unknown> | null
    const color = typeof st?.color === 'string' ? normalizeHex(st.color) : null
    if (!st || !finite(st.offset) || !color) return null
    stops.push({ offset: Math.min(1, Math.max(0, st.offset)), color })
  }
  const t = g.transform
  const transform = t === undefined ? undefined : Array.isArray(t) && t.length === 6 && t.every(finite) ? (t as Gradient['transform']) : null
  if (transform === null) return null
  const extra = transform ? { transform } : {}
  if (g.type === 'linear' && [g.x1, g.y1, g.x2, g.y2].every(finite)) return { type: 'linear', x1: g.x1 as number, y1: g.y1 as number, x2: g.x2 as number, y2: g.y2 as number, stops, ...extra }
  if (g.type === 'radial' && [g.cx, g.cy, g.r].every(finite) && (g.r as number) > 0) return { type: 'radial', cx: g.cx as number, cy: g.cy as number, r: g.r as number, stops, ...extra }
  return null
}

/** The stops' average colour: a fill for a gradient that came without one. */
function meanOf(g: Gradient): string {
  const c = [1, 3, 5].map((i) => Math.round(g.stops.reduce((s, st) => s + parseInt(st.color.slice(i, i + 2), 16), 0) / g.stops.length))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

const num = (v: number) => String(Math.round(v * 1000) / 1000)

/** A gradient as an element with this id: built from checked numbers and colours only. */
export function gradientMarkup(g: Gradient, id: string): string {
  const stops = g.stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${s.color}"/>`).join('')
  const transform = g.transform ? ` gradientTransform="matrix(${g.transform.map(num).join(' ')})"` : ''
  return g.type === 'linear'
    ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(g.x1)}" y1="${num(g.y1)}" x2="${num(g.x2)}" y2="${num(g.y2)}"${transform}>${stops}</linearGradient>`
    : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(g.cx)}" cy="${num(g.cy)}" r="${num(g.r)}"${transform}>${stops}</radialGradient>`
}

export function normalizeHex(value: string): string | null {
  let v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return HEX.test(v) ? v : null
}

export type Stats = { paths: number; nodes: number; bytes: number }

export function statsOf(svg: string): Stats {
  let paths = 0
  let nodes = 0
  for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]*)"/g)) {
    paths++
    nodes += (m[1].match(/[MLHVCSQTAZ]/gi) ?? []).length
  }
  return { paths, nodes, bytes: new TextEncoder().encode(svg).length }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
