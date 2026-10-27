/**
 * One trace, from options to SVG markup: the worker calls this, and so do the
 * tests, so the two can't drift apart. Every preset is Inlay (packages/inlay).
 */
import { exactPalette, peakPalette, quantizePalette, traceCenterline, traceInlay } from 'inlaytrace'
import type { TraceOptions } from './presets'

/** Below this share of opaque pixels in its exact colours, an image isn't treated as pixel art. */
const EXACT_COVERAGE = 0.9

/**
 * The share of opaque pixels whose colour is exactly one of `palette`, not
 * counting its first (commonest) colour. A JPEG drawing on a white page is
 * 88% white, so counting the page passed it as pixel art; its other 31
 * "exact" colours were near-whites, and the blue drawing traced as white.
 */
function coverage(pixels: Uint8Array, palette: string[]) {
  const set = new Set(palette.map((hex) => parseInt(hex.slice(1), 16)))
  const first = palette.length ? parseInt(palette[0].slice(1), 16) : -1
  let opaque = 0
  let hit = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    const c = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]
    if (c === first) continue
    opaque++
    if (set.has(c)) hit++
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
  // Peaks are told the width so they can find pale tints by their flatness.
  const colors = o.colors ?? 8
  let palette = o.palette === 'exact' ? exactPalette(pixels, colors) : o.palette === 'quantize' ? quantizePalette(pixels, colors) : peakPalette(pixels, colors, { width })
  // Pixel art is its exact colours, which cover all of it. When they cover
  // little (a photo, or art saved as JPEG), the most common exact colours are
  // near-copies of the commonest one: a photo's 32 were all black and grey.
  // Then cluster instead, as Poster does; the edges stay pixel-exact.
  if (o.palette === 'exact' && coverage(pixels, palette) < EXACT_COVERAGE) palette = quantizePalette(pixels, colors)
  // Poster's clusters get a photo's clean-up; flat art's real colours get flat art's.
  return traceInlay(pixels, width, height, { ...fit, mode: 'palette', palette, merge: o.merge, photo: o.palette === 'quantize', strokes: !!o.strokes })
}
