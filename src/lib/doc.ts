/**
 * The editable document: what the canvas shows and what gets exported.
 *
 * Two layers of edits sit on top of the trace:
 *  - Ink edits (recolour, remove) are a map keyed by the traced colour. They
 *    never touch geometry, so they survive re-tracing as long as the colour
 *    still comes out of the tracer, exactly as before the editor existed.
 *  - Geometry edits (mirror, node edits, deleting a shape) need paths of their
 *    own. The first one copies the trace into the edit state, "detaching" it;
 *    from then on a re-trace would throw that work away, so the app asks first.
 *
 * `Edits.doc` is null while attached, meaning "the current trace". Storing null
 * rather than a copy keeps undo honest across re-traces: undoing back to an
 * attached state shows the latest trace, not the one that was current when
 * the snapshot was taken.
 */
import { normalizeHex, type Trace } from './svg'
import { mapPoints, parsePath, serializePath, type Pt } from './pathdata'

export type DocPath = { id: string; d: string; fill: string }
export type Doc = { width: number; height: number; paths: DocPath[] }
export type InkEdits = { recolor: Record<string, string>; removed: string[] }
/**
 * `background` is a colour behind every shape, or null for transparent. Like
 * ink edits it never touches geometry, so it survives re-tracing; it only
 * shows where shapes are removed or a colour is deleted.
 */
export type Edits = { inks: InkEdits; doc: Doc | null; background: string | null }
export type Ink = { hex: string; count: number }

export const NO_INKS: InkEdits = { recolor: {}, removed: [] }
export const NO_EDITS: Edits = { inks: NO_INKS, doc: null, background: null }

const PATH_DATA = /^[\d\s,.eE+\-MmLlHhVvCcSsQqTtAaZz]*$/
const ID = /^[\w-]+$/

// Paths are immutable and shared between undo snapshots, so each one is
// checked once. Re-checking every path on every drag move cost ~75 ms a move
// on a 2,500-path trace.
const checked = new WeakMap<DocPath, boolean>()
function isSafe(p: DocPath) {
  let ok = checked.get(p)
  if (ok === undefined) {
    ok = !!p.d && typeof p.d === 'string' && PATH_DATA.test(p.d) && ID.test(p.id)
    checked.set(p, ok)
  }
  return ok
}

let nextId = 1
export const newId = () => `p${nextId++}`
/** After restoring a saved document, new ids must not reuse its ones. */
export function reserveIds(doc: Doc | null) {
  for (const p of doc?.paths ?? []) {
    const n = Number(p.id.slice(1))
    if (p.id.startsWith('p') && Number.isFinite(n) && n >= nextId) nextId = n + 1
  }
}

export function docFromTrace(trace: Trace): Doc {
  return {
    width: trace.width,
    height: trace.height,
    paths: trace.paths.map((p) => ({
      id: newId(),
      // Transforms are baked in so every edit works in one coordinate space.
      d: p.transform ? bakeTransform(p.d, p.transform) : p.d,
      fill: p.fill,
    })),
  }
}

/** The document an edit should start from: the detached copy, or the trace. */
export const docOf = (edits: Edits, traced: Doc) => edits.doc ?? traced

