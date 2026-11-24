/**
 * Presets and the one-call API (#162, #163): `trace(image, { preset })`.
 *
 * Each preset is a recipe the app tuned and `npm run score` measures: how the
 * palette is picked, what runs before tracing, and the fitting defaults. Any
 * option given overrides the preset's. The app reads its presets from here,
 * so the package and the app can't drift apart.
 */
import { centerline } from './centerline'
import { run, toSvg, traceRaw, traceSteps, type InlayOptions, type InlayResult, type TraceStep } from './inlay'
import { exactPalette, oklab, peakPalette, quantizePalette } from './palette'
import { sharpenEdges } from './sharpen'
import { boostLines, smoothShading } from './smooth'

export type PresetName = 'logo' | 'illustration' | 'outline' | 'lineart' | 'centerline' | 'poster' | 'pixel'

/** Anything shaped like ImageData: RGBA bytes, row by row, and the size. sharp's `{ data, info }` gives `data` and `info.width`/`info.height`. */
export type ImageLike = { data: ArrayLike<number>; width: number; height: number }

export type TraceOptions = {
  /** What the image is: picks the palette, the steps before tracing and every default below. Default 'logo'. */
  preset?: PresetName
  /** Colour presets: at most this many colours. */
  colors?: number
  /** Colour presets: trace with exactly these colours (#rrggbb), instead of picking them from the image. */
  palette?: string[]
  /** Fold colours together before tracing, so the edge between them disappears: { '#from': '#into' }, traced hex to traced hex. */
  merge?: Record<string, string>
  /** Regions smaller than speckle × speckle px merge into their surroundings. */
  speckle?: number
  /** How far, in px, the fitted outline may stray from the pixels. */
  tolerance?: number
  /** Turns sharper than this (degrees) stay corners. */
  cornerAngle?: number
  /** Half-window in px of the smoothing over the pixel staircase (default 12). */
  smoothing?: number
  /** Draw circles, ellipses, (rounded) rectangles and regular polygons exactly. */
  shapes?: boolean
  /** Shapes drawn whole, in layers, instead of cut out to tile (cut out is what cutters want). */
  layers?: boolean
  /** Thin drawn lines as stroked paths (Outline art). */
  strokes?: boolean
  /** Soft shading as gradient fills. Off with your own `palette`, whose colours a gradient would leave. */
  gradients?: boolean
  /** Join lines' ends across small breaks before tracing. */
  closeGaps?: boolean
  /** How many times the image was enlarged before tracing: line widths and gap sizes grow with it. Default 1. */
  scale?: number
  /** Ink presets (lineart, centerline): ink is darker than this (0–255), the image's own split when 'auto', adaptive when null. */
  threshold?: number | 'auto' | null
  /** Ink presets: light ink on a dark background. */
  invert?: boolean
  /** Centerline: the stroke width in px; measured from the ink when left out. */
  strokeWidth?: number
  /** Colour presets: make soft, blurry edges hard before picking colours, so the blur doesn't trace as a band round every shape. Does nothing to crisp images. */
  sharpen?: boolean
  /** Colour presets: even out painted shading (brush and JPEG noise) before picking colours. */
  smoothShading?: boolean
  /** Colour presets: darken faint painted outlines first, so the shapes they part don't merge. */
  keepOutlines?: boolean
  /** Colour presets but pixel art: trace in greys only, `colors` of them (each pixel's OKLab lightness, as a grey). */
  grayscale?: boolean
}

/** A preset's defaults: what `trace` uses for every option not given. */
export type PresetDefaults = Readonly<
  Pick<TraceOptions, 'colors' | 'speckle' | 'tolerance' | 'cornerAngle' | 'shapes' | 'layers' | 'strokes' | 'gradients' | 'closeGaps' | 'threshold'>
> & {
  /** Which kind of trace: filled colour shapes, one ink's shapes, or strokes down the ink's middle. */
  readonly kind: 'colour' | 'ink' | 'centerline'
}

