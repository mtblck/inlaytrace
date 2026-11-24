/**
 * Purpose-named presets, all traced by Inlay (packages/inlay) since Poster
 * moved over in #53. The history below is how they were tuned, first on
 * VTracer.
 *
 * The numbers were tuned on VTracer's own sample set (an illustration, a pencil
 * drawing, pixel art and a photographic poster). The single biggest lever is
 * `maxColors`: on the illustration, capping at 8 colours cut the file from
 * 281 KB / 268 colours to 100 KB / 8 colours with no visible loss, because the
 * uncapped trace spends most of its paths on JPEG noise between flat fills.
 *
 * Logo settings were then scored by rendering each SVG back and measuring the
 * error against the clean source art (see README, "Tuning the presets"):
 *  - A cap of 6 on a 5-colour badge merged two real colours into one, because
 *    anti-aliased edge shades took quantizer slots: 8.75% of pixels wrong.
 *    A cap of 8 fixed it (1.4%).
 *  - `layerDifference: 32` plus speckle 8 took the same badge from 346 paths /
 *    68 KB to 45 paths / 13 KB at the same accuracy. On a photo it cost
 *    accuracy instead, so only the logo preset uses it.
 *  - Cut-out shapes beat stacked for logos (15 paths, 0.95% wrong) and are
 *    what a vinyl cutter wants anyway; on photos they added paths.
 *  - VTracer's quantizer drifted flat colours towards their neighbours (the
 *    gold sun came out pale peach). Picking the palette from histogram peaks
 *    instead recovered the source colours almost exactly and cut mean error
 *    from 3.28 to 1.47 on the badge, and from 11.1 to 4.3 on the illustration.
 *    On a photo it was worse (9.9 to 15.3), so Poster kept the quantizer; since
 *    #53 it quantizes with Inlay (quantizePalette, k-means in OKLab).
 */
import { presets, type PresetName, type TraceOptions } from 'inlaytrace'

export type PresetId = 'logo' | 'illustration' | 'outline' | 'lineart' | 'centerline' | 'photo' | 'pixel'

export type Settings = {
  preset: PresetId
  /** Colour modes only. */
  colors: number
  /** Line art only: 0–255, the image's own ink/paper split when 'auto', or adaptive when null. */
  threshold: number | 'auto' | null
  /** Line art only: trace light ink on a dark background (inverts before tracing). */
  lightInk: boolean
  speckle: number
  smoothing: number
  corners: number
  shapes: 'stacked' | 'cutout'
  /** Flat-art presets: draw circles, ellipses, (rounded) rectangles and regular polygons exactly. */
  exact: boolean
  /** Centerline only: the stroke width in px, or 0 to use the width measured from the ink. */
  strokeWidth: number
  /**
   * Colours folded into others before tracing (Logo and Illustration), traced
   * hex → traced hex. A new preset starts with none.
   */
  merge: Record<string, string>
  /** AI steps before tracing (prep.ts): about the image, so a preset keeps them. */
  removeBackground: boolean
  aiUpscale: boolean
  /** Trace an image of 512 px or more at up to twice its size, so 1 px lines and small features survive. */
  fineDetail: boolean
  /** Line art, Centerline and Outline art: join a line's ends across small breaks before tracing (gaps.ts). */
  closeGaps: boolean
  /** Flat-art presets: make soft, blurry edges hard before tracing, so the blur doesn't trace as a band round every shape. */
  sharpen: boolean
  /** Flat-art presets: even out painted shading before tracing, so it doesn't break into flecks. */
  smoothShading: boolean
  /** Flat-art presets: darken faint painted outlines before tracing, so the shapes they part don't merge. */
  keepOutlines: boolean
  /** Poster and Illustration: trace in greys only, `colors` of them (#196). */
  grayscale: boolean
  /** Draw text found in the image as type, in the nearest of our fonts, instead of tracing it. */
  recogniseText: boolean
  /**
   * Your own colours (vinyl stock, threads, inks, brand colours), as lowercase
   * #rrggbb. Kept across presets and images, since they're about what you can
   * print, not about this image.
   */
  ownColors: string[]
  /** Trace with only `ownColors` (Logo, Illustration, Outline art, Poster), instead of picking colours from the image. */
  useOwnColors: boolean
}

