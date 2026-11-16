/**
 * Inlay: a raster-to-vector tracer whose shapes share their edges exactly,
 * like inlaid wood. Every boundary between two colours is traced and fitted
 * once and used by both neighbours, so layers never gap or overlap.
 *
 * Pure TypeScript, no DOM: runs in browsers, workers and Node.
 */
export { trace, traceAsync, traceInlay, presets, type TraceOptions, type TraceAsyncOptions, type AbortSignalLike, type ImageLike, type PresetName, type PresetDefaults } from './presets'
export { toSvg, type InlayOptions, type InlayPath, type InlayResult, type TraceStage, type TraceStep } from './inlay'
export type { Gradient, GradientStop } from './gradient'
export { peakPalette, exactPalette, quantizePalette, oklab, type Rgb } from './palette'
export { boostLines, smoothShading } from './smooth'
export { centerline, traceCenterline, centerlineToSvg, type CenterlineOptions, type CenterlineResult } from './centerline'
export { detectSymmetry, type Symmetry, type MirrorSymmetry, type RotationalSymmetry, type SymmetryOptions } from './symmetry'
export { fitChain, isFlat, pointAt, type Cubic, type FitOptions } from './fit'
export { parsePath, serializePath, mapPoints, type Pt, type PathNode, type Subpath } from './path'
