/**
 * One trace, from options to SVG markup: the worker calls this, and so do the
 * tests, so the two can't drift apart. Every preset is Inlay (packages/inlay).
 */
import { exactPalette, peakPalette, quantizePalette, traceCenterline, traceInlay } from 'inlaytrace'
import type { TraceOptions } from './presets'

const PALETTES = { peak: peakPalette, exact: exactPalette, quantize: quantizePalette }

/** Below this share of opaque pixels in its exact colours, an image isn't treated as pixel art. */
const EXACT_COVERAGE = 0.9

/** The share of opaque pixels whose colour is exactly one of `palette`. */
function coverage(pixels: Uint8Array, palette: string[]) {
  const set = new Set(palette.map((hex) => parseInt(hex.slice(1), 16)))
  let opaque = 0
  let hit = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    opaque++
    if (set.has((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2])) hit++
  }
  return opaque ? hit / opaque : 1
}

export function runTrace(pixels: Uint8Array, width: number, height: number, o: TraceOptions): string {
  // Light ink on dark: line art and centerline always trace the dark side, so
  // flip the image first. The traced shapes are then the light areas.
  if (o.invert)
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 255 - pixels[i]
      pixels[i + 1] = 255 - pixels[i + 1]
      pixels[i + 2] = 255 - pixels[i + 2]
    }
  const fit = { speckle: o.speckle, tolerance: o.tolerance, cornerAngle: o.cornerAngle, pixels: !!o.pixels, stacked: !!o.stacked, shapes: !!o.shapes }
  if (o.mode === 'centerline') return traceCenterline(pixels, width, height, { threshold: o.threshold ?? null, speckle: o.speckle, tolerance: o.tolerance, cornerAngle: o.cornerAngle, strokeWidth: o.strokeWidth })
  if (o.mode === 'binary') return traceInlay(pixels, width, height, { ...fit, mode: 'binary', threshold: o.threshold ?? null })
  let palette = PALETTES[o.palette ?? 'peak'](pixels, o.colors ?? 8)
  // Pixel art is its exact colours, which cover all of it. When they cover
  // little (a photo, or art saved as JPEG), the most common exact colours are
  // near-copies of the commonest one: a photo's 32 were all black and grey.
  // Then cluster instead, as Poster does; the edges stay pixel-exact.
  if (o.palette === 'exact' && coverage(pixels, palette) < EXACT_COVERAGE) palette = quantizePalette(pixels, o.colors ?? 8)
  return traceInlay(pixels, width, height, { ...fit, mode: 'palette', palette, merge: o.merge })
}
