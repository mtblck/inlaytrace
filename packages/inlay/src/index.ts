/**
 * Inlay: a raster-to-vector tracer whose shapes share their edges exactly,
 * like inlaid wood. Every boundary between two colours is traced and fitted
 * once and used by both neighbours, so layers never gap or overlap.
 *
 * Pure TypeScript, no DOM: runs in browsers, workers and Node.
 */
export { trace, traceInlay, toSvg, type InlayOptions, type InlayPath, type InlayResult } from './inlay'
export { peakPalette, exactPalette, oklab, type Rgb } from './palette'
export { fitChain, isFlat, pointAt, type Cubic, type FitOptions } from './fit'
export { parsePath, serializePath, mapPoints, type Pt, type PathNode, type Subpath } from './path'
// Internals the app's tests reach for; not part of the stable API.
export { mergeLabels, otsu, staircase } from './inlay'
