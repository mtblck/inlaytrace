/**
 * Recognise text, after OCR: pick the closest of our fonts for each block of
 * text and redraw its words as outlined glyphs, so text comes out as type
 * rather than traced blobs.
 *
 * OCR has already said what the letters are, so instead of classifying the
 * font cold, every candidate draws the same words, scaled onto the word's
 * ink, and the one whose ink overlaps best wins (soft IoU). The same pass
 * gives the size and the position. On 60 images of known fonts, against all
 * the bundled styles, this picked the right family 56 times and the weight 54,
 * with sizes within about 1%. On shrunk JPEGs (a 70-family trial) it held at
 * 18 px and up, 31 of 36, but got under half right below that. A block that matches no font well enough stays
 * traced, which also screens out OCR's misreads of artwork.
 *
 * Pure (no DOM): the AI worker runs it, and tests run it in Node.
 */
import type { Font, PathCommand } from 'opentype.js'
import { rasterize } from './raster'

export type Box = { x0: number; y0: number; x1: number; y1: number }
export type OcrWord = { text: string; conf: number; box: Box }
export type OcrLine = { words: OcrWord[] }
export type FontStyle = { id: string; family: string; weight: number; font: Font }
/** One line of recognised text, outlined. Coordinates are the image's pixels. */
export type TextRun = {
  text: string
  family: string
  weight: number
  /** Font size in pixels. */
  size: number
  fill: string
  /** The glyph outlines, one subpath per contour. */
  d: string
  /** How well the font's ink matched the image's, 0–1. */
  score: number
  /** The words' boxes, which paintOut fills with their background. */
  boxes: (Box & { bg: [number, number, number, number] })[]
}

/** Words OCR read with less confidence than this (0–100) are left to the tracer. */
const MIN_CONFIDENCE = 30
/** A block whose best font overlaps the image's ink less than this stays traced. */
export const MIN_SCORE = 0.5
/** Words are compared at most this tall: bigger only costs time. */
const MAX_HEIGHT = 40
/** Words this short (in compared pixels) say too little about the font to judge it. */
const MIN_HEIGHT = 6
/** Words per block the font is judged on (the longest). */
const JUDGED_WORDS = 4
/** Fonts kept after the first, quick pass, for the finer second one. */
const SHORTLIST = 30
/** A font whose letters' proportions are off by more than this (log ratio) isn't drawn at all. */
const ASPECT_SLACK = 0.15
/** Scale nudges tried around the ink-box fit in the second pass. */
const NUDGES = [0.96, 0.98, 1, 1.02, 1.04]
/** Sideways shifts (compared pixels) tried for each word at its line's size: its ink box can miss a faint end. */
const SLIDES = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]

/**
 * Tesseract's TSV output as lines of words. Columns: level, page, block,
 * paragraph, line, word, left, top, width, height, confidence, text; level 5
 * rows are words.
 */
export function linesFromTsv(tsv: string, scale = 1): OcrLine[] {
  const lines = new Map<string, OcrLine>()
  for (const row of tsv.split('\n')) {
    const c = row.split('\t')
    if (c[0] !== '5' || c.length < 12) continue
    const text = c.slice(11).join('\t').trim()
    const conf = Number(c[10])
    if (!text || conf < MIN_CONFIDENCE || !/[A-Za-z0-9]/.test(text)) continue
    const [left, top, w, h] = c.slice(6, 10).map(Number)
    const key = c.slice(1, 5).join('.')
    if (!lines.has(key)) lines.set(key, { words: [] })
    lines.get(key)!.words.push({
      text,
      conf,
      box: { x0: Math.floor(left / scale), y0: Math.floor(top / scale), x1: Math.ceil((left + w) / scale), y1: Math.ceil((top + h) / scale) },
    })
  }
  return [...lines.values()]
}

type Rgba = [number, number, number, number]

/** A word measured off the image, at compared size (`k` image pixels a pixel). */
type Measured = OcrWord & {
  /** The word's box with a margin, in image pixels: what gets painted out. */
  crop: Box
  x: number
  y: number
  w: number
  h: number
  k: number
  cover: Float32Array
  ink: Box
  area: number
  colour: [number, number, number]
  bg: Rgba
  /** The background around the word is one colour, so painting the word out leaves no mark. */
  flat: boolean
}

