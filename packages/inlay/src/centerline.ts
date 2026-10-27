/**
 * Centerline tracing: single strokes down the middle of the ink, for pen
 * plotters, engravers and handwriting, instead of outlines round it.
 *
 *  1. Threshold the image to ink and paper (as line art does), and fold specks
 *     and pinholes into their surroundings so they don't become stray strokes
 *     or little loops.
 *  2. Thin the ink to a one-pixel skeleton (Zhang and Suen, "A fast parallel
 *     algorithm for thinning digital patterns", CACM 1984).
 *  3. Measure the stroke width: the ink's area over the skeleton's length.
 *  4. Prune spurs: short branches that thinning grows from bumps in the
 *     outline, anything shorter than the stroke is wide.
 *  5. Walk the skeleton into chains between ends and junctions. Where strokes
 *     cross or branch, chains that carry on in the same direction are joined,
 *     so a plotter lifts its pen less.
 *  6. Fit each chain with the same curve fitter as outlines, and draw it as an
 *     open (or, for a loop, closed) stroke with round caps and joins.
 *
 * Everything here is written for this project (MIT); no GPL tracer is used.
 */
import { serializePath } from './path'
import { attr, joinDiagonals, labelBinary, mergeSpecks } from './inlay'
import { skeletonStrokes } from './skeleton'

export type CenterlineOptions = {
  /** Ink is darker than this (0–255); 'auto' splits ink from paper by the image's histogram (Otsu); null compares each pixel with its neighbourhood instead. */
  threshold: number | 'auto' | null
  /** Ink and paper regions smaller than speckle × speckle pixels are folded into their surroundings. */
  speckle: number
  /** Max distance in pixels between the skeleton and the fitted stroke. */
  tolerance: number
  /** Turns sharper than this (degrees from straight) are corners. */
  cornerAngle: number
  /** The stroke width in pixels; measured from the ink when left out. */
  strokeWidth?: number
  /** The stroke colour. Default black. */
  color?: string
}

/** One stroked path: open subpaths (and closed loops), drawn with round caps and joins. */
export type CenterlinePath = { d: string; stroke: string; strokeWidth: number }
export type CenterlineResult = {
  width: number
  height: number
  paths: CenterlinePath[]
  /** The stroke width measured from the ink, in pixels (whatever `strokeWidth` asked for). */
  measuredWidth: number
}

/** Trace to an SVG string; `centerline` gives the strokes as data. */
export const traceCenterline = (rgba: ArrayLike<number>, w: number, h: number, o: CenterlineOptions): string => centerlineToSvg(centerline(rgba, w, h, o))

export function centerlineToSvg(r: CenterlineResult): string {
  const paths = r.paths.map((p) => `<path d="${attr(p.d)}" fill="none" stroke="${attr(p.stroke)}" stroke-width="${attr(round(p.strokeWidth))}" stroke-linecap="round" stroke-linejoin="round"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${r.width}" height="${r.height}" viewBox="0 0 ${r.width} ${r.height}">\n${paths.join('\n')}\n</svg>\n`
}

const round = (n: number) => Math.round(n * 100) / 100

export function centerline(rgba: ArrayLike<number>, w: number, h: number, o: CenterlineOptions): CenterlineResult {
  const { labels, drawn } = labelBinary(rgba, w, h, o.threshold)
  joinDiagonals(labels, w, h, rgba, drawn)
  mergeSpecks(labels, w, h, Math.max(0, Math.round(o.speckle)) ** 2)
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = labels[i] === 0 ? 1 : 0

  const { subs, measured } = skeletonStrokes(ink, w, h, o)
  const width = o.strokeWidth && o.strokeWidth > 0 ? o.strokeWidth : measured
  const paths = subs.length ? [{ d: serializePath(subs), stroke: o.color ?? '#000000', strokeWidth: round(width) }] : []
  return { width: w, height: h, paths, measuredWidth: round(measured) }
}
