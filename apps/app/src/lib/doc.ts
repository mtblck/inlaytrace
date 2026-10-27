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
import { checkGradient, gradientMarkup, moveGradient, normalizeHex, type Gradient, type Trace } from './svg'
import { mapPoints, parsePath, serializePath, type Pt } from './pathdata'

/**
 * `fill` is the path's colour; with `stroke` (a width in px) the path is
 * stroked in it, not filled. With `gradient`, the path is filled with that
 * instead, and `fill` (its average colour) is the ink it belongs to: recolouring
 * that ink fills it flat. Paths with the same `group` are one group: they
 * select together, sit next to each other in paint order, and export as a <g>.
 */
export type DocPath = { id: string; d: string; fill: string; stroke?: number; group?: string; gradient?: Gradient }
/** A path as drawn, its colour resolved. */
export type ShownPath = DocPath
export type Doc = { width: number; height: number; paths: DocPath[] }
export type InkEdits = { recolor: Record<string, string>; removed: string[] }
/**
 * `background` is a colour behind every shape, or null for transparent. Like
 * ink edits it never touches geometry, so it survives re-tracing; it only
 * shows where shapes are removed or a colour is deleted.
 */
export type Edits = { inks: InkEdits; doc: Doc | null; background: string | null }
/** `shaded`: every shape in it has a gradient, so its colour is an average, not one the tracer can merge. */
export type Ink = { hex: string; count: number; shaded?: boolean }

export const NO_INKS: InkEdits = { recolor: {}, removed: [] }
export const NO_EDITS: Edits = { inks: NO_INKS, doc: null, background: null }

const PATH_DATA = /^[\d\s,.eE+\-MmLlHhVvCcSsQqTtAaZz]*$/
const ID = /^[\w-]+$/

// Gradients are checked once each too, and only the checked copy is drawn.
const checkedGradients = new WeakMap<Gradient, Gradient | null>()
function safeGradient(g: Gradient) {
  let ok = checkedGradients.get(g)
  if (ok === undefined) {
    ok = checkGradient(g)
    checkedGradients.set(g, ok)
  }
  return ok
}

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
      ...(p.stroke ? { stroke: p.stroke } : {}),
      ...(p.gradient ? { gradient: p.transform ? moveGradient(p.gradient, parseTransform(p.transform)) : p.gradient } : {}),
    })),
  }
}

/** The document an edit should start from: the detached copy, or the trace. */
export const docOf = (edits: Edits, traced: Doc) => edits.doc ?? traced

/** Distinct fills, most-used first. Keyed by the traced colour, not the shown one. */
export function inksOf(doc: { paths: { fill: string; gradient?: Gradient }[] }): Ink[] {
  const counts = new Map<string, number>()
  const flat = new Set<string>()
  for (const p of doc.paths) {
    counts.set(p.fill, (counts.get(p.fill) ?? 0) + 1)
    if (!p.gradient) flat.add(p.fill)
  }
  return [...counts]
    .map(([hex, count]) => ({ hex, count, ...(flat.has(hex) ? {} : { shaded: true }) }))
    .sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex))
}

/** The colour a path is drawn in, or null when its ink has been removed. */
export function shownFill(inks: InkEdits, fill: string): string | null {
  if (inks.removed.includes(fill)) return null
  return normalizeHex(inks.recolor[fill] ?? '') ?? fill
}

