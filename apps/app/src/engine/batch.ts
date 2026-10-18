/**
 * Batch tracing: many images, one preset, one zip. Each image is decoded here
 * (a canvas, as for one image), traced and optimised in a worker of the
 * batch's own, so the page and the image on screen carry on as normal, and
 * only one image's pixels are held at a time.
 */
import { zipSync, strToU8 } from 'fflate'
import { loadSource, pixelsOf } from '../lib/image'
import type { TraceClient } from './client'
import { maxTraceEdge, toTraceOptions, type Settings } from './presets'

/** The name an image's SVG gets in the zip: its own, with -2, -3… for repeats. */
export function zipName(file: string, index: number, used: Set<string>) {
  const base = file.replace(/\.[^.]+$/, '') || `image-${index + 1}`
  let name = `${base}.svg`
  for (let k = 2; used.has(name); k++) name = `${base}-${k}.svg`
  used.add(name)
  return name
}

/** SVGs are already vectors: a batch skips them. */
export const isSvgFile = (file: { name: string; type: string }) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)

export type BatchItem = { name: string; state: 'waiting' | 'tracing' | 'done' | 'skipped' | 'failed'; bytes?: number; message?: string }

/**
 * Trace every file with `settings` and return the zip (null if cancelled).
 * `update` hears each item's state as it changes; `cancelled` is checked
 * between images.
 */
export async function runBatch(files: File[], settings: Settings, client: TraceClient, update: (index: number, item: BatchItem) => void, cancelled: () => boolean): Promise<Uint8Array | null> {
  const out: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  for (const [i, file] of files.entries()) {
    if (cancelled()) return null
    if (isSvgFile(file)) {
      update(i, { name: file.name, state: 'skipped', message: 'already an SVG' })
      continue
    }
    update(i, { name: file.name, state: 'tracing' })
    try {
      const source = await loadSource(file, file.name)
      let pixels
      try {
        pixels = pixelsOf(source, maxTraceEdge(settings.preset), settings.preset !== 'pixel')
      } finally {
        source.bitmap.close()
        URL.revokeObjectURL(source.url)
      }
      const { rgba, width, height } = pixels
      const traced = await client.trace(rgba, width, height, toTraceOptions(settings))
      if (!traced) return null
      if (traced.type !== 'traced') throw new Error(traced.type === 'error' ? traced.message : 'The trace stopped.')
      const optimised = await client.optimize(traced.svg)
      if (!optimised) return null
      const svg = optimised.type === 'optimized' ? optimised.svg : traced.svg
      // Two files with the same name keep both: "logo.svg", "logo-2.svg".
      const name = zipName(file.name, i, used)
      out[name] = strToU8(svg)
      update(i, { name: file.name, state: 'done', bytes: out[name].length })
    } catch (error) {
      update(i, { name: file.name, state: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }
  return Object.keys(out).length ? zipSync(out, { level: 6 }) : new Uint8Array(0)
}
