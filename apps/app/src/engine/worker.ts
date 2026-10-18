/// <reference lib="webworker" />
/**
 * Tracing, symmetry detection and optimisation run here so a multi-second trace never blocks the
 * page. Both are synchronous inside the worker; the client is responsible for
 * making sure only the latest request is ever waiting (see client.ts).
 */
import { detectSymmetry, type Symmetry } from 'inlaytrace'
import { runTrace } from './run'
import { SVGO } from './svgo'
import type { Settings, TraceOptions } from './presets'
import { searchSize, type Candidate, type SizeSearch } from './targetSize'

export type WorkerRequest =
  | { type: 'trace'; id: number; rgba: ArrayBuffer; width: number; height: number; options: TraceOptions }
  | { type: 'optimize'; id: number; svg: string }
  | { type: 'symmetry'; id: number; rgba: ArrayBuffer; width: number; height: number }
  | { type: 'size'; id: number; rgba: ArrayBuffer; width: number; height: number; settings: Settings; target: number }

export type WorkerResponse =
  | { type: 'traced'; id: number; svg: string; ms: number }
  | { type: 'optimized'; id: number; svg: string }
  | { type: 'symmetry'; id: number; found: Symmetry[] }
  | { type: 'sized'; id: number; result: SizeSearch }
  /** Sent while a size search runs; the request isn't finished. */
  | { type: 'progress'; id: number; tried: number; best: Candidate }
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
      const svg = runTrace(new Uint8Array(req.rgba), req.width, req.height, req.options)
      post({ type: 'traced', id: req.id, svg, ms: Math.round(performance.now() - start) })
    } else if (req.type === 'size') {
      svgo ??= import('svgo/browser')
      const { optimize } = await svgo
      const measure = (svg: string) => new TextEncoder().encode(optimize(svg, SVGO).data).length
      const result = searchSize(new Uint8Array(req.rgba), req.width, req.height, req.settings, req.target, measure, (tried, best) => post({ type: 'progress', id: req.id, tried, best }))
      post({ type: 'sized', id: req.id, result })
    } else if (req.type === 'symmetry') {
      post({ type: 'symmetry', id: req.id, found: detectSymmetry(new Uint8Array(req.rgba), req.width, req.height) })
    } else {
      svgo ??= import('svgo/browser')
      const { optimize } = await svgo
      const { data } = optimize(req.svg, SVGO)
      post({ type: 'optimized', id: req.id, svg: data })
    }
  } catch (error) {
    post({ type: 'error', id: req.id, message: error instanceof Error ? error.message : String(error) })
  }
}

const post = (message: WorkerResponse) => self.postMessage(message)
