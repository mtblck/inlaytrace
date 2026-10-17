/// <reference lib="webworker" />
/**
 * Tracing and optimisation run here so a multi-second trace never blocks the
 * page. Both are synchronous inside the worker; the client is responsible for
 * making sure only the latest request is ever waiting (see client.ts).
 */
import { init, vectorize_rgba } from './vtracer/vtracer.js'
import wasmUrl from './vtracer/vtracer.wasm?url'
import { peakPalette } from '../lib/palette'

export type WorkerRequest =
  | { type: 'trace'; id: number; rgba: ArrayBuffer; width: number; height: number; options: Record<string, unknown> }
  | { type: 'optimize'; id: number; svg: string }

export type WorkerResponse =
  | { type: 'traced'; id: number; svg: string; ms: number }
  | { type: 'optimized'; id: number; svg: string }
  | { type: 'error'; id: number; message: string }

declare const self: DedicatedWorkerGlobalScope

// SVGO is ~200 KB gzipped and only needed once there is something to export,
// so it is fetched on first use rather than with the worker.
let svgo: Promise<typeof import('svgo/browser')> | undefined

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    if (req.type === 'trace') {
      await init(wasmUrl)
      const start = performance.now()
      const pixels = new Uint8Array(req.rgba)
      const { peakColors, invert, ...options } = req.options
      // Light ink on dark: VTracer's binary mode always traces the dark side,
      // so flip the image first. The traced shapes are then the light areas.
      if (invert) for (let i = 0; i < pixels.length; i += 4) {
        pixels[i] = 255 - pixels[i]
        pixels[i + 1] = 255 - pixels[i + 1]
        pixels[i + 2] = 255 - pixels[i + 2]
      }
      if (typeof peakColors === 'number') options.palette = peakPalette(pixels, peakColors)
      const svg = vectorize_rgba(pixels, req.width, req.height, options)
      post({ type: 'traced', id: req.id, svg, ms: Math.round(performance.now() - start) })
    } else {
      svgo ??= import('svgo/browser')
      const { optimize } = await svgo
      const { data } = optimize(req.svg, {
        multipass: true,
        floatPrecision: 2,
        plugins: ['preset-default'],
      })
      post({ type: 'optimized', id: req.id, svg: data })
    }
  } catch (error) {
    post({ type: 'error', id: req.id, message: error instanceof Error ? error.message : String(error) })
  }
}

const post = (message: WorkerResponse) => self.postMessage(message)