export type Preset = {
  id: PresetId
  label: string
  hint: string
  defaults: Omit<Settings, 'preset' | 'merge' | 'removeBackground' | 'aiUpscale' | 'fineDetail' | 'sharpen' | 'smoothShading' | 'keepOutlines' | 'grayscale' | 'recogniseText' | 'ownColors' | 'useOwnColors'>
}

/** The app's preset ids; Poster is the package's `poster`. */
const PACKAGE_NAME: Record<PresetId, PresetName> = { logo: 'logo', illustration: 'illustration', outline: 'outline', lineart: 'lineart', centerline: 'centerline', photo: 'poster', pixel: 'pixel' }

/** A preset's defaults, read from the package (#162) so the two can't drift: the fitting tolerance shown as the 0–3 Smoothing slider. */
function defaultsOf(id: PresetId): Preset['defaults'] {
  const p = presets[PACKAGE_NAME[id]]
  return {
    colors: p.colors ?? 2,
    threshold: p.threshold === undefined ? null : p.threshold,
    lightInk: false,
    closeGaps: !!p.closeGaps,
    speckle: p.speckle ?? 0,
    smoothing: smoothingFor(p.tolerance ?? 1),
    corners: p.cornerAngle ?? 45,
    shapes: p.layers === false ? 'cutout' : 'stacked',
    exact: !!p.shapes,
    strokeWidth: 0,
  }
}

export const PRESETS: Preset[] = [
  { id: 'logo', label: 'Logo', hint: 'Few flat colours, crisp corners', defaults: defaultsOf('logo') },
  { id: 'illustration', label: 'Illustration', hint: 'More colours, smooth curves', defaults: defaultsOf('illustration') },
  { id: 'outline', label: 'Outline art', hint: 'Drawn outlines kept as editable lines', defaults: defaultsOf('outline') },
  { id: 'lineart', label: 'Line art', hint: 'Ink drawings and scans, one colour', defaults: defaultsOf('lineart') },
  { id: 'centerline', label: 'Centerline', hint: 'Single strokes for plotters and engraving', defaults: defaultsOf('centerline') },
  { id: 'photo', label: 'Poster', hint: 'Photos flattened into colour bands', defaults: defaultsOf('photo') },
  { id: 'pixel', label: 'Pixel art', hint: 'Hard edges, nothing smoothed', defaults: defaultsOf('pixel') },
]

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id)!

export const settingsFor = (id: PresetId): Settings => ({ preset: id, ...presetById(id).defaults, merge: {}, removeBackground: false, aiUpscale: false, fineDetail: false, sharpen: false, smoothShading: false, keepOutlines: false, grayscale: false, recogniseText: false, ownColors: [], useOwnColors: false })

/** Presets that can close small gaps in their lines (gaps.ts). */
export const closesGaps = (id: PresetId) => id === 'lineart' || id === 'centerline' || id === 'outline'

/** One ink, thresholded: line art and centerline. */
export const isInk = (id: PresetId) => id === 'lineart' || id === 'centerline'

/** Exact shapes: the flat-art presets (a photo has none, and pixel art keeps its staircase). */
/**
 * Presets that draw recognised text as type, in its own colour: the colour ones.
 * Not Line art (one ink, which the text's colour would break), Centerline
 * (strokes) or Pixel art.
 */
export const canSetText = (id: PresetId) => id === 'logo' || id === 'illustration' || id === 'outline' || id === 'photo'

export const hasExactShapes = (id: PresetId) => id === 'logo' || id === 'illustration' || id === 'outline' || id === 'lineart'

/** Evening out painted shading: the presets whose palettes are histogram peaks. */
export const canSmooth = (id: PresetId) => id === 'logo' || id === 'illustration' || id === 'outline'

/** Tracing in greys (#196): Poster and Illustration, like Illustrator's Grayscale mode. */
export const canGrayscale = (id: PresetId) => id === 'photo' || id === 'illustration'

/** Merging colours: the flat-art presets, whose palettes are real colours (Poster's are cluster averages). */
export const canMerge = (id: PresetId) => id === 'logo' || id === 'illustration' || id === 'outline' || id === 'pixel'

