/**
 * Zoom as a scale: screen pixels per pixel of the original image, so 1 is
 * "100%" whatever size the image was traced at. `null` means fit-to-window,
 * which follows the window as it resizes.
 *
 * The slider and the ± steps work in log2 space, so every step is the same
 * ratio and the slider spends as much travel on 50–100% as on 400–800%.
 */
export type Zoom = number | null

/** Zooming out to half of fit is enough to see the whole thing with room around it. */
export const MIN_OF_FIT = 0.5
/** 32× fit or 16× actual size, whichever is further: enough for single nodes on a small logo. */
export const MAX_OF_FIT = 32
const MAX_ACTUAL = 16

/** Ratio for one − / + step or one keyboard step. */
export const STEP = Math.SQRT2

export function bounds(fit: number) {
  return { min: fit * MIN_OF_FIT, max: Math.max(fit * MAX_OF_FIT, MAX_ACTUAL) }
}

export function clampScale(scale: number, fit: number) {
  const { min, max } = bounds(fit)
  return Math.min(max, Math.max(min, scale))
}

/** The scale actually drawn. */
export const effective = (zoom: Zoom, fit: number) => (zoom === null ? fit : clampScale(zoom, fit))

/** Slider position (log2 of the scale) and back. */
export const toSlider = (scale: number) => Math.log2(scale)
export const fromSlider = (v: number) => 2 ** v

/** Within 1% of fit counts as fit, so stepping back lands on fit, not 99.4%. */
export function snap(scale: number, fit: number): Zoom {
  return Math.abs(scale / fit - 1) < 0.01 ? null : clampScale(scale, fit)
}

/** One step in or out, landing on fit or 100% when a step crosses either. */
export function step(zoom: Zoom, fit: number, dir: 1 | -1): Zoom {
  const now = effective(zoom, fit)
  const next = clampScale(now * STEP ** dir, fit)
  // If the step crosses fit or 100%, stop at the first one crossed.
  const crossed = [fit, 1].filter((stop) => (now < stop && next > stop) || (now > stop && next < stop))
  if (crossed.length) return snap(crossed.reduce((a, b) => (Math.abs(Math.log(a / now)) <= Math.abs(Math.log(b / now)) ? a : b)), fit)
  return snap(next, fit)
}

/**
 * Wheel → scale factor. A trackpad pinch arrives as ctrl+wheel with small
 * deltas; a mouse wheel with ⌘/Ctrl held sends ~100 per notch. Each event is
 * capped so one notch is one comfortable step, never a jump to the limit.
 */
export function wheelFactor(deltaY: number, deltaMode: number) {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  const capped = Math.max(-50, Math.min(50, px))
  return Math.exp(-capped * 0.01)
}

/**
 * How far to scroll so the content point that was under (cx, cy) before a
 * zoom is under it again after. `before` and `after` are the content box's
 * screen rects; the caller adds the result to scrollLeft / scrollTop.
 */
export function anchorScroll(
  before: { left: number; top: number; width: number; height: number },
  after: { left: number; top: number; width: number; height: number },
  cx: number,
  cy: number,
) {
  const fx = before.width ? (cx - before.left) / before.width : 0.5
  const fy = before.height ? (cy - before.top) / before.height : 0.5
  return { dx: after.left + fx * after.width - cx, dy: after.top + fy * after.height - cy }
}