/** Distinct fills, most-used first. Keyed by the traced colour, not the shown one. */
export function inksOf(doc: { paths: { fill: string }[] }): Ink[] {
  const counts = new Map<string, number>()
  for (const p of doc.paths) counts.set(p.fill, (counts.get(p.fill) ?? 0) + 1)
  return [...counts].map(([hex, count]) => ({ hex, count })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
}

/** The colour a path is drawn in, or null when its ink has been removed. */
export function shownFill(inks: InkEdits, fill: string): string | null {
  if (inks.removed.includes(fill)) return null
  return normalizeHex(inks.recolor[fill] ?? '') ?? fill
}

/** Paths as drawn: removed inks dropped, recolours applied, anything malformed skipped. */
export function visiblePaths(doc: Doc, inks: InkEdits, only?: string) {
  const out: { id: string; d: string; fill: string }[] = []
  for (const p of doc.paths) {
    if (only && p.fill !== only) continue
    const fill = shownFill(inks, p.fill)
    // Edited `d` is ours, but it is still checked: this string becomes markup.
    if (!fill || !isSafe(p)) continue
    out.push({ id: p.id, d: p.d, fill })
  }
  return out
}

/**
 * The SVG to export. Nothing is drawn behind the paths unless a background is
 * set, so a removed colour leaves real transparency rather than a white box.
 */
export function buildSvg(doc: Doc, inks: InkEdits = NO_INKS, only?: string, background: string | null = null): string {
  const w = Number(doc.width) || 0
  const h = Number(doc.height) || 0
  const bg = background ? normalizeHex(background) : null
  const body = [
    // First, so it sits behind every shape.
    ...(bg ? [`<rect width="${w}" height="${h}" fill="${bg}"/>`] : []),
    ...visiblePaths(doc, inks, only).map((p) => `<path d="${p.d}" fill="${p.fill}"/>`),
  ].join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>\n`
}

/**
 * One SVG per remaining ink, each in the ink's (possibly recoloured) colour,
 * plus the background as layer 00 when there is one.
 */
export function layerFiles(doc: Doc, inks: InkEdits, baseName: string, background: string | null = null) {
  const bg = background ? normalizeHex(background) : null
  const files = inksOf(doc)
    .filter((ink) => !inks.removed.includes(ink.hex))
    .map((ink, i) => {
      const shown = shownFill(inks, ink.hex)!
      return {
        name: `${baseName}-${String(i + 1).padStart(2, '0')}-${shown.slice(1)}.svg`,
        svg: buildSvg(doc, inks, ink.hex),
      }
    })
  if (!bg) return files
  // The background alone: an only-filter no path matches, so just the rect.
  return [{ name: `${baseName}-00-background-${bg.slice(1)}.svg`, svg: buildSvg(doc, inks, '#background', bg) }, ...files]
}

// ---- Ink edits ------------------------------------------------------------

export function recolorInk(inks: InkEdits, hex: string, to: string | null): InkEdits {
  // Replacing with transparent is removing: one representation, one undo step.
  if (to === null) return removeInk(inks, hex)
  const next = normalizeHex(to)
  if (!next) return inks
  const recolor = { ...inks.recolor }
  if (next === hex) delete recolor[hex]
  else recolor[hex] = next
  return { recolor, removed: inks.removed.filter((h) => h !== hex) }
}

export const removeInk = (inks: InkEdits, hex: string): InkEdits =>
  inks.removed.includes(hex) ? inks : { ...inks, removed: [...inks.removed, hex] }

export const restoreInk = (inks: InkEdits, hex: string): InkEdits => {
  const recolor = { ...inks.recolor }
  delete recolor[hex]
  return { recolor, removed: inks.removed.filter((h) => h !== hex) }
}

// ---- Geometry edits ---------------------------------------------------------

export const replacePath = (doc: Doc, id: string, d: string): Doc => ({
  ...doc,
  paths: doc.paths.map((p) => (p.id === id ? { ...p, d } : p)),
})

export const deletePath = (doc: Doc, id: string): Doc => ({ ...doc, paths: doc.paths.filter((p) => p.id !== id) })

// ---- Transforms -------------------------------------------------------------

type Matrix = [number, number, number, number, number, number]

/**
 * VTracer 1.0 does not emit transforms, but older builds wrote
 * `translate(x,y)` on every path and parseTrace accepts them, so they are
 * resolved here rather than silently mis-edited later.
 */
export function bakeTransform(d: string, transform: string): string {
  const m = parseTransform(transform)
  if (!m) return d
  const [a, b, c, dd, e, f] = m
  const apply = (p: Pt) => ({ x: a * p.x + c * p.y + e, y: b * p.x + dd * p.y + f })
  return serializePath(mapPoints(parsePath(d), apply))
}

function parseTransform(t: string): Matrix | null {
  let m: Matrix = [1, 0, 0, 1, 0, 0]
  const re = /(\w+)\s*\(([^)]*)\)/g
  let hit = false
  for (const [, fn, args] of t.matchAll(re)) {
    hit = true
    const v = args.split(/[\s,]+/).filter(Boolean).map(Number)
    let n: Matrix
    if (fn === 'translate') n = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]
    else if (fn === 'scale') n = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]
    else if (fn === 'matrix' && v.length === 6) n = v as Matrix
    else if (fn === 'rotate') {
      const r = ((v[0] ?? 0) * Math.PI) / 180
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0]
      const cos = Math.cos(r)
      const sin = Math.sin(r)
      n = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy]
    } else return null
    if (n.some((x) => !Number.isFinite(x))) return null
    m = multiply(m, n)
  }
  return hit ? m : null
}

const multiply = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix => [
  a * A + c * B,
  b * A + d * B,
  a * C + c * D,
  b * C + d * D,
  a * E + c * F + e,
  b * E + d * F + f,
]