/** Over white, so transparent pixels read as paper rather than black. */
function rgbAt(rgba: ArrayLike<number>, i: number): [number, number, number] {
  const a = rgba[i + 3] / 255
  return [rgba[i] * a + 255 * (1 - a), rgba[i + 1] * a + 255 * (1 - a), rgba[i + 2] * a + 255 * (1 - a)]
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The offsets into RGBA of a box's border pixels. */
function edge(width: number, b: Box) {
  const out: number[] = []
  for (let x = b.x0; x < b.x1; x++) out.push((b.y0 * width + x) * 4, ((b.y1 - 1) * width + x) * 4)
  for (let y = b.y0 + 1; y < b.y1 - 1; y++) out.push((y * width + b.x0) * 4, (y * width + b.x1 - 1) * 4)
  return out
}

/** The median colour, alpha included, of a box's border. */
function edgeColour(rgba: ArrayLike<number>, width: number, height: number, b: Box): Rgba {
  const ring = edge(width, { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(width, b.x1), y1: Math.min(height, b.y1) })
  return [0, 1, 2, 3].map((c) => median(ring.map((i) => rgba[i + c]))) as Rgba
}

function measure(rgba: ArrayLike<number>, width: number, height: number, word: OcrWord): Measured | null {
  const pad = Math.max(2, Math.round((word.box.y1 - word.box.y0) * 0.08))
  const x = Math.max(0, word.box.x0 - pad)
  const y = Math.max(0, word.box.y0 - pad)
  const W = Math.min(width, word.box.x1 + pad) - x
  const H = Math.min(height, word.box.y1 + pad) - y
  if (W < 3 || H < 3) return null
  // The background: the median of the box's edge.
  const ring = edge(width, { x0: x, y0: y, x1: x + W, y1: y + H })
  const ringRgb = ring.map((i) => rgbAt(rgba, i))
  const bgRgb = [0, 1, 2].map((c) => median(ringRgb.map((p) => p[c]))) as [number, number, number]
  const bg = edgeColour(rgba, width, height, { x0: x, y0: y, x1: x + W, y1: y + H })
  const flat = ringRgb.filter((p) => dist(p, bgRgb) < 24).length >= 0.9 * ringRgb.length
  // Distance from the background, and the ink's colour from the strongest pixels.
  const d = new Float32Array(W * H)
  let max = 0
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const v = dist(rgbAt(rgba, ((y + j) * width + x + i) * 4), bgRgb)
      d[j * W + i] = v
      if (v > max) max = v
    }
  if (max < 40) return null
  const strong: [number, number, number][] = []
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (d[j * W + i] > 0.9 * max) strong.push(rgbAt(rgba, ((y + j) * width + x + i) * 4))
  const colour = [0, 1, 2].map((c) => strong.reduce((s, p) => s + p[c], 0) / strong.length) as [number, number, number]
  const full = dist(colour, bgRgb) || 1
  // Soft coverage, at compared size.
  const k = Math.max(1, Math.ceil(H / MAX_HEIGHT))
  const w = Math.ceil(W / k)
  const h = Math.ceil(H / k)
  const cover = new Float32Array(w * h)
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const v = Math.min(1, d[j * W + i] / full)
      cover[Math.floor(j / k) * w + Math.floor(i / k)] += (v < 0.12 ? 0 : v) / (k * k)
    }
  // The ink's box at half coverage, where an anti-aliased edge really is.
  const ink = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 }
  let area = 0
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const v = cover[j * w + i]
      area += v
      if (v <= 0.5) continue
      ink.x0 = Math.min(ink.x0, i)
      ink.y0 = Math.min(ink.y0, j)
      ink.x1 = Math.max(ink.x1, i + 1)
      ink.y1 = Math.max(ink.y1, j + 1)
    }
  if (ink.x1 < 0) return null
  return { ...word, crop: { x0: x, y0: y, x1: x + W, y1: y + H }, x, y, w, h, k, cover, ink, area, colour, bg, flat }
}

