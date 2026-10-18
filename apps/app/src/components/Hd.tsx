import { useState } from 'react'
import { costFor, UPSCALE } from '../../../../server/pricing'
import { api } from '../account/api'
import { refreshAccount, setBalance } from '../account/status'
import type { Settings } from '../engine/presets'
import { hdRun, type HdKind, type HdProgress } from '../lib/hd'
import { formatBytes } from '../lib/svg'

type Props = {
  kind: HdKind
  /** The image exactly as the app traces it (after any AI steps), at its full size. */
  bitmap: ImageBitmap
  settings: Settings
  /** The long edge the app traces at, for saying what HD adds. */
  traceEdge: number
  /** Save the result (an SVG for a trace, a PNG for an upscale). */
  onSave: (result: Blob) => void
  /** Open the result in the app: to edit (a trace) or to trace (an upscale). */
  onOpen: (result: Blob) => void
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'signedOut' }
  | { kind: 'confirm'; balance: number }
  | { kind: 'working'; progress: HdProgress }
  | { kind: 'done'; result: Blob }
  | { kind: 'error'; message: string }

const STAGES: Record<HdProgress['stage'], string> = {
  encoding: 'Preparing the image…',
  uploading: 'Uploading',
  running: 'Working on the server…',
  downloading: 'Downloading the result',
}

const n = (x: number) => x.toLocaleString()
const plural = (c: number) => `${c} credit${c === 1 ? '' : 's'}`

/**
 * HD (beta), paid with credits, on the server: a full-size trace for images
 * bigger than the app traces, or a 4× upscale with a larger model for small
 * ones. Nothing is sent anywhere until the person confirms the cost.
 */
export function Hd(p: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const { width, height } = p.bitmap
  const credits = costFor(width, height, p.kind)
  const trace = p.kind === 'trace'
  const title = trace ? 'HD trace' : 'HD upscale'
  const what = trace
    ? `Traces this image at its full size, ${n(width)} × ${n(height)}, on Inlay’s server, for finer detail than the ${n(p.traceEdge)} px trace here.`
    : `Upscales this image 4×, to ${n(width * UPSCALE.factor)} × ${n(height * UPSCALE.factor)}, with a larger model than the in-browser upscaler, on Inlay’s server. Then you can trace the result. It can take a couple of minutes.`

  async function check() {
    setPhase({ kind: 'checking' })
    try {
      const a = await api.account()
      if (a.signedIn) setBalance(a.email, a.balance)
      setPhase(a.signedIn ? { kind: 'confirm', balance: a.balance } : { kind: 'signedOut' })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function run() {
    setPhase({ kind: 'working', progress: { stage: 'encoding', done: 0, total: 1 } })
    try {
      const result = await hdRun(p.kind, p.bitmap, trace ? p.settings : null, (progress) => setPhase({ kind: 'working', progress }))
      setPhase({ kind: 'done', result })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    } finally {
      // Spent, or refunded after a failure: either way the header's count changed.
      void refreshAccount()
    }
  }

  return (
    <details className="group mt-2" data-hd={p.kind}>
      <summary className="cursor-pointer list-none text-[12.5px] text-ink-muted select-none hover:text-ink">
        <span className="inline-block transition-transform group-open:rotate-90">›</span> {title}{' '}
        <span className="rounded-sm border border-rule px-1 text-[10.5px] text-ink-muted">Beta</span>
        <span className="num ml-1.5">
          {trace ? `${n(width)} × ${n(height)}` : `${n(width)} × ${n(height)} → 4×`}, {plural(credits)}
        </span>
      </summary>
      <div className="mt-2 space-y-2.5 text-[13px]">
        <p className="field-hint">
          {what} Your image is uploaded, processed, and deleted as soon as the result is back.{' '}
          <a href="/pricing/" className="underline underline-offset-2 hover:text-ink">
            HD is in beta
          </a>
          .
        </p>

        {(phase.kind === 'idle' || phase.kind === 'checking') && (
          <button className="btn w-full" disabled={phase.kind === 'checking'} onClick={check}>
            {phase.kind === 'checking' ? 'Checking your account…' : `${trace ? 'Trace in HD' : 'Upscale in HD'} for ${plural(credits)}`}
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
                You have {plural(phase.balance)}; this uses {credits}. If it fails, they come straight back.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button className="btn btn-primary" onClick={run}>
                  {trace ? 'Start HD trace' : 'Start HD upscale'}
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
            <p>
              {title} done: {formatBytes(phase.result.size)}.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary" onClick={() => p.onSave(phase.result)}>
                {trace ? 'Download HD' : 'Download PNG'}
              </button>
              <button className="btn" onClick={() => p.onOpen(phase.result)}>
                {trace ? 'Open to edit' : 'Trace it'}
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
