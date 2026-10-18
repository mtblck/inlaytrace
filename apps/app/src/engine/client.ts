/**
 * Main-thread side of the tracing worker.
 *
 * Dragging a slider fires many requests a second, and a trace can take seconds.
 * Queuing them all would leave the preview minutes behind the slider. Instead
 * each channel (trace, optimize) holds at most one waiting request: a new one
 * replaces whatever was waiting, and the worker only ever starts the latest.
 * Superseded requests resolve with `null` so callers can simply ignore them.
 */
import type { TraceOptions } from './presets'
import type { WorkerRequest, WorkerResponse } from './worker'

type Channel = 'trace' | 'optimize' | 'symmetry'
type Pending = { request: WorkerRequest; resolve: (r: WorkerResponse | null) => void }

export class TraceClient {
  private worker?: Worker
  private nextId = 1
  private busy = false
  private inFlight?: Pending
  private waiting = new Map<Channel, Pending>()

  /**
   * Created on first use, and again after dispose(): React StrictMode runs
   * effect cleanups once in development, which would otherwise leave the app
   * holding a terminated worker.
   */
  private ensureWorker() {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      this.inFlight?.resolve(e.data)
      this.inFlight = undefined
      this.busy = false
      this.pump()
    }
    worker.onerror = (e) => {
      this.inFlight?.resolve({ type: 'error', id: this.inFlight.request.id, message: e.message || 'The tracing worker failed to start.' })
      this.inFlight = undefined
      this.busy = false
      this.pump()
    }
    this.worker = worker
    return worker
  }

  trace(rgba: Uint8ClampedArray, width: number, height: number, options: TraceOptions) {
    // Copy rather than transfer: the caller keeps its pixels for the next trace.
    const buffer = rgba.slice().buffer
    return this.send('trace', { type: 'trace', id: this.nextId++, rgba: buffer, width, height, options })
  }

  /** Look for mirror and rotational symmetry in the pixels the trace uses. */
  symmetry(rgba: Uint8ClampedArray, width: number, height: number) {
    return this.send('symmetry', { type: 'symmetry', id: this.nextId++, rgba: rgba.slice().buffer, width, height })
  }

  optimize(svg: string) {
    return this.send('optimize', { type: 'optimize', id: this.nextId++, svg })
  }

  dispose() {
    this.worker?.terminate()
    this.worker = undefined
    this.inFlight?.resolve(null)
    this.inFlight = undefined
    this.busy = false
  }

  private send(channel: Channel, request: WorkerRequest) {
    return new Promise<WorkerResponse | null>((resolve) => {
      this.waiting.get(channel)?.resolve(null)
      this.waiting.set(channel, { request, resolve })
      this.pump()
    })
  }

  private pump() {
    if (this.busy) return
    // Traces first: an optimize of a stale trace is wasted work. Symmetry last:
    // it's only needed once the Mirror tool opens.
    const channel = (['trace', 'optimize', 'symmetry'] as const).find((c) => this.waiting.has(c))
    if (!channel) return
    const next = this.waiting.get(channel)!
    this.waiting.delete(channel)
    this.busy = true
    this.inFlight = next
    const transfer = next.request.type === 'trace' || next.request.type === 'symmetry' ? [next.request.rgba] : []
    this.ensureWorker().postMessage(next.request, transfer)
  }
}
