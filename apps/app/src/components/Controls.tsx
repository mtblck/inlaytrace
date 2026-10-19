import { useId, useState, type ReactNode } from 'react'
import type { PrepStage } from '../engine/prep'
import { PRESETS, hasExactShapes, isInk, presetById, toleranceFor, type PresetId, type Settings } from '../engine/presets'
import type { Candidate, SizeSearch } from '../engine/targetSize'
import { formatBytes } from '../lib/svg'

/** A target-size search: running (no result yet), done, or failed. */
export type SizeRun = { target: number; from: Settings; tried: number; best: Candidate | null; result: SizeSearch | null; error?: string }

type Props = {
  settings: Settings
  onChange: (next: Settings) => void
  onPreset: (id: PresetId) => void
  /** Centerline: the stroke width the last trace measured from the ink, for the Auto label. */
  measuredStroke?: number | null
  /** The AI steps: whether the image is small enough to upscale, and what's running. */
  prep?: { smallImage: boolean; status: { stage: PrepStage; done: number; total: number } | null; error: string | null }
  /** The optimised SVG's size now, and the target-size search. */
  currentBytes?: number | null
  sizeRun?: SizeRun | null
  onFindSize?: (kb: number) => void
  onApplySize?: () => void
  onCancelSize?: () => void
}

export function Controls({ settings, onChange, onPreset, measuredStroke, prep, ...size }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value })
  const p = settings.preset
  const defaults = presetById(p).defaults
  const changed = (Object.keys(defaults) as (keyof typeof defaults)[]).some((k) => defaults[k] !== settings[k])

  return (
    <>
      <Section title="What is it?">
        <div role="radiogroup" aria-label="Image type" className="grid gap-px overflow-hidden rounded-md border border-rule bg-rule">
          {PRESETS.map((preset) => {
            const active = preset.id === p
            return (
              <button
                key={preset.id}
                role="radio"
                aria-checked={active}
                onClick={() => onPreset(preset.id)}
                className={`flex flex-col gap-0.5 px-3 py-2 text-left transition-colors ${
                  active ? 'bg-paper' : 'bg-paper-sunk hover:bg-paper'
                }`}
              >
                {/* Name above, description below: side by side, the descriptions were cut off in the sidebar. */}
                <span className={`text-[13.5px] font-medium ${active ? 'text-accent' : 'text-ink'}`}>{preset.label}</span>
                <span className="field-hint">{preset.hint}</span>
              </button>
            )
          })}
        </div>
      </Section>

      {prep && <Prepare settings={settings} set={set} prep={prep} />}

      <Section
        title="Adjust"
        action={
          changed && (
            <button className="text-[12.5px] text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => onPreset(p)}>
              Reset
            </button>
          )
        }
      >
        <div className="space-y-4">
          {!isInk(p) && (
            <Slider label="Colours" value={settings.colors} min={2} max={64} step={1} onChange={(v) => set('colors', v)} format={(v) => `${v}`} hint="Fewer means a smaller file. If two colours merge into one, raise this." />
          )}

          {isInk(p) && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="field-label">Ink is</span>
                <div role="radiogroup" aria-label="Ink is" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
                  {([false, true] as const).map((light) => (
                    <button
                      key={String(light)}
                      role="radio"
                      aria-checked={settings.lightInk === light}
                      onClick={() => set('lightInk', light)}
                      className={`py-1.5 text-[13px] ${settings.lightInk === light ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk text-ink hover:bg-paper'}`}
                    >
                      {light ? 'Light on dark' : 'Dark on light'}
                    </button>
                  ))}
                </div>
                <p className="field-hint">Which part of the image to keep. The rest becomes transparent.</p>
              </div>
              {settings.threshold !== null && (
                <Slider label="Ink threshold" value={settings.threshold} min={1} max={254} step={1} onChange={(v) => set('threshold', v)} format={(v) => `${v}`} hint="Move it to catch fainter strokes or drop stray ones." />
              )}
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="accent-[var(--c-accent)]"
                  checked={settings.threshold === null}
                  onChange={(e) => set('threshold', e.target.checked ? null : 128)}
                />
                Adapt to uneven lighting (photos of paper)
              </label>
            </div>
          )}

          {p === 'centerline' && (
            <Slider
              label="Stroke width"
              value={settings.strokeWidth}
              min={0}
              max={24}
              step={0.5}
              onChange={(v) => set('strokeWidth', v)}
              format={(v) => (v === 0 ? `Auto${measuredStroke ? ` (${measuredStroke} px)` : ''}` : `${v} px`)}
              hint="Auto matches the ink. Set it to your pen or bit: the strokes keep their path, only the width changes."
            />
          )}

          <Slider label="Ignore specks" value={settings.speckle} min={0} max={32} step={1} onChange={(v) => set('speckle', v)} format={(v) => (v === 0 ? 'Off' : `${v} px`)} hint="Drops shapes smaller than this. Raise it for noisy scans." />

          {p !== 'pixel' && (
            <>
              <Slider label="Smoothing" value={settings.smoothing} min={0} max={3} step={0.25} onChange={(v) => set('smoothing', v)} format={smoothingLabel} hint="How far the outline may stray from the pixels. Higher means fewer nodes and a smaller file." />
              <Slider label="Corners" value={settings.corners} min={0} max={180} step={5} onChange={(v) => set('corners', v)} format={(v) => `${v}°`} hint="Bends sharper than this stay corners; gentler ones become curves." />
            </>
          )}

          {hasExactShapes(p) && (
            <div className="space-y-1.5">
              <span className="field-label">Exact shapes</span>
              <div role="radiogroup" aria-label="Exact shapes" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
                {([true, false] as const).map((v) => (
                  <button
                    key={String(v)}
                    role="radio"
                    aria-checked={settings.exact === v}
                    onClick={() => set('exact', v)}
                    className={`py-1.5 text-[13px] ${settings.exact === v ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk text-ink hover:bg-paper'}`}
                  >
                    {v ? 'On' : 'Off'}
                  </button>
                ))}
              </div>
              <p className="field-hint">
                {settings.exact
                  ? 'Circles, ellipses, rectangles and regular polygons are drawn as true shapes.'
                  : 'Every outline is fitted as traced, even where it is nearly a circle or a square.'}
              </p>
            </div>
          )}

          {/* Flat-art presets are cut out (what vinyl and screen print want); only Poster offers stacked, for smaller files. */}
          {p === 'photo' && (
            <div className="space-y-1.5">
              <span className="field-label">Shapes</span>
              <div role="radiogroup" aria-label="Shapes" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
                {(['stacked', 'cutout'] as const).map((v) => (
                  <button
                    key={v}
                    role="radio"
                    aria-checked={settings.shapes === v}
                    onClick={() => set('shapes', v)}
                    className={`py-1.5 text-[13px] ${settings.shapes === v ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk text-ink hover:bg-paper'}`}
                  >
                    {v === 'stacked' ? 'Stacked' : 'Cut out'}
                  </button>
                ))}
              </div>
              <p className="field-hint">
                {settings.shapes === 'stacked'
                  ? 'Shapes sit on top of each other. Smallest files.'
                  : 'No shape overlaps another. Use for vinyl cutting and screen print layers.'}
              </p>
            </div>
          )}
        </div>
      </Section>

      {size.onFindSize && <TargetSize {...size} onFindSize={size.onFindSize} />}
    </>
  )
}

