/**
 * Purpose-named presets mapped onto VTracer 1.0 options.
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
 *    On a photo it was worse (9.9 to 15.3), so Poster keeps the quantizer.
 */
export type PresetId = 'logo' | 'illustration' | 'lineart' | 'photo' | 'pixel'

export type Settings = {
  preset: PresetId
  /** Colour modes only. */
  colors: number
  /** Line art only: 0–255, or adaptive when null. */
  threshold: number | null
  /** Line art only: trace light ink on a dark background (inverts before tracing). */
  lightInk: boolean
  speckle: number
  smoothing: number
  corners: number
  shapes: 'stacked' | 'cutout'
  /**
   * Colours folded into others before tracing (Logo and Illustration), traced
   * hex → traced hex. A new preset starts with none.
   */
  merge: Record<string, string>
}

export type Preset = {
  id: PresetId
  label: string
  hint: string
  defaults: Omit<Settings, 'preset' | 'merge'>
}

export const PRESETS: Preset[] = [
  {
    id: 'logo',
    label: 'Logo',
    hint: 'Few flat colours, crisp corners',
    defaults: { colors: 8, threshold: null, lightInk: false, speckle: 8, smoothing: 1.5, corners: 45, shapes: 'cutout' },
  },
  {
    id: 'illustration',
    label: 'Illustration',
    hint: 'More colours, smooth curves',
    defaults: { colors: 16, threshold: null, lightInk: false, speckle: 4, smoothing: 1, corners: 60, shapes: 'stacked' },
  },
  {
    id: 'lineart',
    label: 'Line art',
    hint: 'Ink drawings and scans, one colour',
    defaults: { colors: 2, threshold: 128, lightInk: false, speckle: 6, smoothing: 1.5, corners: 45, shapes: 'stacked' },
  },
  {
    id: 'photo',
    label: 'Poster',
    hint: 'Photos flattened into colour bands',
    defaults: { colors: 24, threshold: null, lightInk: false, speckle: 8, smoothing: 1, corners: 90, shapes: 'stacked' },
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    hint: 'Hard edges, nothing smoothed',
    defaults: { colors: 32, threshold: null, lightInk: false, speckle: 0, smoothing: 0, corners: 0, shapes: 'stacked' },
  },
]

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id)!

export const settingsFor = (id: PresetId): Settings => ({ preset: id, ...presetById(id).defaults, merge: {} })

/** Merging colours needs the shared-edge tracer's palette mode: Logo and Illustration. */
export const canMerge = (id: PresetId) => id === 'logo' || id === 'illustration' || id === 'pixel'

/** Presets traced by the shared-edge tracer (src/engine/inlay.ts) rather than VTracer. */
export const usesInlay = (id: PresetId) => id !== 'photo'

/**
 * Smoothing 0–3 → fitting tolerance in px. The Logo default (1.5) lands on
 * 1 px, which on the sample badge beat VTracer on accuracy with 30% fewer nodes.
 */
export const toleranceFor = (smoothing: number) => 0.25 + 0.5 * smoothing

/**
 * Translate the UI's settings into the worker's trace options: the shared-edge
 * tracer for flat art, VTracer's own options for posters and pixel art.
 */
export function toVtracerOptions(s: Settings): Record<string, unknown> {
  if (usesInlay(s.preset)) {
    const fit = { engine: 'inlay', speckle: s.speckle, tolerance: toleranceFor(s.smoothing), cornerAngle: s.corners }
    if (s.preset === 'lineart') return { ...fit, mode: 'binary', threshold: s.threshold, ...(s.lightInk ? { invert: true } : {}) }
    const merge = Object.keys(s.merge ?? {}).length ? { merge: s.merge } : {}
    // Pixel art: its exact colours, every pixel kept, boundaries as pixel staircases.
    if (s.preset === 'pixel') return { ...fit, mode: 'palette', peakColors: s.colors, pixels: true, ...merge }
    // The worker picks the palette from histogram peaks (src/lib/palette.ts).
    return { ...fit, mode: 'palette', peakColors: s.colors, ...merge }
  }
  const o: Record<string, unknown> = {
    filterSpeckle: s.speckle,
    hierarchical: s.shapes,
  }
  // Poster: VTracer's spline fitting and quantizer suit photos' soft bands.
  o.mode = 'spline'
  o.cornerThreshold = s.corners
  if (s.smoothing > 0) o.simplify = s.smoothing
  o.maxColors = s.colors
  return o
}

/** Pixel art keeps every source pixel; everything else is traced at this size at most. */
export const maxTraceEdge = (preset: PresetId) => (preset === 'pixel' ? 4096 : 2048)
