/**
 * One trace, from options to SVG markup: the worker calls this, and so do the
 * tests, so the two can't drift apart. Every preset is Inlay (packages/inlay).
 */
import { exactPalette, peakPalette, quantizePalette, traceCenterline, traceInlay } from 'inlaytrace'
import type { TraceOptions } from './presets'

const PALETTES = { peak: peakPalette, exact: exactPalette, quantize: quantizePalette }

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
  const palette = PALETTES[o.palette ?? 'peak'](pixels, o.colors ?? 8)
  return traceInlay(pixels, width, height, { ...fit, mode: 'palette', palette, merge: o.merge })
}