// ---- Fonts --------------------------------------------------------------------------

type Laid = { commands: PathCommand[]; box: Box }
/** Laid-out words, kept for one matchText call (hundreds of styles × the words judged). */
let laidOut = new WeakMap<FontStyle, Map<string, Laid>>()

/**
 * `text` in `style` at 1000 px from the origin, with its ink box. Characters,
 * advances and kerning only: opentype.js can't read some fonts' substitution
 * tables, and matching doesn't need ligatures.
 */
function layout(style: FontStyle, text: string): Laid {
  let cache = laidOut.get(style)
  if (!cache) laidOut.set(style, (cache = new Map()))
  let laid = cache.get(text)
  if (laid) return laid
  const { font } = style
  const scale = 1000 / font.unitsPerEm
  const commands: PathCommand[] = []
  let x = 0
  let prev = null
  for (const ch of text) {
    const g = font.charToGlyph(ch)
    if (prev) x += font.getKerningValue(prev, g) * scale
    commands.push(...g.getPath(x, 0, 1000).commands)
    x += (g.advanceWidth ?? 0) * scale
    prev = g
  }
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (const c of commands)
    if (c.type !== 'Z') {
      // The curve's control points bound it, near enough for a glyph.
      for (const [px, py] of c.type === 'C' ? [[c.x1, c.y1], [c.x2, c.y2], [c.x, c.y]] : c.type === 'Q' ? [[c.x1, c.y1], [c.x, c.y]] : [[c.x, c.y]]) {
        box.x0 = Math.min(box.x0, px)
        box.y0 = Math.min(box.y0, py)
        box.x1 = Math.max(box.x1, px)
        box.y1 = Math.max(box.y1, py)
      }
    }
  laid = { commands, box }
  cache.set(text, laid)
  return laid
}

function moved(commands: PathCommand[], s: number, dx: number, dy: number): PathCommand[] {
  return commands.map((c) => {
    if (c.type === 'Z') return c
    if (c.type === 'Q') return { type: 'Q', x1: c.x1 * s + dx, y1: c.y1 * s + dy, x: c.x * s + dx, y: c.y * s + dy }
    if (c.type === 'C') return { type: 'C', x1: c.x1 * s + dx, y1: c.y1 * s + dy, x2: c.x2 * s + dx, y2: c.y2 * s + dy, x: c.x * s + dx, y: c.y * s + dy }
    return { type: c.type, x: c.x * s + dx, y: c.y * s + dy }
  })
}

const covers = (style: FontStyle, text: string) => [...text].every((ch) => ch === ' ' || style.font.charToGlyphIndex(ch) > 0)

/** `word` drawn in `style`, scaled (times `nudge`) and centred onto its ink box: scale, offsets, overlap. */
function fit(style: FontStyle, word: Measured, nudge: number) {
  const { commands, box } = layout(style, word.text)
  const s = ((word.ink.y1 - word.ink.y0) / (box.y1 - box.y0)) * nudge
  const dx = (word.ink.x0 + word.ink.x1) / 2 - ((box.x0 + box.x1) / 2) * s
  const dy = (word.ink.y0 + word.ink.y1) / 2 - ((box.y0 + box.y1) / 2) * s
  return { s, dx, dy, iou: overlap(word, moved(commands, s, dx, dy)) }
}

/** Soft IoU of `commands`, drawn at compared size, with the word's ink. */
function overlap(word: Measured, commands: PathCommand[]) {
  const drawn = rasterize(commands, word.w, word.h)
  let both = 0
  let either = 0
  for (let i = 0; i < drawn.length; i++) {
    const a = drawn[i]
    const b = word.cover[i]
    both += a < b ? a : b
    either += a > b ? a : b
  }
  return either ? both / either : 0
}

