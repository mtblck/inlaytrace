/**
 * Everything the app does to a trace after VTracer returns it.
 *
 * The raw trace is parsed once into a flat list of paths. Ink edits (recolour,
 * hide) are applied by rebuilding the document from that list rather than by
 * patching the string, which keeps edits independent of one another and makes
 * "reset" free. Paths keep their original order: in stacked mode a path is
 * painted over by the ones after it, so reordering (for example by grouping per
 * colour) would visibly change the picture.
 *
 * Nothing from the trace is trusted into markup unchecked. `d` and `fill` are
 * validated against what VTracer actually emits, so the inline preview cannot
 * become an injection point even if the engine misbehaves.
 */

export type TracedPath = { d: string; fill: string; transform?: string }
export type Trace = { width: number; height: number; paths: TracedPath[] }
export type Ink = { hex: string; count: number }
export type InkEdits = { recolor: Record<string, string>; hidden: string[] }

const HEX = /^#[0-9a-f]{6}$/
const PATH_DATA = /^[\d\s,.eE+\-MmLlHhVvCcSsQqTtAaZz]*$/
const TRANSFORM = /^[\w\s(),.+\-]*$/

export const NO_EDITS: InkEdits = { recolor: {}, hidden: [] }

export function parseTrace(raw: string): Trace {
  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg') throw new Error('The tracer returned something that is not an SVG.')
  const width = Number(root.getAttribute('width'))
  const height = Number(root.getAttribute('height'))
  const paths: TracedPath[] = []
  for (const el of Array.from(root.getElementsByTagName('path'))) {
    const d = el.getAttribute('d') ?? ''
    const fill = normalizeHex(el.getAttribute('fill') ?? '')
    const transform = el.getAttribute('transform') ?? undefined
    if (!d || !PATH_DATA.test(d) || !fill) continue
    if (transform && !TRANSFORM.test(transform)) continue
    paths.push(transform ? { d, fill, transform } : { d, fill })
  }
  return { width, height, paths }
}

export function normalizeHex(value: string): string | null {
  let v = value.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return HEX.test(v) ? v : null
}

/** Distinct fills, most-used first. */
export function inksOf(trace: Trace): Ink[] {
  const counts = new Map<string, number>()
  for (const p of trace.paths) counts.set(p.fill, (counts.get(p.fill) ?? 0) + 1)
  return [...counts].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
}

export function buildSvg(trace: Trace, edits: InkEdits = NO_EDITS, only?: string): string {
  const hidden = new Set(edits.hidden)
  const body = trace.paths
    .filter((p) => (only ? p.fill === only : !hidden.has(p.fill)))
    .map((p) => {
      const fill = normalizeHex(edits.recolor[p.fill] ?? '') ?? p.fill
      const t = p.transform ? ` transform="${p.transform}"` : ''
      return `<path d="${p.d}" fill="${fill}"${t}/>`
    })
    .join('\n')
  const { width: w, height: h } = trace
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>\n`
}

/** One SVG per ink, each in the ink's (possibly recoloured) colour. */
export function layerFiles(trace: Trace, edits: InkEdits, baseName: string) {
  const hidden = new Set(edits.hidden)
  return inksOf(trace)
    .filter((ink) => !hidden.has(ink.hex))
    .map((ink, i) => {
      const shown = normalizeHex(edits.recolor[ink.hex] ?? '') ?? ink.hex
      return {
        name: `${baseName}-${String(i + 1).padStart(2, '0')}-${shown.slice(1)}.svg`,
        svg: buildSvg(trace, edits, ink.hex),
      }
    })
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
