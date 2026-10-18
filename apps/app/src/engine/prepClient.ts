/**
 * Main-thread side of the AI preparation worker (prep.ts). The worker and the
 * runtime are only created the first time a step is asked for, and the
 * worker is kept, so models load once a session. A new request supersedes
 * the one running: it's terminated (a 4× upscale can take a while), and the
 * superseded promise resolves null.
 */
import type { PrepRequest, PrepResponse, PrepStage } from './prep'

export type Prepared = { rgba: Uint8ClampedArray; width: number; height: number }

export class PrepClient {
  private worker?: Worker
  private nextId = 1
  private pending?: { id: number; resolve: (r: Prepared | Error | null) => void; progress: (stage: PrepStage, done: number, total: number) => void }

  private ensure() {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./prep.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<PrepResponse>) => {
      const m = e.data
      const p = this.pending
      if (!p || m.id !== p.id) return
      if (m.type === 'progress') return p.progress(m.stage, m.done, m.total)
      this.pending = undefined
      p.resolve(m.type === 'prepared' ? { rgba: new Uint8ClampedArray(m.rgba), width: m.width, height: m.height } : new Error(m.message))
    }
    worker.onerror = (e) => {
      const p = this.pending
      this.pending = undefined
      this.stop()
      p?.resolve(new Error(e.message || 'The AI step failed to start.'))
    }
    this.worker = worker
    return worker
  }

  prepare(rgba: Uint8ClampedArray, width: number, height: number, steps: { background: boolean; upscale: boolean }, progress: (stage: PrepStage, done: number, total: number) => void) {
    // Anything still running is for an older request: stop it rather than wait.
    if (this.pending) this.stop()
    return new Promise<Prepared | Error | null>((resolve) => {
      const id = this.nextId++
      this.pending = { id, resolve, progress }
      const buffer = rgba.slice().buffer
      const req: PrepRequest = { type: 'prep', id, rgba: buffer, width, height, ...steps }
      this.ensure().postMessage(req, [buffer])
    })
  }

  /** End the worker, and with it any step in progress. */
  stop() {
    this.worker?.terminate()
    this.worker = undefined
    const p = this.pending
    this.pending = undefined
    p?.resolve(null)
  }
}
