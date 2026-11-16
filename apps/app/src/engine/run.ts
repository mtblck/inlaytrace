/**
 * One trace, from options to SVG markup: the worker calls this, and so do the
 * tests, so the two can't drift apart. Every preset is Inlay's own
 * (packages/inlay/src/presets.ts): its palette, its steps before tracing and
 * its defaults live in the package since #162.
 */
import { toSvg, trace } from 'inlaytrace'
import type { TraceOptions } from './presets'

export function runTrace(pixels: Uint8Array, width: number, height: number, o: TraceOptions): string {
  return toSvg(trace({ data: pixels, width, height }, o))
}
