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
 * become an injection point even if the engine misbehaves.
 */

/** A traced path: filled with `fill`, or, when `stroke` (a width in px) is set, stroked in that colour and not filled. */
export type TracedPath = { d: string; fill: string; stroke?: number; transform?: string }
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
  const paths: TracedPath[] = []
  for (const el of Array.from(root.getElementsByTagName('path'))) {
    const d = el.getAttribute('d') ?? ''
    // A centerline stroke: fill="none", the colour in stroke, and a width.
    const width = Number(el.getAttribute('stroke-width'))
    const stroked = el.getAttribute('fill') === 'none' && Number.isFinite(width) && width > 0
    const fill = normalizeHex(el.getAttribute(stroked ? 'stroke' : 'fill') ?? '')
    const transform = el.getAttribute('transform') ?? undefined
    if (!d || !PATH_DATA.test(d) || !fill) continue
    if (transform && !TRANSFORM.test(transform)) continue
    paths.push({ d, fill, ...(stroked ? { stroke: Math.min(width, 1000) } : {}), ...(transform ? { transform } : {}) })
  }
  return { width, height, paths }
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