/** The settings a search chose, in words: only what differs from where it started. */
function changes(from: Settings, to: Settings) {
  const out: string[] = []
  if (to.colors !== from.colors) out.push(`${to.colors} colours`)
  if (to.speckle !== from.speckle) out.push(`specks ${to.speckle} px`)
  if (to.smoothing !== from.smoothing) out.push(`smoothing ${to.smoothing}`)
  return out.length ? out.join(', ') : 'the current settings'
}

/**
 * Target size: type a size, and the app searches the settings for the most
 * accurate trace under it, then says what it chose before anything changes.
 */
function TargetSize(p: Omit<Props, 'settings' | 'onChange' | 'onPreset' | 'measuredStroke'> & { onFindSize: (kb: number) => void }) {
  const [kb, setKb] = useState('10')
  const run = p.sizeRun
  const n = Number(kb)
  const valid = Number.isFinite(n) && n > 0
  const r = run?.result
  return (
    <Section title="Target size">
      <div className="space-y-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) p.onFindSize(n)
          }}
        >
          <label className="flex-1">
            <span className="field-label">Fit the SVG under</span>
            <span className="mt-1 flex items-center gap-1.5">
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={kb}
                onChange={(e) => setKb(e.target.value)}
                className="w-full rounded-md border border-rule bg-paper px-2 py-1.5 font-mono text-[13px]"
                aria-label="Target size in KB"
              />
              <span className="text-[13px] text-ink-muted">KB</span>
            </span>
          </label>
          <button type="submit" className="btn h-[34px]" disabled={!valid || (!!run && !r && !run.error)}>
            Find settings
          </button>
        </form>
        {!run && <p className="field-hint">Tries smoother curves, fewer specks and fewer colours, and keeps the most accurate trace that fits.{p.currentBytes ? ` Now ${formatBytes(p.currentBytes)}.` : ''}</p>}
        {run && !r && !run.error && (
          <div className="flex items-center justify-between gap-3 text-[12.5px]" role="status">
            <span>
              Searching… {run.tried} {run.tried === 1 ? 'trace' : 'traces'}
              {run.best ? `, best so far ${formatBytes(run.best.bytes)}` : ''}
            </span>
            <button className="text-ink-muted underline hover:text-ink" onClick={p.onCancelSize}>
              Stop
            </button>
          </div>
        )}
        {run?.error && (
          <p role="alert" className="text-[12.5px] text-accent">
            {run.error}
          </p>
        )}
        {r && (
          <div className="space-y-2 text-[12.5px]" role="status" data-size-result="">
            {r.start.bytes <= run.target ? (
              <p>It already fits: {formatBytes(r.start.bytes)}.</p>
            ) : r.fits ? (
              <p>
                {formatBytes(r.best.bytes)} (from {formatBytes(r.start.bytes)}) with {changes(run.from, r.best.settings)}. Average error {r.start.error.toFixed(1)} → {r.best.error.toFixed(1)} (0–255, lower is closer).
              </p>
            ) : (
              <p>
                Couldn't get under {formatBytes(run.target)}. The smallest found is {formatBytes(r.best.bytes)} with {changes(run.from, r.best.settings)}. Removing a colour or editing shapes may get further.
              </p>
            )}
            <div className="flex gap-2">
              {r.start.bytes > run.target && r.best.bytes < r.start.bytes && (
                <button className="btn btn-primary flex-1" onClick={p.onApplySize}>
                  Use these settings
                </button>
              )}
              <button className="btn" onClick={p.onCancelSize}>
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-rule px-5 py-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  hint: string
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  const id = useId()
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="field-label">
          {props.label}
        </label>
        <output htmlFor={id} className="num">
          {props.format(props.value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        aria-describedby={`${id}-hint`}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <p id={`${id}-hint`} className="field-hint">
        {props.hint}
      </p>
    </div>
  )
}

/** Smoothing shows the fitting tolerance it sets: Inlay always fits within one (±0.25 px at the bottom of the scale). */
export const smoothingLabel = (v: number) => `±${toleranceFor(v).toFixed(2)} px`

const STAGE: Record<PrepStage, string> = { runtime: 'Loading the AI runtime', background: 'Removing the background', upscale: 'Upscaling' }

/**
 * Optional AI steps before tracing. Both run in this browser; the models are
 * fetched from this site the first time, which the hints say plainly.
 */
function Prepare({ settings, set, prep }: { settings: Settings; set: <K extends keyof Settings>(key: K, value: Settings[K]) => void; prep: NonNullable<Props['prep']> }) {
  const s = prep.status
  const busy = s && (s.total ? `${STAGE[s.stage]}… ${s.stage === 'upscale' && s.done < s.total && s.total < 1000 ? `${Math.round((s.done / s.total) * 100)}%` : `${(s.done / 1048576).toFixed(1)} of ${(s.total / 1048576).toFixed(1)} MB`}` : `${STAGE[s.stage]}…`)
  return (
    <Section title="Prepare">
      <div className="space-y-3">
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-0.5 accent-[var(--c-accent)]" checked={settings.removeBackground} onChange={(e) => set('removeBackground', e.target.checked)} />
          <span>
            Remove the background
            <span className="field-hint block">An AI model (U²-Net, 4.4 MB) finds the subject. Best on photos and product shots.</span>
          </span>
        </label>
        <label className={`flex items-start gap-2 text-[13px] ${prep.smallImage ? '' : 'opacity-60'}`}>
          <input type="checkbox" className="mt-0.5 accent-[var(--c-accent)]" checked={settings.aiUpscale} disabled={!prep.smallImage} onChange={(e) => set('aiUpscale', e.target.checked)} />
          <span>
            Upscale 4× with AI
            <span className="field-hint block">
              {prep.smallImage ? 'For small, blurry logos: Real-ESRGAN (4.9 MB) sharpens edges before tracing. Takes a few seconds.' : 'For images under 512 px; this one is big enough already.'}
            </span>
          </span>
        </label>
        <p className="field-hint">Both run in your browser; your image isn't uploaded. The models download from this site the first time.</p>
        {busy && (
          <p className="text-[12.5px]" role="status" data-prep-status="">
            {busy}
          </p>
        )}
        {prep.error && (
          <p role="alert" className="text-[12.5px] text-accent">
            {prep.error}
          </p>
        )}
      </div>
    </Section>
  )
}
