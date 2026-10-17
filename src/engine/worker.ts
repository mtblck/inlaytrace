/// <reference lib="webworker" />
/**
 * Tracing and optimisation run here so a multi-second trace never blocks the
 * page. Both are synchronous inside the worker; the client is responsible for
 * making sure only the latest request is ever waiting (see client.ts).
 */
import { init } from './vtracer/vtracer.js'
import wasmUrl from './vtracer/vtracer.wasm?url'
import { needsVtracer, runTrace } from './run'

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
      const start = performance.now()
      if (needsVtracer(req.options)) await init(wasmUrl)
      const svg = runTrace(new Uint8Array(req.rgba), req.width, req.height, req.options)
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
