/**
 * Clean up (#199, #214): edits to the image before it is traced, as a list of
 * operations replayed onto the original. The list is the record (it is what
 * undo steps through and what the session saves); replaying it makes the
 * cleaned pixels, which become the image the tracer, the presets and Prepare
 * take, so none of them change. The original file is never touched.
 *
 * Every operation is a pure function of pixels, so a replay is exact and the
 * tests can run it without a canvas:
 *
 *  - crop: a rectangle in fractions of the image as it is at that step, so it
 *    doesn't depend on the size the image is replayed at;
 *  - rotate: clockwise, in degrees. Quarter turns move pixels exactly; any
 *    other angle (Straighten) resamples bilinearly onto a canvas grown to fit,
 *    the new corners filled with the image's background colour, so they trace
 *    as nothing rather than as a frame;
 *  - flip: horizontal (left to right) or vertical;
 *  - levels: black and white points and a midtone (gamma), per channel;
 *  - threshold: black or white by brightness, the one-click fix for line art.
 *
 * Levels and threshold are adjustments: there is at most one of each, edited
 * in place as their sliders move. Crop, rotate and flip are appended.
 */

export type Img = { rgba: Uint8ClampedArray; width: number; height: number }

export type Crop = { kind: 'crop'; x: number; y: number; width: number; height: number }
export type Rotate = { kind: 'rotate'; degrees: number }
export type Flip = { kind: 'flip'; axis: 'horizontal' | 'vertical' }
export type Levels = { kind: 'levels'; black: number; white: number; gamma: number }
export type Threshold = { kind: 'threshold'; level: number }
export type CleanupOp = Crop | Rotate | Flip | Levels | Threshold

/** The long edge clean-up works at (the fine-detail limit): larger originals are scaled down first. */
export const CLEANUP_MAX_EDGE = 2048
/** Below this many pixels on a side a crop isn't kept: nothing traceable is left. */
export const MIN_CROP_PX = 4
export const MAX_OPS = 200

export const LEVELS_DEFAULT: Levels = { kind: 'levels', black: 0, white: 255, gamma: 1 }
export const THRESHOLD_DEFAULT: Threshold = { kind: 'threshold', level: 128 }

// ---- The list ---------------------------------------------------------------

/** Append a geometric op, folding it into the last one where that's exact. */
export function addOp(ops: CleanupOp[], op: Crop | Rotate | Flip): CleanupOp[] {
  const last = ops[ops.length - 1]
  if (op.kind === 'rotate') {
    const degrees = normDegrees(op.degrees)
    if (last?.kind === 'rotate') {
      const sum = normDegrees(last.degrees + degrees)
      // Two quarter turns make a half turn; a straighten then a turn stay apart, so the fill stays where it was drawn.
      if (isQuarter(last.degrees) && isQuarter(degrees)) return sum ? [...ops.slice(0, -1), { kind: 'rotate', degrees: sum }] : ops.slice(0, -1)
    }
    return degrees ? [...ops, { kind: 'rotate', degrees }] : ops
  }
  // Flipping back undoes the flip.
  if (op.kind === 'flip' && last?.kind === 'flip' && last.axis === op.axis) return ops.slice(0, -1)
  return [...ops, op]
}

/** Set an adjustment (levels or threshold) in place, or add it; `null` removes it. */
export function setAdjustment(ops: CleanupOp[], kind: 'levels' | 'threshold', op: Levels | Threshold | null): CleanupOp[] {
  const at = ops.findIndex((o) => o.kind === kind)
  if (!op) return at < 0 ? ops : ops.filter((_, i) => i !== at)
  if (at < 0) return [...ops, op]
  return ops.map((o, i) => (i === at ? op : o))
}

export const adjustmentOf = <K extends 'levels' | 'threshold'>(ops: CleanupOp[], kind: K) => ops.find((o) => o.kind === kind) as (K extends 'levels' ? Levels : Threshold) | undefined

/** Whether two lists change the image's geometry (crop, rotate, flip) the same way. */
export const sameGeometry = (a: CleanupOp[], b: CleanupOp[]) => {
  const g = (ops: CleanupOp[]) => JSON.stringify(ops.filter((o) => o.kind === 'crop' || o.kind === 'rotate' || o.kind === 'flip'))
  return g(a) === g(b)
}

// ---- Straighten -------------------------------------------------------------

/**
 * The clockwise turn that makes a line drawn from `a` to `b` level or upright,
 * whichever it is nearer. Image y points down.
 */
export function straightenAngle(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI // clockwise from pointing right
  // Nearest multiple of 90, then turn back by the difference.
  const off = angle - Math.round(angle / 90) * 90
  return round2(-off) || 0
}

// ---- Validation (sessions are read back from storage) -------------------------

const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** A saved list, checked op by op; null if anything in it isn't one of ours. */
export function checkCleanup(value: unknown): CleanupOp[] | null {
  if (!Array.isArray(value) || value.length > MAX_OPS) return null
  const out: CleanupOp[] = []
  for (const o of value as Record<string, unknown>[]) {
    if (!o || typeof o !== 'object') return null
    if (o.kind === 'crop' && num(o.x, 0, 1) && num(o.y, 0, 1) && num(o.width, 0, 1) && num(o.height, 0, 1) && (o.x as number) + (o.width as number) <= 1 + 1e-9 && (o.y as number) + (o.height as number) <= 1 + 1e-9)
      out.push({ kind: 'crop', x: o.x as number, y: o.y as number, width: o.width as number, height: o.height as number })
    else if (o.kind === 'rotate' && num(o.degrees, -360, 360)) out.push({ kind: 'rotate', degrees: o.degrees as number })
    else if (o.kind === 'flip' && (o.axis === 'horizontal' || o.axis === 'vertical')) out.push({ kind: 'flip', axis: o.axis })
    else if (o.kind === 'levels' && num(o.black, 0, 254) && num(o.white, 1, 255) && (o.black as number) < (o.white as number) && num(o.gamma, 0.1, 10))
      out.push({ kind: 'levels', black: o.black as number, white: o.white as number, gamma: o.gamma as number })
    else if (o.kind === 'threshold' && num(o.level, 1, 255)) out.push({ kind: 'threshold', level: o.level as number })
    else return null
  }
  return out
}

// ---- Shared with the replay ----------------------------------------------------

export const isQuarter = (d: number) => Math.abs(d / 90 - Math.round(d / 90)) < 1e-9
export const normDegrees = (d: number) => {
  const r = round2(((d % 360) + 540) % 360 - 180) // -180 < r <= 180
  return r === -180 ? 180 : r
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const round2 = (v: number) => Math.round(v * 100) / 100