/** Each style's ink overlap with `words` (weighted by their ink), best first. */
function rank(styles: FontStyle[], words: Measured[], nudges: number[]) {
  const total = words.reduce((s, w) => s + w.area, 0)
  const out: { style: FontStyle; score: number }[] = []
  for (const style of styles) {
    if (!words.every((w) => covers(style, w.text))) continue
    // Proportions from the font's metrics alone rule most fonts out without drawing.
    let off = 0
    for (const w of words) {
      const { box } = layout(style, w.text)
      off += Math.abs(Math.log((box.x1 - box.x0) / (box.y1 - box.y0) / ((w.ink.x1 - w.ink.x0) / (w.ink.y1 - w.ink.y0)))) * w.area
    }
    if (off / total > ASPECT_SLACK) continue
    let score = 0
    for (const w of words) score += Math.max(...nudges.map((n) => fit(style, w, n).iou)) * w.area
    out.push({ style, score: score / total })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** The best style for a block's words, and how well it matched. */
function bestFont(styles: FontStyle[], words: Measured[]) {
  const judged = words
    .filter((w) => w.ink.y1 - w.ink.y0 >= MIN_HEIGHT && /[A-Za-z0-9]{2}/.test(w.text))
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, JUDGED_WORDS)
  if (!judged.length) return null
  const quick = rank(styles, judged, [1]).slice(0, SHORTLIST)
  return rank(quick.map((r) => r.style), judged, NUDGES)[0] ?? null
}

// ---- Blocks and lines -------------------------------------------------------------------

/**
 * Lines grouped into blocks, one font per block: a line joins a block of lines
 * of similar height that ends just above it and overlaps it across, so columns
 * side by side stay apart.
 */
function blocks(lines: Measured[][]) {
  const height = (l: Measured[]) => median(l.map((w) => w.box.y1 - w.box.y0))
  const out: { h: number; x0: number; x1: number; bottom: number; lines: Measured[][] }[] = []
  for (const l of [...lines].sort((a, b) => a[0].box.y0 - b[0].box.y0)) {
    const h = height(l)
    const top = Math.min(...l.map((w) => w.box.y0))
    const x0 = Math.min(...l.map((w) => w.box.x0))
    const x1 = Math.max(...l.map((w) => w.box.x1))
    const bottom = Math.max(...l.map((w) => w.box.y1))
    const block = out.find((b) => Math.abs(h - b.h) / b.h < 0.2 && top - b.bottom > -0.5 * h && top - b.bottom < 1.5 * h && x0 < b.x1 && x1 > b.x0)
    if (!block) out.push({ h, x0, x1, bottom, lines: [l] })
    else {
      block.lines.push(l)
      block.x0 = Math.min(block.x0, x0)
      block.x1 = Math.max(block.x1, x1)
      block.bottom = Math.max(block.bottom, bottom)
    }
  }
  return out
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

function pathData(commands: PathCommand[]) {
  const n = (v: number) => String(Math.round(v * 100) / 100)
  return commands
    .map((c) => (c.type === 'Z' ? 'Z' : c.type === 'Q' ? `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}` : c.type === 'C' ? `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}` : `${c.type}${n(c.x)} ${n(c.y)}`))
    .join('')
}

/** `word`'s best fit in `style` over the scale nudges. */
function bestFit(style: FontStyle, word: Measured) {
  return NUDGES.map((n) => fit(style, word, n)).reduce((a, b) => (b.iou > a.iou ? b : a))
}

type Fit = { word: Measured; s: number; dx: number; dy: number; iou: number }

/**
 * A line's words in `style` at one size and on one baseline (the medians of
 * the words' own fits), each slid across to where it overlaps best. A word's
 * own fit scales it to its ink box, which a faint apostrophe, comma or bracket
 * (under half coverage in small, light text) leaves short, so the word is
 * drawn too small and looks like a bad match; the line's consensus isn't fooled.
 */
function lineFits(style: FontStyle, words: Measured[]): Fit[] {
  const own = words.map((word) => ({ word, ...bestFit(style, word) }))
  // In image pixels: the line's scale (per layout unit), and its baseline.
  const size = median(own.map(({ word, s }) => s * word.k))
  const baseline = median(own.map(({ word, dy }) => word.y + dy * word.k))
  return own.map(({ word }) => {
    const { commands, box } = layout(style, word.text)
    const s = size / word.k
    const dy = (baseline - word.y) / word.k
    const centre = (word.ink.x0 + word.ink.x1) / 2 - ((box.x0 + box.x1) / 2) * s
    return SLIDES.map((d) => ({ word, s, dx: centre + d, dy, iou: overlap(word, moved(commands, s, centre + d, dy)) })).reduce((a, b) => (b.iou > a.iou ? b : a))
  })
}

/** One line's outlines, placed as fitted, in the image's pixels. */
function outline(style: FontStyle, line: Fit[]) {
  const commands: PathCommand[] = []
  for (const { word, s, dx, dy } of line) commands.push(...moved(layout(style, word.text).commands, s * word.k, word.x + dx * word.k, word.y + dy * word.k))
  return { size: line[0].s * line[0].word.k * 1000, d: pathData(commands) }
}

/**
 * The text runs to draw instead of tracing: lines from blocks whose best font
 * matched well enough, minus words that can't be painted out cleanly (on a
 * busy background), that the font can't draw, or that don't match it well
 * themselves (artwork OCR read as a word, beside real text).
 */
export function matchText(rgba: ArrayLike<number>, width: number, height: number, lines: OcrLine[], styles: FontStyle[]): TextRun[] {
  laidOut = new WeakMap()
  const measured = lines.map((l) => l.words.map((w) => measure(rgba, width, height, w)).filter((w): w is Measured => !!w)).filter((l) => l.length)
  const runs: TextRun[] = []
  for (const block of blocks(measured)) {
    const best = bestFont(styles, block.lines.flat())
    if (!best) continue
    const { style } = best
    const fitted = block.lines.map((l) => l.filter((w) => covers(style, w.text))).map((l) => (l.length ? lineFits(style, l) : []))
    // The font's match, judged both ways: small, soft text can fail the words' own fits
    // (which the font was picked by) and still match well at its lines' size.
    const all = fitted.flat()
    const area = all.reduce((s, f) => s + f.word.area, 0)
    const score = Math.max(best.score, area ? all.reduce((s, f) => s + f.iou * f.word.area, 0) / area : 0)
    if (score < MIN_SCORE) continue
    const kept = fitted.map((l) => l.filter((f) => f.word.flat && f.iou >= MIN_SCORE)).filter((l) => l.length)
    if (!kept.length) continue
    const fill = hex([0, 1, 2].map((c) => median(kept.flat().map((f) => f.word.colour[c]))))
    for (const fits of kept) {
      const line = fits.map((f) => f.word)
      const { size, d } = outline(style, fits)
      runs.push({
        text: line.map((w) => w.text).join(' '),
        family: style.family,
        weight: style.weight,
        size: Math.round(size * 10) / 10,
        fill,
        d,
        score: Math.round(score * 1000) / 1000,
        boxes: line.map((w) => ({ ...w.crop, bg: w.bg })),
      })
    }
  }
  laidOut = new WeakMap()
  return runs
}

/**
 * Each word box's background again, from `rgba` as it is now: after background
 * removal, what paintOut fills with is the masked colour, not the original.
 */
export function rebackground(rgba: ArrayLike<number>, width: number, height: number, runs: TextRun[]) {
  for (const run of runs) for (const b of run.boxes) b.bg = edgeColour(rgba, width, height, b)
}

/**
 * Fills each run's word boxes with their background, so the tracer doesn't
 * draw the text as well. `scale` takes the runs' pixels to `rgba`'s.
 */
export function paintOut(rgba: Uint8ClampedArray, width: number, height: number, runs: TextRun[], scale = 1) {
  for (const run of runs)
    for (const b of run.boxes)
      for (let y = Math.max(0, Math.floor(b.y0 * scale)); y < Math.min(height, Math.ceil(b.y1 * scale)); y++)
        for (let x = Math.max(0, Math.floor(b.x0 * scale)); x < Math.min(width, Math.ceil(b.x1 * scale)); x++) rgba.set(b.bg, (y * width + x) * 4)
}