/** How a colour preset picks its palette. Internal: the preset name says it. */
type Picker = 'peak' | 'quantize' | 'exact'

const ILLUSTRATION = { kind: 'colour', colors: 24, speckle: 4, tolerance: 0.75, cornerAngle: 60, shapes: true, layers: true, gradients: true } as const

/** Every preset's defaults, as the app shows them. */
export const presets: Readonly<Record<PresetName, PresetDefaults>> = {
  logo: { kind: 'colour', colors: 8, speckle: 8, tolerance: 1, cornerAngle: 45, shapes: true, layers: false },
  illustration: ILLUSTRATION,
  outline: { ...ILLUSTRATION, strokes: true, closeGaps: true },
  lineart: { kind: 'ink', threshold: 'auto', speckle: 6, tolerance: 1, cornerAngle: 45, shapes: true, closeGaps: true },
  centerline: { kind: 'centerline', threshold: 'auto', speckle: 4, tolerance: 1, cornerAngle: 45, closeGaps: true },
  poster: { kind: 'colour', colors: 24, speckle: 8, tolerance: 0.75, cornerAngle: 90, layers: true },
  pixel: { kind: 'colour', colors: 32, speckle: 0, tolerance: 0.25, cornerAngle: 0 },
}

const PICKER: Partial<Record<PresetName, Picker>> = { logo: 'peak', illustration: 'peak', outline: 'peak', poster: 'quantize', pixel: 'exact' }

/** Below this share of opaque pixels in its exact colours, an image isn't treated as pixel art. */
const EXACT_COVERAGE = 0.9

/**
 * The share of opaque pixels whose colour is exactly one of `palette`, not
 * counting its first (commonest) colour. A JPEG drawing on a white page is
 * 88% white, so counting the page passed it as pixel art; its other 31
 * "exact" colours were near-whites, and the blue drawing traced as white.
 */
function coverage(pixels: ArrayLike<number>, palette: string[]) {
  const set = new Set(palette.map((hex) => parseInt(hex.slice(1), 16)))
  const first = palette.length ? parseInt(palette[0]!.slice(1), 16) : -1
  let opaque = 0
  let hit = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue
    const c = (pixels[i]! << 16) | (pixels[i + 1]! << 8) | pixels[i + 2]!
    if (c === first) continue
    opaque++
    if (set.has(c)) hit++
  }
  return opaque ? hit / opaque : 1
}

/**
 * How wide a painted outline is looked for, by how many times the image was
 * enlarged: 2 px at its own size (lines up to about 4 px wide), 3 px at 2×.
 */
export const outlineRadius = (scale: number) => Math.min(4, Math.max(2, Math.round(1.5 * scale)))

/** The trace for `image` with `options`: a preset's recipe, with any option given in place of its default. */
export function tracePreset(image: ImageLike, options: TraceOptions = {}): InlayResult & { measuredWidth?: number } {
  return run(presetSteps(image, options))
}

