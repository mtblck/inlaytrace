import { useState } from 'react'
import { costFor } from '../../../../server/pricing'
import { api } from '../account/api'
import type { Settings } from '../engine/presets'
import { hdTrace, type HdProgress } from '../lib/hd'
import { formatBytes } from '../lib/svg'

type Props = {
  /** The image exactly as the app traces it (after any AI steps), at its full size. */
  bitmap: ImageBitmap
  settings: Settings
  /** The long edge the app traces at, for saying what HD adds. */
  traceEdge: number
  onSave: (svg: string) => void
  onOpen: (svg: string) => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'confirm'; balance: number }
  | { kind: 'working'; progress: HdProgress }
  | { kind: 'done'; svg: string }
  | { kind: 'error'; message: string }

const STAGES: Record<HdProgress['stage'], string> = {
  encoding: 'Preparing the image…',
  uploading: 'Uploading',
  running: 'Tracing on the server…',
  downloading: 'Downloading the result',
}

/**
 * HD trace (beta): the same trace at the image's full size, on the server, paid
 * for with credits. Shown only for images bigger than the app traces. Nothing
 * is sent anywhere until the person confirms the cost.
 */
export function Hd(p: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const { width, height } = p.bitmap
  const credits = costFor(width, height)
  const plural = (n: number) => `${n} credit${n === 1 ? '' : 's'}`

  async function check() {
    setPhase({ kind: 'checking' })
    try {
      const a = await api.account()
      setPhase(a.signedIn ? { kind: 'confirm', balance: a.balance } : { kind: 'signedOut' })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function run() {
    setPhase({ kind: 'working', progress: { stage: 'encoding', done: 0, total: 1 } })
    try {
      const svg = await hdTrace(p.bitmap, p.settings, (progress) => setPhase({ kind: 'working', progress }))
      setPhase({ kind: 'done', svg })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <details className="group mt-2" data-hd="">
      <summary className="cursor-pointer list-none text-[12.5px] text-ink-muted select-none hover:text-ink">
        <span className="inline-block transition-transform group-open:rotate-90">›</span> HD trace{' '}
        <span className="rounded-sm border border-rule px-1 text-[10.5px] text-ink-muted">Beta</span>
        <span className="num ml-1.5">
          {width.toLocaleString()} × {height.toLocaleString()}, {plural(credits)}
        </span>
      </summary>
      <div className="mt-2 space-y-2.5 text-[13px]">
        <p className="field-hint">
          Traces this image at its full size, {width.toLocaleString()} × {height.toLocaleString()}, on Inlay’s server, for finer detail than the {p.traceEdge.toLocaleString()} px trace here. Your image is uploaded, traced, and deleted as soon as the result is back.{' '}
          <a href="/pricing/" className="underline underline-offset-2 hover:text-ink">
            HD is in beta
          </a>
          .
        </p>

        {(phase.kind === 'idle' || phase.kind === 'checking') && (
          <button className="btn w-full" disabled={phase.kind === 'checking'} onClick={check}>
            {phase.kind === 'checking' ? 'Checking your account…' : `Trace in HD for ${plural(credits)}`}
          </button>
        )}

        {phase.kind === 'signedOut' && (
          <p>
            HD needs an account: an email address, no password.{' '}
            <a href="/app/account/" className="underline underline-offset-2">
              Sign in
            </a>
            , then come back to this image.
          </p>
        )}

        {phase.kind === 'confirm' &&
          (phase.balance >= credits ? (
            <div className="space-y-2">
              <p>
                You have {plural(phase.balance)}; this uses {credits}. If the trace fails, they come straight back.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-primary" onClick={run}>
                  Start HD trace
                </button>
                <button className="btn" onClick={() => setPhase({ kind: 'idle' })}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p>
              This needs {plural(credits)} and you have {phase.balance}.{' '}
              <a href="/app/buy/" className="underline underline-offset-2">
                Buy credits
              </a>
              , then come back to this image.
            </p>
          ))}

        {phase.kind === 'working' && (
          <p className="num" aria-live="polite">
            {STAGES[phase.progress.stage]}
            {phase.progress.total > 1 && ` (${phase.progress.done + 1} of ${phase.progress.total})`}
            {(phase.progress.stage === 'uploading' || phase.progress.stage === 'downloading') && phase.progress.total === 1 && '…'}
          </p>
        )}

        {phase.kind === 'done' && (
          <div className="space-y-2" role="status">
            <p>HD trace done: {formatBytes(new Blob([phase.svg]).size)}.</p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary" onClick={() => p.onSave(phase.svg)}>
                Download HD
              </button>
              <button className="btn" onClick={() => p.onOpen(phase.svg)}>
                Open to edit
              </button>
            </div>
          </div>
        )}

        {phase.kind === 'error' && (
          <div className="space-y-2">
            <p role="alert">{phase.message}</p>
            <button className="btn w-full" onClick={check}>
              Try again
            </button>
          </div>
        )}
      </div>
    </details>
  )
}
