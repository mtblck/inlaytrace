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
  speckle: number
  smoothing: number
  corners: number
  shapes: 'stacked' | 'cutout'
}

export type Preset = {
  id: PresetId
  label: string
  hint: string
  defaults: Omit<Settings, 'preset'>
}

export const PRESETS: Preset[] = [
  {
    id: 'logo',
    label: 'Logo',
    hint: 'Few flat colours, crisp corners',
    defaults: { colors: 8, threshold: null, speckle: 8, smoothing: 1.5, corners: 60, shapes: 'cutout' },
  },
  {
    id: 'illustration',
    label: 'Illustration',
    hint: 'More colours, smooth curves',
    defaults: { colors: 16, threshold: null, speckle: 4, smoothing: 1, corners: 60, shapes: 'stacked' },
  },
  {
    id: 'lineart',
    label: 'Line art',
    hint: 'Ink drawings and scans, one colour',
    defaults: { colors: 2, threshold: null, speckle: 6, smoothing: 1, corners: 60, shapes: 'stacked' },
  },
  {
    id: 'photo',
    label: 'Poster',
    hint: 'Photos flattened into colour bands',
    defaults: { colors: 24, threshold: null, speckle: 8, smoothing: 1, corners: 90, shapes: 'stacked' },
  },
  {
    id: 'pixel',
    label: 'Pixel art',
    hint: 'Hard edges, nothing smoothed',
    defaults: { colors: 32, threshold: null, speckle: 0, smoothing: 0, corners: 0, shapes: 'stacked' },
  },
]

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id)!

export const settingsFor = (id: PresetId): Settings => ({ preset: id, ...presetById(id).defaults })

/** Translate the UI's settings into VTracer's option object. */
export function toVtracerOptions(s: Settings): Record<string, unknown> {
  const o: Record<string, unknown> = {
    filterSpeckle: s.speckle,
    hierarchical: s.shapes,
  }
  if (s.preset === 'pixel') {
    o.mode = 'pixel'
    o.maxColors = s.colors
    return o
  }
  o.mode = 'spline'
  o.cornerThreshold = s.corners
  // Merge near-identical colour layers. Large win on flat art, a loss on photos.
  if (s.preset === 'logo') o.layerDifference = 32
  if (s.smoothing > 0) o.simplify = s.smoothing
  if (s.preset === 'lineart') {
    o.clustering = 'bw'
    if (s.threshold === null) o.adaptive = true
    else o.binaryThreshold = s.threshold
  } else if (s.preset === 'photo') {
    o.maxColors = s.colors
  } else {
    // Logos and illustrations: the worker picks the palette from histogram
    // peaks (src/lib/palette.ts) and hands VTracer a fixed palette.
    o.peakColors = s.colors
  }
  return o
}

/** Pixel art keeps every source pixel; everything else is traced at this size at most. */
export const maxTraceEdge = (preset: PresetId) => (preset === 'pixel' ? 4096 : 2048)