/** Paths as drawn: removed inks dropped, recolours applied, anything malformed skipped. */
export function visiblePaths(doc: Doc, inks: InkEdits, only?: string) {
  const out: ShownPath[] = []
  for (const p of doc.paths) {
    if (only && p.fill !== only) continue
    const fill = shownFill(inks, p.fill)
    // Edited `d` is ours, but it is still checked: this string becomes markup.
    if (!fill || !isSafe(p)) continue
    // A recoloured ink is drawn flat in its new colour, gradient or not.
    const gradient = p.gradient && !validStroke(p.stroke) && !inks.recolor[p.fill] ? safeGradient(p.gradient) : null
    out.push({
      id: p.id,
      d: p.d,
      fill,
      ...(validStroke(p.stroke) ? { stroke: p.stroke } : {}),
      ...(p.group && GROUP.test(p.group) ? { group: p.group } : {}),
      ...(gradient ? { gradient } : {}),
    })
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
  const paths = visiblePaths(doc, inks, only)
  const defs = paths.flatMap((p) => (p.gradient ? [gradientMarkup(p.gradient, gradientId(p.id))] : []))
  const body = [
    ...(defs.length ? ['<defs>', ...defs, '</defs>'] : []),
    // First, so it sits behind every shape.
    ...(bg ? [`<rect width="${w}" height="${h}" fill="${bg}"/>`] : []),
    ...grouped(paths),
  ].join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>\n`
}

/** The id of a path's gradient in the exported SVG. */
const gradientId = (pathId: string) => `gr-${pathId}`

/** Paths as markup, each run of one group's paths wrapped in a <g>. */
function grouped(paths: ShownPath[]) {
  const out: string[] = []
  for (let i = 0; i < paths.length; ) {
    const g = paths[i].group
    let j = i + 1
    if (g) while (j < paths.length && paths[j].group === g) j++
    const run = paths.slice(i, j).map(pathMarkup)
    // A group left with one member (the rest deleted) is just that path.
    out.push(...(run.length > 1 ? [`<g id="${g}">`, ...run.map((m) => `  ${m}`), '</g>'] : run))
    i = j
  }
  return out
}

const GROUP = /^g\d+$/
const validStroke = (s: unknown): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0

/** One path as markup: filled (with its gradient, its colour the fallback), or a round-capped stroke in its colour. */
export function pathMarkup(p: { id?: string; d: string; fill: string; stroke?: number; gradient?: Gradient }) {
  if (p.stroke) return `<path d="${p.d}" fill="none" stroke="${p.fill}" stroke-width="${Math.round(p.stroke * 100) / 100}" stroke-linecap="round" stroke-linejoin="round"/>`
  return p.gradient && p.id ? `<path d="${p.d}" fill="url(#${gradientId(p.id)}) ${p.fill}"/>` : `<path d="${p.d}" fill="${p.fill}"/>`
}

/** Whether a document draws strokes (centerline) rather than filled shapes. */
export const hasStrokes = (doc: Doc) => doc.paths.some((p) => p.stroke)

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

export type Matrix = [number, number, number, number, number, number]

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

export function parseTransform(t: string): Matrix | null {
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
    else if (fn === 'skewX') n = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0]
    else if (fn === 'skewY') n = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0]
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

export const multiply = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix => [
  a * A + c * B,
  b * A + d * B,
  a * C + c * D,
  b * C + d * D,
  a * E + c * F + e,
  b * E + d * F + f,
]

// ---- Groups and paint order -------------------------------------------------

let nextGroup = 1
/** After restoring a document, new group ids must not reuse its ones. */
export function reserveGroups(doc: Doc | null) {
  for (const p of doc?.paths ?? []) {
    const n = Number(p.group?.slice(1))
    if (p.group && Number.isFinite(n) && n >= nextGroup) nextGroup = n + 1
  }
}

/** The ids, plus every other member of any group one of them is in. */
export function withGroups(doc: Doc, ids: string[]): string[] {
  const groups = new Set(doc.paths.filter((p) => p.group && ids.includes(p.id)).map((p) => p.group))
  if (!groups.size) return ids
  const out = [...ids]
  for (const p of doc.paths) if (p.group && groups.has(p.group) && !out.includes(p.id)) out.push(p.id)
  return out
}

/**
 * Group the paths (and the groups they're in) as one group. Members move
 * together to where the topmost of them was painted, in their own order, so
 * grouping only changes the picture where a member was between two others.
 */
export function groupPaths(doc: Doc, ids: string[]): Doc {
  const all = new Set(withGroups(doc, ids))
  if (all.size < 2) return doc
  const group = `g${nextGroup++}`
  const members = doc.paths.filter((p) => all.has(p.id)).map((p) => ({ ...p, group }))
  const top = doc.paths.reduce((last, p, i) => (all.has(p.id) ? i : last), -1)
  const before = doc.paths.slice(0, top + 1).filter((p) => !all.has(p.id))
  const after = doc.paths.slice(top + 1)
  return { ...doc, paths: [...before, ...members, ...after] }
}

/** Ungroup every group the paths are in. */
export function ungroupPaths(doc: Doc, ids: string[]): Doc {
  const groups = new Set(doc.paths.filter((p) => p.group && ids.includes(p.id)).map((p) => p.group))
  if (!groups.size) return doc
  return {
    ...doc,
    paths: doc.paths.map((p) => {
      if (!p.group || !groups.has(p.group)) return p
      const { group: _, ...rest } = p
      return rest
    }),
  }
}

export type Arrange = 'forward' | 'backward' | 'front' | 'back'

/**
 * Change the paint order of the paths (whole groups, since a group's members
 * stay together). Forward and backward move each past one neighbour (a path,
 * or a whole group); front and back move them to the top or bottom, keeping
 * their order among themselves.
 */
export function arrange(doc: Doc, ids: string[], how: Arrange): Doc {
  const picked = new Set(withGroups(doc, ids))
  if (!picked.size) return doc
  // Units: a group's run of paths, or a single path.
  const units: DocPath[][] = []
  for (const p of doc.paths) {
    const last = units[units.length - 1]
    if (p.group && last && last[0].group === p.group) last.push(p)
    else units.push([p])
  }
  const sel = (u: DocPath[]) => picked.has(u[0].id)
  let out: DocPath[][]
  if (how === 'front' || how === 'back') {
    const mine = units.filter(sel)
    const rest = units.filter((u) => !sel(u))
    out = how === 'front' ? [...rest, ...mine] : [...mine, ...rest]
  } else {
    out = [...units]
    // Walk against the direction of travel so a run of selected units moves as one.
    const order = how === 'forward' ? [...out.keys()].reverse() : [...out.keys()]
    for (const i of order) {
      const j = how === 'forward' ? i + 1 : i - 1
      if (j < 0 || j >= out.length || !sel(out[i]) || sel(out[j])) continue
      ;[out[i], out[j]] = [out[j], out[i]]
    }
  }
  return { ...doc, paths: out.flat() }
}
