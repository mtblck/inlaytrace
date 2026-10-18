import { useEffect, useRef, useState } from 'react'
import { TraceClient } from '../engine/client'
import { runBatch, type BatchItem } from '../engine/batch'
import { presetById, type Settings } from '../engine/presets'
import { formatBytes } from '../lib/svg'

/**
 * Several images dropped or chosen at once: trace them all with the current
 * preset and settings, then download one zip. Nothing on screen changes; the
 * batch runs on a worker of its own and can be stopped.
 */
export function BatchDialog({ files, settings, onClose, onSave }: { files: File[]; settings: Settings; onClose: () => void; onSave: (zip: Blob) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [items, setItems] = useState<BatchItem[]>(() => files.map((f) => ({ name: f.name, state: 'waiting' })))
  const [phase, setPhase] = useState<'ready' | 'running' | 'done' | 'stopped'>('ready')
  const [zip, setZip] = useState<Uint8Array | null>(null)
  const run = useRef<{ client: TraceClient; cancelled: boolean } | null>(null)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
    return () => {
      run.current?.client.dispose()
    }
  }, [])

  const start = async () => {
    const r = { client: new TraceClient(), cancelled: false }
    run.current = r
    setPhase('running')
    setItems(files.map((f) => ({ name: f.name, state: 'waiting' })))
    const result = await runBatch(files, settings, r.client, (i, item) => !r.cancelled && setItems((cur) => cur.map((x, k) => (k === i ? item : x))), () => r.cancelled)
    r.client.dispose()
    if (r.cancelled || !result) return
    setZip(result)
    setPhase('done')
  }
  const stop = () => {
    if (run.current) {
      run.current.cancelled = true
      run.current.client.dispose()
    }
    setPhase('stopped')
  }
  const close = () => {
    if (phase === 'running') stop()
    ref.current?.close()
    onClose()
  }

  const done = items.filter((i) => i.state === 'done').length
  const finished = items.filter((i) => i.state !== 'waiting' && i.state !== 'tracing').length
  const preset = presetById(settings.preset).label
  return (
    <dialog
      ref={ref}
      aria-labelledby="batch-title"
      onCancel={(e) => {
        e.preventDefault()
        close()
      }}
      className="m-auto max-h-[85vh] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-rule bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/30"
      data-batch=""
    >
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 id="batch-title" className="font-display text-[24px] leading-none">
          Trace {files.length} images
        </h2>
        <button className="btn h-7 px-2 text-[12.5px]" onClick={close}>
          Close
        </button>
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="text-[13px]">
          Each image is traced with the <strong>{preset}</strong> preset and the settings you have now, optimised as a download would be, and put in one zip. The image on screen
          isn't touched. Everything runs in this browser.
        </p>
        <ul className="divide-y divide-rule-soft rounded-md border border-rule text-[13px]" aria-label="Images">
          {items.map((it, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-1.5" data-batch-item={it.state}>
              <span className="truncate">{it.name}</span>
              <span className={`num shrink-0 text-[12px] ${it.state === 'failed' ? 'text-accent' : 'text-ink-muted'}`}>
                {it.state === 'waiting' && (phase === 'running' ? 'Waiting' : '')}
                {it.state === 'tracing' && 'Tracing…'}
                {it.state === 'done' && formatBytes(it.bytes ?? 0)}
                {it.state === 'skipped' && `Skipped: ${it.message}`}
                {it.state === 'failed' && `Failed: ${it.message}`}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-ink-muted" role="status">
            {phase === 'running' && `${finished} of ${files.length}`}
            {phase === 'done' && `${done} traced${done < files.length ? `, ${files.length - done} not` : ''}.`}
            {phase === 'stopped' && 'Stopped.'}
          </span>
          <div className="flex gap-2">
            {phase === 'running' ? (
              <button className="btn" onClick={stop}>
                Stop
              </button>
            ) : (
              <button className="btn" onClick={start}>
                {phase === 'ready' ? 'Trace all' : 'Trace again'}
              </button>
            )}
            <button className="btn btn-primary" disabled={phase !== 'done' || !zip || !zip.length} onClick={() => zip && onSave(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }))}>
              Download zip
            </button>
          </div>
        </div>
      </div>
    </dialog>
  )
}
