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
  /** Draw text found in the image as type, in the nearest of our fonts, instead of tracing it. */
  recogniseText: boolean
}

export type Preset = {
  id: PresetId
  label: string
  hint: string
  defaults: Omit<Settings, 'preset' | 'merge' | 'removeBackground' | 'aiUpscale' | 'recogniseText'>
}

/** Illustration's defaults, which Outline art shares: it differs only in tracing lines as strokes. */
const ILLUSTRATION: Preset['defaults'] = { colors: 16, threshold: null, lightInk: false, speckle: 4, smoothing: 1, corners: 60, shapes: 'stacked', exact: true, strokeWidth: 0 }

export const PRESETS: Preset[] = [
  {
    id: 'logo',
    label: 'Logo',
    hint: 'Few flat colours, crisp corners',
    defaults: { colors: 8, threshold: null, lightInk: false, speckle: 8, smoothing: 1.5, corners: 45, shapes: 'cutout', exact: true, strokeWidth: 0 },
  },
  {
    id: 'illustration',
    label: 'Illustration',
    hint: 'More colours, smooth curves',
    defaults: ILLUSTRATION,
  },
  {
    id: 'outline',
    label: 'Outline art',
    hint: 'Drawn outlines kept as editable lines',
    defaults: ILLUSTRATION,
  },
  {
    id: 'lineart',
    label: 'Line art',
    hint: 'Ink drawings and scans, one colour',
    defaults: { colors: 2, threshold: 'auto', lightInk: false, speckle: 6, smoothing: 1.5, corners: 45, shapes: 'stacked', exact: true, strokeWidth: 0 },
  },
  {
    id: 'centerline',
    label: 'Centerline',
    hint: 'Single strokes for plotters and engraving',
    defaults: { colors: 2, threshold: 'auto', lightInk: false, speckle: 4, smoothing: 1.5, corners: 45, shapes: 'stacked', exact: false, strokeWidth: 0 },
  },
  {
    id: 'photo',
    label: 'Poster',
    hint: 'Photos flattened into colour bands',
    defaults: { colors: 24, threshold: null, lightInk: false, speckle: 8, smoothing: 1, corners: 90, shapes: 'stacked', exact: false, strokeWidth: 0 },
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    hint: 'Hard edges, nothing smoothed',
    defaults: { colors: 32, threshold: null, lightInk: false, speckle: 0, smoothing: 0, corners: 0, shapes: 'stacked', exact: false, strokeWidth: 0 },
  },
]

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id)!

export const settingsFor = (id: PresetId): Settings => ({ preset: id, ...presetById(id).defaults, merge: {}, removeBackground: false, aiUpscale: false, recogniseText: false })

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

/** Merging colours: the flat-art presets, whose palettes are real colours (Poster's are cluster averages). */
export const canMerge = (id: PresetId) => id === 'logo' || id === 'illustration' || id === 'outline' || id === 'pixel'

/**
 * Smoothing 0–3 → fitting tolerance in px. The Logo default (1.5) lands on
 * 1 px, which on the sample badge beat VTracer on accuracy with 30% fewer nodes.
 */
export const toleranceFor = (smoothing: number) => 0.25 + 0.5 * smoothing

/** What the worker traces with (run.ts turns it into Inlay's options). */
export type TraceOptions = {
  mode: 'palette' | 'binary' | 'centerline'
  speckle: number
  tolerance: number
  cornerAngle: number
  /** Palette mode: how many colours, and how they're picked from the image. */
  colors?: number
  palette?: 'peak' | 'exact' | 'quantize'
  merge?: Record<string, string>
  pixels?: boolean
  stacked?: boolean
  /** Draw circles, ellipses, (rounded) rectangles and regular polygons exactly. */
  shapes?: boolean
  /** Palette mode: trace thin outlines as stroked lines. */
  strokes?: boolean
  /** With strokes: how many times the image was enlarged for tracing, so line widths scale with it. */
  scale?: number
  /** Palette mode: soft shading as gradient fills (Illustration and Outline art, stacked). */
  gradients?: boolean
  /** Centerline mode: the stroke width in px; measured when left out. */
  strokeWidth?: number
  /** Binary and centerline modes. */
  threshold?: number | 'auto' | null
  invert?: boolean
}

/**
 * Translate the UI's settings into the worker's trace options. Every preset
 * is Inlay now; they differ in how the palette is picked and how shapes are
 * drawn. Poster moved from VTracer in #53, where on three photos it was 17%
 * closer to the photo with 57% fewer shapes and a 30% smaller file.
 *
 * `scale` is how many times the image was enlarged for tracing (a small
 * image upscaled, or HD's full size); Outline art's line widths grow with it.
 */
export function toTraceOptions(s: Settings, scale = 1): TraceOptions {
  const fit = { speckle: s.speckle, tolerance: toleranceFor(s.smoothing), cornerAngle: s.corners, ...(s.exact && hasExactShapes(s.preset) ? { shapes: true } : {}) }
  if (s.preset === 'centerline') return { ...fit, mode: 'centerline', threshold: s.threshold, ...(s.strokeWidth > 0 ? { strokeWidth: s.strokeWidth } : {}), ...(s.lightInk ? { invert: true } : {}) }
  if (s.preset === 'lineart') return { ...fit, mode: 'binary', threshold: s.threshold, ...(s.lightInk ? { invert: true } : {}) }
  const merge = Object.keys(s.merge ?? {}).length ? { merge: s.merge } : {}
  // Pixel art: its exact colours, every pixel kept, boundaries as pixel staircases.
  if (s.preset === 'pixel') return { ...fit, mode: 'palette', colors: s.colors, palette: 'exact', pixels: true, ...merge }
  // Poster: photos have no histogram peaks, so the palette is quantized (k-means in OKLab), and shapes stack by default.
  if (s.preset === 'photo') return { ...fit, mode: 'palette', colors: s.colors, palette: 'quantize', stacked: s.shapes === 'stacked' }
  // Logo, Illustration and Outline art: flat art's real colours are the histogram's peaks.
  // Outline art traces its thin outlines as stroked lines, the fills meeting beneath them.
  // Illustration and Outline art, stacked, draw soft shading as gradients; cut out is for cutters, which can't.
  const gradients = s.shapes === 'stacked' && (s.preset === 'illustration' || s.preset === 'outline') ? { gradients: true } : {}
  return { ...fit, mode: 'palette', colors: s.colors, palette: 'peak', stacked: s.shapes === 'stacked', ...merge, ...gradients, ...(s.preset === 'outline' ? { strokes: true, ...(scale > 1 ? { scale } : {}) } : {}) }
}

/** Pixel art keeps every source pixel; everything else is traced at this size at most. */
export const maxTraceEdge = (preset: PresetId) => (preset === 'pixel' ? 4096 : 2048)