/** `tracePreset` as steps (see `traceSteps`), for `traceAsync`. */
function* presetSteps(image: ImageLike, options: TraceOptions = {}): Generator<TraceStep, InlayResult & { measuredWidth?: number }> {
  const name = options.preset ?? 'logo'
  const p = Object.hasOwn(presets, name) ? presets[name] : undefined
  if (!p) throw new Error(`Unknown preset "${String(name)}". Use one of: ${Object.keys(presets).join(', ')}.`)
  const { width, height } = image
  if (!(width > 0 && height > 0) || image.data.length < width * height * 4) throw new Error(`The image needs ${width} × ${height} × 4 bytes of RGBA, and has ${image.data.length}.`)
  const o = { ...p, ...defined(options) }
  const fit = { speckle: o.speckle ?? 0, tolerance: o.tolerance ?? 1, cornerAngle: o.cornerAngle ?? 45, ...(o.smoothing !== undefined ? { smoothing: o.smoothing } : {}) }
  const scale = o.scale ?? 1
  let px: ArrayLike<number> = image.data
  if (p.kind !== 'colour') {
    // Ink is always the dark side: for light ink on dark, flip a copy first.
    if (o.invert) {
      const flipped = Uint8ClampedArray.from(px)
      for (let i = 0; i < flipped.length; i += 4) for (let k = 0; k < 3; k++) flipped[i + k] = 255 - flipped[i + k]!
      px = flipped
    }
    const threshold = o.threshold === undefined ? 'auto' : o.threshold
    if (p.kind === 'centerline') {
      yield { stage: 'label', done: 0 }
      return centerline(px, width, height, { ...fit, threshold, closeGaps: !!o.closeGaps, scale, ...(o.strokeWidth ? { strokeWidth: o.strokeWidth } : {}) })
    }
    return yield* traceSteps(px, width, height, { ...fit, shapes: !!o.shapes, mode: 'binary', threshold, closeGaps: !!o.closeGaps, scale })
  }
  // Greys only: each pixel becomes the grey of its own lightness, so every palette picked from it is grey.
  if (o.grayscale && name !== 'pixel' && !o.palette?.length) px = toGray(px)
  // Blurry edges made hard first, so their ramps don't pick up a colour of their own (a halo).
  if (o.sharpen) px = sharpenEdges(px, width, height)
  // Painted outlines made plain first, and marked, so neither smoothing nor the clean-up after labelling takes them away.
  const lines = o.keepOutlines ? new Uint8Array(width * height) : undefined
  if (lines) px = boostLines(px, width, height, outlineRadius(scale), lines)
  // Painted shading evened out first, so its noise doesn't fleck it with the neighbouring colour.
  if (o.smoothShading) px = smoothShading(px, width, height, lines)
  yield { stage: 'palette', done: 0 }
  const picker = PICKER[name]!
  const colors = o.colors ?? 8
  const own = o.palette?.length ? o.palette : null
  // Peaks are told the width, so they can find pale tints by their flatness.
  let palette = own ?? (picker === 'exact' ? exactPalette(px, colors) : picker === 'quantize' ? quantizePalette(px, colors) : peakPalette(px, colors, { width }))
  // Pixel art is its exact colours, which cover all of it. When they cover
  // little (a photo, or art saved as JPEG), the most common exact colours are
  // near-copies of the commonest one: a photo's 32 were all black and grey.
  // Then cluster instead, as Poster does; the edges stay pixel-exact.
  if (!own && picker === 'exact' && coverage(px, palette) < EXACT_COVERAGE) palette = quantizePalette(px, colors)
  const pixels = name === 'pixel'
  const merge = o.merge && Object.keys(o.merge).length ? { merge: o.merge } : {}
  // Gradients' stops are sampled from the image, so they'd bring back colours your own palette doesn't have.
  const gradients = options.gradients ?? (!!p.gradients && !own && !!o.layers)
  const raw: InlayOptions = {
    ...fit,
    mode: 'palette',
    palette,
    ...merge,
    shapes: !!o.shapes && !pixels,
    pixels,
    stacked: !pixels && !!o.layers,
    // Poster's clusters get a photo's clean-up; flat art's real colours get flat art's.
    photo: picker === 'quantize',
    strokes: !!o.strokes && !pixels && picker !== 'quantize',
    gradients: gradients && !pixels,
    closeGaps: !!o.closeGaps,
    scale,
    ...(lines ? { lines } : {}),
  }
  return yield* traceSteps(px, width, height, raw)
}

/** sRGB (0–255) of the grey whose OKLab lightness is `l`: for a grey, L is the cube root of its linear light. */
const greyOf = (l: number) => {
  const y = Math.min(1, Math.max(0, l)) ** 3
  return Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055))
}

