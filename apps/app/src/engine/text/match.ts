/**
 * Recognise text, after OCR: pick the closest of our fonts for each block of
 * text and redraw its words as outlined glyphs, so text comes out as type
 * rather than traced blobs.
 *
 * OCR has already said what the letters are, so instead of classifying the
 * font cold, every candidate draws the same words, scaled onto the word's
 * ink, and the one whose ink overlaps best wins (soft IoU). The same pass
 * gives the size and the position. On 60 images of known fonts (from 70
 * families) this picked the right family 92% of the time and the weight 87%,
 * with sizes within about 1%; on shrunk JPEGs, 31 of 36 at 18 px and up but
 * under half below that. A block that matches no font well enough stays
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

function measure(rgba: ArrayLike<number>, width: number, height: number, word: OcrWord): Measured | null {
  const pad = Math.max(2, Math.round((word.box.y1 - word.box.y0) * 0.08))
  const x = Math.max(0, word.box.x0 - pad)
  const y = Math.max(0, word.box.y0 - pad)
  const W = Math.min(width, word.box.x1 + pad) - x
  const H = Math.min(height, word.box.y1 + pad) - y
  if (W < 3 || H < 3) return null
  // The background: the median of the box's edge.
  const ring: number[] = []
  for (let i = 0; i < W; i++) ring.push(((y * width + x + i) * 4), (((y + H - 1) * width + x + i) * 4))
  for (let j = 1; j < H - 1; j++) ring.push((((y + j) * width + x) * 4), (((y + j) * width + x + W - 1) * 4))
  const ringRgb = ring.map((i) => rgbAt(rgba, i))
  const bgRgb = [0, 1, 2].map((c) => median(ringRgb.map((p) => p[c]))) as [number, number, number]
  const bg: Rgba = [...([0, 1, 2].map((c) => median(ring.map((i) => rgba[i + c]))) as [number, number, number]), median(ring.map((i) => rgba[i + 3]))]
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
const laidOut = new WeakMap<FontStyle, Map<string, Laid>>()

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
  const drawn = rasterize(moved(commands, s, dx, dy), word.w, word.h)
  let both = 0
  let either = 0
  for (let i = 0; i < drawn.length; i++) {
    const a = drawn[i]
    const b = word.cover[i]
    both += a < b ? a : b
    either += a > b ? a : b
  }
  return { s, dx, dy, iou: either ? both / either : 0 }
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

/** Lines grouped into blocks: similar height, each close below the last. One font per block. */
function blocks(lines: Measured[][]) {
  const height = (l: Measured[]) => median(l.map((w) => w.box.y1 - w.box.y0))
  const out: { h: number; bottom: number; lines: Measured[][] }[] = []
  for (const l of [...lines].sort((a, b) => a[0].box.y0 - b[0].box.y0)) {
    const h = height(l)
    const top = Math.min(...l.map((w) => w.box.y0))
    const last = out.at(-1)
    if (last && Math.abs(h - last.h) / last.h < 0.2 && top - last.bottom < 1.5 * h) last.lines.push(l)
    else out.push({ h, bottom: 0, lines: [l] })
    out.at(-1)!.bottom = Math.max(...l.map((w) => w.box.y1))
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

/**
 * One line in its block's font: one size (the median of its words' fits) and one
 * baseline (the median of theirs), each word centred across its own ink.
 * Coordinates go back to the image's pixels.
 */
function outline(style: FontStyle, line: Measured[]) {
  const fits = line.map((w) => {
    let best = fit(style, w, 1)
    for (const n of NUDGES) {
      const f = fit(style, w, n)
      if (f.iou > best.iou) best = f
    }
    return best
  })
  // In image pixels: the line's scale, then the baseline each word implies at it.
  const size = median(fits.map((f, i) => f.s * line[i].k))
  const centre = (w: Measured, lo: number, hi: number, at: number) => at + ((lo + hi) / 2) * w.k
  const baseline = median(line.map((w) => centre(w, w.ink.y0, w.ink.y1, w.y) - ((layout(style, w.text).box.y0 + layout(style, w.text).box.y1) / 2) * size))
  const commands: PathCommand[] = []
  for (const w of line) {
    const { commands: glyphs, box } = layout(style, w.text)
    commands.push(...moved(glyphs, size, centre(w, w.ink.x0, w.ink.x1, w.x) - ((box.x0 + box.x1) / 2) * size, baseline))
  }
  return { size: size * 1000, d: pathData(commands) }
}

/**
 * The text runs to draw instead of tracing: lines from blocks whose best font
 * matched well enough, minus words that can't be painted out cleanly (on a
 * busy background) or that the font can't draw.
 */
export function matchText(rgba: ArrayLike<number>, width: number, height: number, lines: OcrLine[], styles: FontStyle[]): TextRun[] {
  const measured = lines.map((l) => l.words.map((w) => measure(rgba, width, height, w)).filter((w): w is Measured => !!w)).filter((l) => l.length)
  const runs: TextRun[] = []
  for (const block of blocks(measured)) {
    const best = bestFont(styles, block.lines.flat())
    if (!best || best.score < MIN_SCORE) continue
    const { style } = best
    const kept = block.lines.map((l) => l.filter((w) => w.flat && covers(style, w.text))).filter((l) => l.length)
    if (!kept.length) continue
    const fill = hex([0, 1, 2].map((c) => median(kept.flat().map((w) => w.colour[c]))))
    for (const line of kept) {
      const { size, d } = outline(style, line)
      runs.push({
        text: line.map((w) => w.text).join(' '),
        family: style.family,
        weight: style.weight,
        size: Math.round(size * 10) / 10,
        fill,
        d,
        score: Math.round(best.score * 1000) / 1000,
        boxes: line.map((w) => ({ ...w.crop, bg: w.bg })),
      })
    }
  }
  return runs
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
