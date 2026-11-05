/**
 * Boolean ops on the selection (#207): Unite, Subtract (the front shapes from
 * the back one), Intersect and Divide, the commonest trace fixes (fold a speck
 * into its neighbour, cut a shape out of the background, join two halves).
 *
 * The booleans are paper.js's, lazy-loaded like Mirror's (src/lib/paper.ts)
 * and passed in so the tests can load it under jsdom. Every result goes back
 * through our own path writer, so it uses the same absolute M/L/C/Z form as
 * node edits. Doc paths are nonzero-filled (an imported even-odd SVG is
 * rewritten so), which is paper's default.
 *
 * Paint order is the doc's order: the first selected path is the back one.
 * Unite, Subtract and Intersect leave one path in the back shape's place,
 * with its colour, gradient and group; Divide cuts the selection into pieces
 * that don't overlap, each in the colour of the topmost shape over it.
 */
import type PaperNS from 'paper/dist/paper-core'
import { newId, type Doc, type DocPath } from './doc'
import { isEmpty, scopeFor } from './mirror'
import { parsePath, serializePath } from './pathdata'

type Paper = typeof PaperNS
type Item = InstanceType<Paper['PathItem']>

export type BooleanOp = 'unite' | 'subtract' | 'intersect' | 'divide'

/** The doc after the op, and the ids to select; or why it couldn't be done (the doc is then unchanged). */
export type BooleanResult = { doc: Doc; selected: string[] } | { error: string }

const write = (item: Item) => (isEmpty(item) ? '' : serializePath(parsePath(item.pathData)))

export function booleanOp(paper: Paper, doc: Doc, ids: string[], op: BooleanOp): BooleanResult {
  const chosen = new Set(ids)
  const sel = doc.paths.filter((p) => chosen.has(p.id))
  if (sel.length < 2) return { error: 'Select two or more shapes.' }
  // The booleans work on filled areas; a stroke is a line, with no inside.
  if (sel.some((p) => p.stroke)) return { error: 'Lines can’t be combined: select filled shapes only.' }
  const s = scopeFor(paper)
  const items = sel.map((p) => new s.CompoundPath({ pathData: p.d, insert: false }) as Item)
  const back = sel[0]
  const unionOf = (list: Item[]) => list.reduce((a, b) => a.unite(b, { insert: false }) as Item)

  /** The selection replaced by `out`, placed where the back shape was. */
  const replaced = (out: DocPath[]) => {
    const at = doc.paths.findIndex((p) => p.id === back.id)
    const rest = doc.paths.filter((p) => !chosen.has(p.id))
    // Paths before the back shape that aren't selected stay before it.
    const before = doc.paths.slice(0, at).filter((p) => !chosen.has(p.id)).length
    return { doc: { ...doc, paths: [...rest.slice(0, before), ...out, ...rest.slice(before)] }, selected: out.map((p) => p.id) }
  }

  if (op === 'divide') return divide(items, sel, replaced)

  const result = op === 'unite' ? unionOf(items) : op === 'subtract' ? (items[0].subtract(unionOf(items.slice(1)), { insert: false }) as Item) : items.reduce((a, b) => a.intersect(b, { insert: false }) as Item)
  const d = write(result)
  if (!d) return { error: op === 'intersect' ? 'These shapes don’t overlap, so there’s nothing in common to keep.' : 'Nothing would be left of the back shape.' }
  return replaced([{ ...back, d }])
}

/**
 * Divide: every region where a different set of the shapes overlaps becomes a
 * piece of its own, in the topmost shape's colour there. Built front to back:
 * each shape's visible part (what the shapes in front leave), cut by every
 * shape behind it, so a piece doesn't cross another shape's edge.
 */
function divide(items: Item[], sel: DocPath[], replaced: (out: DocPath[]) => BooleanResult): BooleanResult {
  const out: DocPath[] = []
  for (let i = 0; i < items.length; i++) {
    const above = items.slice(i + 1)
    let pieces: Item[] = [above.length ? (items[i].subtract(above.reduce((a, b) => a.unite(b, { insert: false }) as Item), { insert: false }) as Item) : items[i]]
    for (let j = 0; j < i; j++) {
      const next: Item[] = []
      for (const piece of pieces) {
        const inside = piece.intersect(items[j], { insert: false }) as Item
        const outside = piece.subtract(items[j], { insert: false }) as Item
        for (const part of [inside, outside]) if (!isEmpty(part)) next.push(part)
      }
      pieces = next
    }
    for (const piece of pieces) {
      const d = write(piece)
      if (!d) continue
      // The first piece of each shape keeps its id, so a selection or undo step can still name it.
      const first = !out.some((p) => p.id === sel[i].id)
      out.push({ ...sel[i], id: first ? sel[i].id : newId(), d })
    }
  }
  if (!out.length) return { error: 'Nothing to divide.' }
  // Built back to front, so already in paint order.
  return replaced(out)
}
