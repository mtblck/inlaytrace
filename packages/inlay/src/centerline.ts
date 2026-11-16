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
import { joinDiagonals, labelBinary, mergeSpecks, toSvg, type InlayResult } from './inlay'
import { closeGaps } from './gaps'
import { skeletonStrokes, thin } from './skeleton'

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
  /** Join a line's ends across small breaks before tracing (gaps.ts). Off by default. */
  closeGaps?: boolean
  /** How many times the drawing was enlarged before tracing: gap closing's pixel limits grow with it. Default 1. */
  scale?: number
}

/**
 * A centerline trace: the usual result, its paths stroked (`stroke` is the
 * width, `fill` the colour, as Outline art's lines), and `measuredWidth`.
 * @deprecated Since 0.4: it's `InlayResult`.
 */
export type CenterlineResult = InlayResult & { measuredWidth: number }

/**
 * Trace to an SVG string; `centerline` gives the strokes as data.
 * @deprecated Since 0.4: use `toSvg(trace(image, { preset: 'centerline' }))`.
 */
export const traceCenterline = (rgba: ArrayLike<number>, w: number, h: number, o: CenterlineOptions): string => toSvg(centerline(rgba, w, h, o))

/** @deprecated Since 0.4: `toSvg` draws stroked paths the same way. */
export const centerlineToSvg = (r: InlayResult): string => toSvg(r)

const round = (n: number) => Math.round(n * 100) / 100

export function centerline(rgba: ArrayLike<number>, w: number, h: number, o: CenterlineOptions): CenterlineResult {
  const { labels, drawn } = labelBinary(rgba, w, h, o.threshold)
  joinDiagonals(labels, w, h, rgba, drawn)
  mergeSpecks(labels, w, h, Math.max(0, Math.round(o.speckle)) ** 2)
  const ink = new Uint8Array(w * h)
  for (let i = 0; i < ink.length; i++) ink[i] = labels[i] === 0 ? 1 : 0

  // Thinned once: gap closing's skeleton is the strokes' too, unless it joined something.
  const skel = o.closeGaps ? thin(ink, w, h) : undefined
  const joined = !!skel && closeGaps(ink, w, h, { scale: o.scale, skel }) > 0
  if (joined) {
    // Joins can close off a pocket of paper too small to keep (it would thin to a little loop): specks again.
    for (let i = 0; i < ink.length; i++) if (ink[i]) labels[i] = 0
    mergeSpecks(labels, w, h, Math.max(0, Math.round(o.speckle)) ** 2)
    for (let i = 0; i < ink.length; i++) ink[i] = labels[i] === 0 ? 1 : 0
  }
  const { subs, measured } = skeletonStrokes(ink, w, h, o, joined ? undefined : skel)
  const width = o.strokeWidth && o.strokeWidth > 0 ? o.strokeWidth : measured
  const paths = subs.length ? [{ d: serializePath(subs), fill: o.color ?? '#000000', stroke: round(width) }] : []
  return { width: w, height: h, paths, measuredWidth: round(measured) }
}