/** Tracing to your own colours: the colour presets, whose palettes are picked (Pixel art keeps its exact colours). */
export const canOwnColors = (id: PresetId) => id === 'logo' || id === 'illustration' || id === 'outline' || id === 'photo'

/** At most this many of your own colours, as many as the Colours slider allows. */
export const MAX_OWN_COLORS = 64

/** The colours to trace with, when tracing to your own colours is on and offered for this preset; else null. */
export const ownPaletteOf = (s: Settings): string[] | null => (s.useOwnColors && canOwnColors(s.preset) && s.ownColors.length ? s.ownColors : null)

/**
 * Smoothing 0–3 → fitting tolerance in px. The Logo default (1.5) lands on
 * 1 px, which on the sample badge beat VTracer on accuracy with 30% fewer nodes.
 */
export const toleranceFor = (smoothing: number) => 0.25 + 0.5 * smoothing

/** The Smoothing slider's value for a fitting tolerance: `toleranceFor`'s inverse. */
export function smoothingFor(tolerance: number) {
  return Math.round(((tolerance - 0.25) / 0.5) * 100) / 100
}

/** What the worker traces with: the package's options (#162), every one set from the UI. */
export type { TraceOptions }

/**
 * Translate the UI's settings into the package's trace options. Every preset
 * is Inlay now; they differ in how the palette is picked and how shapes are
 * drawn, which the package's preset carries. Poster moved from VTracer in #53,
 * where on three photos it was 17% closer to the photo with 57% fewer shapes
 * and a 30% smaller file.
 *
 * `scale` is how many times the image was enlarged for tracing (a small
 * image upscaled, or HD's full size); Outline art's line widths grow with it.
 */
export function toTraceOptions(s: Settings, scale = 1): TraceOptions {
  // `shapes` is always given: left out, the package's default (on for flat art) would win over the setting.
  // `scale` only where it changes something: line widths (Outline art), gap sizes, how wide an outline is looked for, and how soft an enlarged image may be before it's sharpened.
  const scaled = scale > 1 && (s.preset === 'outline' || (isInk(s.preset) && s.closeGaps) || (canSmooth(s.preset) && (s.keepOutlines || s.sharpen)))
  const fit = { preset: PACKAGE_NAME[s.preset], speckle: s.speckle, tolerance: toleranceFor(s.smoothing), cornerAngle: s.corners, shapes: s.exact && hasExactShapes(s.preset), ...(scaled ? { scale } : {}) }
  // Like `shapes`, `closeGaps` is given whenever the preset closes gaps by default, so unticking it holds.
  const gaps = closesGaps(s.preset) ? { closeGaps: s.closeGaps } : {}
  if (isInk(s.preset)) return { ...fit, threshold: s.threshold, ...gaps, ...(s.lightInk ? { invert: true } : {}), ...(s.preset === 'centerline' && s.strokeWidth > 0 ? { strokeWidth: s.strokeWidth } : {}) }
  const merge = canMerge(s.preset) && Object.keys(s.merge ?? {}).length ? { merge: s.merge } : {}
  // Your own colours replace the picked palette (and gradients go off with them: the package sees to that).
  const own = ownPaletteOf(s)
  const colour = { ...fit, colors: s.colors, ...merge, ...(own ? { palette: [...own] } : {}) }
  if (s.preset === 'pixel') return colour
  const grey = s.grayscale && canGrayscale(s.preset) && !own ? { grayscale: true } : {}
  if (s.preset === 'photo') return { ...colour, layers: s.shapes === 'stacked', ...grey }
  // Logo, Illustration and Outline art. Gradients come with layers in Illustration and Outline art; cut out is for cutters, which can't draw them.
  return { ...colour, layers: s.shapes === 'stacked', ...gaps, ...(s.preset === 'outline' ? { strokes: true } : {}), ...(s.sharpen ? { sharpen: true } : {}), ...(s.smoothShading ? { smoothShading: true } : {}), ...(s.keepOutlines ? { keepOutlines: true } : {}), ...grey }
}

/** Pixel art keeps every source pixel; everything else is traced at this size at most. */
export const maxTraceEdge = (preset: PresetId) => (preset === 'pixel' ? 4096 : 2048)
