/**
 * VTracer, as a benchmark only: the app traced photos with it until #53, and
 * `npm run score`, `npm run score:photos`, `npm run site:assets` and two tests
 * still compare Inlay against it. Nothing that ships uses it.
 *
 * The official package (@visioncortex/vtracer, MIT OR Apache-2.0) is a Node
 * build, so Node loads it as it is: no vendoring, no WebAssembly in the app.
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Under the tests' jsdom environment import.meta.url isn't a file: URL, so fall
// back to the working directory (npm scripts and vitest run from the repo root).
const require = createRequire(import.meta.url.startsWith('file:') ? import.meta.url : pathToFileURL(`${process.cwd()}/`).href)
const { vectorize_rgba } = require('@visioncortex/vtracer/pkg/vtracer_wasm.js')

/** Trace RGBA pixels with VTracer's own options (camelCase, as its wasm binding takes them) to SVG markup. */
export function vtracer(rgba, width, height, options) {
  return vectorize_rgba(rgba, width, height, options)
}
