/**
 * One trace, from options to SVG markup: the worker calls this, and so do the
 * tests, so the two can't drift apart. VTracer must already be initialised
 * when a VTracer preset runs (the shared-edge tracer needs no setup).
 */
import { vectorize_rgba } from './vtracer/vtracer.js'
import { exactPalette, peakPalette } from '../lib/palette'
import { traceInlay } from './inlay'

export const needsVtracer = (options: Record<string, unknown>) => options.engine !== 'inlay'

export function runTrace(pixels: Uint8Array, width: number, height: number, options: Record<string, unknown>): string {
  const { peakColors, invert, engine, ...rest } = options
  // Light ink on dark: line art always traces the dark side, so flip the
  // image first. The traced shapes are then the light areas.
  if (invert)
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 255 - pixels[i]
      pixels[i + 1] = 255 - pixels[i + 1]
      pixels[i + 2] = 255 - pixels[i + 2]
    }
  if (engine === 'inlay') {
    const o = rest as { mode: 'palette' | 'binary'; speckle: number; tolerance: number; cornerAngle: number; threshold?: number | null; merge?: Record<string, string>; pixels?: boolean }
    const fit = { speckle: o.speckle, tolerance: o.tolerance, cornerAngle: o.cornerAngle, pixels: !!o.pixels }
    return o.mode === 'binary'
      ? traceInlay(pixels, width, height, { ...fit, mode: 'binary', threshold: o.threshold ?? null })
      : traceInlay(pixels, width, height, { ...fit, mode: 'palette', palette: (o.pixels ? exactPalette : peakPalette)(pixels, Number(peakColors)), merge: o.merge })
  }
  if (typeof peakColors === 'number') rest.palette = peakPalette(pixels, peakColors)
  return vectorize_rgba(pixels, width, height, rest)
}