/** A copy of the image in greys of each pixel's own OKLab lightness; alpha kept. */
function toGray(px: ArrayLike<number>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length)
  const seen = new Map<number, number>()
  for (let i = 0; i < px.length; i += 4) {
    const key = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!
    let v = seen.get(key)
    if (v === undefined) seen.set(key, (v = greyOf(oklab([px[i]!, px[i + 1]!, px[i + 2]!])[0])))
    out[i] = out[i + 1] = out[i + 2] = v
    out[i + 3] = px[i + 3]!
  }
  return out
}

/** The options given, without the ones explicitly undefined (which would hide a preset's default). */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

/**
 * Trace an image into filled shapes that share their edges exactly (or, with
 * the centerline preset, strokes down the ink's middle).
 *
 *     trace(imageData, { preset: 'logo' })
 *     trace({ data, width, height }, { preset: 'poster', colors: 16 })
 */
export function trace(image: ImageLike, options?: TraceOptions): InlayResult
/** @deprecated Since 0.4: use `trace({ data: rgba, width, height }, { preset, … })`. This form goes in 1.0. */
export function trace(rgba: ArrayLike<number>, width: number, height: number, options: InlayOptions): InlayResult
export function trace(a: ImageLike | ArrayLike<number>, b?: TraceOptions | number, c?: number, d?: InlayOptions): InlayResult {
  if (typeof b === 'number') return traceRaw(a as ArrayLike<number>, b, c!, d!)
  return tracePreset(a as ImageLike, b)
}

/** `toSvg(trace(…))` in one call, in either form. */
export function traceInlay(image: ImageLike, options?: TraceOptions): string
/** @deprecated Since 0.4: use `traceInlay({ data: rgba, width, height }, { preset, … })`. This form goes in 1.0. */
export function traceInlay(rgba: ArrayLike<number>, width: number, height: number, options: InlayOptions): string
export function traceInlay(a: ImageLike | ArrayLike<number>, b?: TraceOptions | number, c?: number, d?: InlayOptions): string {
  return toSvg(typeof b === 'number' ? traceRaw(a as ArrayLike<number>, b, c!, d!) : tracePreset(a as ImageLike, b))
}

/** Anything shaped like an AbortSignal (an AbortController's `signal`). */
export type AbortSignalLike = { readonly aborted: boolean; readonly reason?: unknown }

export type TraceAsyncOptions = TraceOptions & {
  /** Stops the trace at its next pause: the promise rejects with the signal's reason. */
  signal?: AbortSignalLike
  /** Called at each pause with the stage under way and how far through it (0 to 1). */
  onProgress?: (step: TraceStep) => void
}

/** How long, in ms, the trace runs before letting the thread do other work. */
const SLICE_MS = 12
const later = () => new Promise<void>((resolve) => (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout(resolve, 0))
const stop = (signal: AbortSignalLike) => {
  if (!signal.aborted) return
  if (signal.reason !== undefined) throw signal.reason
  throw Object.assign(new Error('The trace was aborted.'), { name: 'AbortError' })
}

/**
 * `trace`, but it pauses between its stages (and every few hundred edges
 * while fitting) to report progress and let the thread get on with other
 * work, and it stops when `signal` aborts. Same result as `trace`.
 *
 *     const controller = new AbortController()
 *     const result = await traceAsync(image, { preset: 'poster', signal: controller.signal, onProgress: (s) => console.log(s.stage, s.done) })
 */
export async function traceAsync(image: ImageLike, options: TraceAsyncOptions = {}): Promise<InlayResult> {
  const { signal, onProgress, ...rest } = options
  if (signal) stop(signal)
  const steps = presetSteps(image, rest)
  let since = Date.now()
  for (;;) {
    const r = steps.next()
    if (r.done) return r.value
    onProgress?.(r.value)
    if (Date.now() - since >= SLICE_MS) {
      await later()
      since = Date.now()
    }
    if (signal) stop(signal)
  }
}
