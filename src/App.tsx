import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { TraceClient } from './engine/client'
import { maxTraceEdge, settingsFor, toVtracerOptions, type PresetId, type Settings } from './engine/presets'
import { ACCEPTED, hasDarkBackground, loadSource, pixelsOf, type Pixels, type Source } from './lib/image'
import { buildSvg, formatBytes, inksOf, layerFiles, NO_EDITS, parseTrace, statsOf, type InkEdits, type Trace } from './lib/svg'
import { sampleImage } from './lib/sample'
import { Canvas, type ViewMode } from './components/Canvas'
import { Controls } from './components/Controls'
import { Inks } from './components/Inks'
import { useTheme } from './lib/theme'

type Status = { kind: 'idle' } | { kind: 'tracing' } | { kind: 'done'; ms: number } | { kind: 'error'; message: string }

export default function App() {
  const client = useMemo(() => new TraceClient(), [])
  useEffect(() => () => client.dispose(), [client])

  const [source, setSource] = useState<Source | null>(null)
  const [settings, setSettings] = useState<Settings>(() => settingsFor('logo'))
  const [trace, setTrace] = useState<Trace | null>(null)
  const [traceCount, setTraceCount] = useState(0)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [loadError, setLoadError] = useState<string | null>(null)
  const [edits, setEdits] = useState<InkEdits>(NO_EDITS)
  const [optimized, setOptimized] = useState<{ from: string; svg: string } | null>(null)
  const [mode, setMode] = useState<ViewMode>('split')
  const [zoom, setZoom] = useState(1)
  const [dragOver, setDragOver] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const pixelCache = useRef<{ source: Source; maxEdge: number; upscale: boolean; pixels: Pixels } | null>(null)

  // ---- Loading ------------------------------------------------------------
  const open = useCallback(async (file: Blob, name?: string) => {
    setLoadError(null)
    try {
      const next = await loadSource(file, name ?? (file instanceof File ? file.name : 'image'))
      setSource((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return next
      })
      setTrace(null)
      setEdits(NO_EDITS)
      setZoom(1)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const openSample = async () => {
    setSettings(settingsFor('logo'))
    await open(await sampleImage(), 'sample-badge')
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        open(file, file.name || 'pasted-image')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  // ---- Tracing ------------------------------------------------------------
  useEffect(() => {
    if (!source) return
    const timer = setTimeout(async () => {
      const maxEdge = maxTraceEdge(settings.preset)
      const upscale = settings.preset !== 'pixel'
      let cached = pixelCache.current
      if (!cached || cached.source !== source || cached.maxEdge !== maxEdge || cached.upscale !== upscale) {
        cached = { source, maxEdge, upscale, pixels: pixelsOf(source, maxEdge, upscale) }
        pixelCache.current = cached
      }
      const { rgba, width, height } = cached.pixels
      setStatus({ kind: 'tracing' })
      const res = await client.trace(rgba, width, height, toVtracerOptions(settings))
      if (!res) return // superseded by a newer request
      if (res.type === 'error') setStatus({ kind: 'error', message: res.message })
      else if (res.type === 'traced') {
        try {
          setTrace(parseTrace(res.svg))
          setTraceCount((n) => n + 1)
          setStatus({ kind: 'done', ms: res.ms })
        } catch (error) {
          setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [client, source, settings])

  const svg = useMemo(() => (trace ? buildSvg(trace, edits) : ''), [trace, edits])
  const inks = useMemo(() => (trace ? inksOf(trace) : []), [trace])

  // Optimise in the background so the numbers shown are the numbers exported.
  useEffect(() => {
    if (!svg) return
    const timer = setTimeout(async () => {
      const res = await client.optimize(svg)
      if (res?.type === 'optimized') setOptimized({ from: svg, svg: res.svg })
    }, 300)
    return () => clearTimeout(timer)
  }, [client, svg])

  const fresh = optimized?.from === svg ? optimized.svg : null
  const stats = useMemo(() => (svg ? statsOf(fresh ?? svg) : null), [svg, fresh])

  // ---- Export -------------------------------------------------------------
  const finalSvg = async () => fresh ?? (await optimizeHere(svg))

  const download = async () => save(new Blob([await finalSvg()], { type: 'image/svg+xml' }), `${source!.name}.svg`)

  const copy = async () => {
    await navigator.clipboard.writeText(await finalSvg())
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const downloadLayers = async () => {
    const files: Record<string, Uint8Array> = {}
    for (const f of layerFiles(trace!, edits, source!.name)) files[f.name] = strToU8(await optimizeHere(f.svg))
    files[`${source!.name}-all.svg`] = strToU8(await finalSvg())
    const zip = zipSync(files, { level: 6 })
    save(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), `${source!.name}-layers.zip`)
  }

  const choosePreset = (id: PresetId) => {
    const next = settingsFor(id)
    if (id === 'lineart' && source && hasDarkBackground(source)) next.lightInk = true
    setSettings(next)
  }

  const { theme, toggle } = useTheme()

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) open(file)
      }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-5">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-[26px] leading-none tracking-tight">img-to-svg</h1>
          <p className="hidden text-[13px] text-ink-muted sm:block">Trace images to SVG, in your browser.</p>
        </div>
        <div className="flex items-center gap-4 text-[13px]">
          <button onClick={toggle} className="text-ink-muted hover:text-ink" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <a href="https://mattblack.space" className="text-ink-muted hover:text-ink">
            mattblack.space
          </a>
        </div>
      </header>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED.join(',')}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) open(f)
          e.target.value = ''
        }}
      />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row" data-traces={traceCount}>
        {/* ---- Work surface ---- */}
        <div className="relative flex min-h-[60vh] flex-1 flex-col lg:min-h-0">
          {source && trace ? (
            <>
              <div className="relative min-h-0 flex-1">
                <Canvas imageUrl={source.url} svg={svg} width={trace.width} height={trace.height} mode={mode} zoom={zoom} />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-2.5">
                <div role="radiogroup" aria-label="Compare" className="flex gap-px overflow-hidden rounded-md border border-rule bg-rule">
                  {(
                    [
                      ['split', 'Split'],
                      ['difference', 'Difference'],
                      ['outlines', 'Outlines'],
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      role="radio"
                      aria-checked={mode === v}
                      onClick={() => setMode(v)}
                      className={`px-3 py-1 text-[13px] ${mode === v ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk hover:bg-paper'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="order-last w-full text-[12.5px] text-ink-muted md:order-none md:w-auto">
                  {mode === 'split' && 'Original on the left, SVG on the right. Drag the handle.'}
                  {mode === 'difference' && 'Black means the SVG matches. Bright areas are where it differs.'}
                  {mode === 'outlines' && 'Every path as a hairline, as a cutter or plotter sees it.'}
                </p>
                <div className="flex items-center gap-1" role="group" aria-label="Zoom">
                  {[1, 2, 4, 8].map((z) => (
                    <button
                      key={z}
                      onClick={() => setZoom(z)}
                      aria-pressed={zoom === z}
                      className={`num rounded px-2 py-1 ${zoom === z ? 'bg-paper-sunk text-ink' : 'hover:text-ink'}`}
                    >
                      {z === 1 ? 'Fit' : `${z}×`}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <Empty
              loading={!!source && !trace && status.kind !== 'error'}
              error={loadError ?? (status.kind === 'error' ? status.message : null)}
              onChoose={() => fileInput.current?.click()}
              onSample={openSample}
            />
          )}
          {dragOver && (
            <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-lg border-2 border-dashed border-accent bg-paper/80 text-[15px] font-medium text-accent">
              Drop to trace
            </div>
          )}
        </div>

        {/* ---- Controls ---- */}
        <aside className="flex w-full shrink-0 flex-col border-rule lg:w-[340px] lg:border-l">
          <div className="min-h-0 flex-1 lg:overflow-y-auto">
            {source && (
              <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{source.name}</div>
                  <div className="num">
                    {source.originalWidth} × {source.originalHeight}
                    {trace && trace.width > source.originalWidth && ` · upscaled ${Math.round((trace.width / source.originalWidth) * 10) / 10}× to trace`}
                    {trace && trace.width < source.originalWidth && ` · traced at ${trace.width} × ${trace.height}`}
                  </div>
                </div>
                <button className="btn shrink-0" onClick={() => fileInput.current?.click()}>
                  Replace
                </button>
              </div>
            )}
            <Controls settings={settings} onChange={setSettings} onPreset={choosePreset} />
            {trace && <Inks inks={inks} edits={edits} onChange={setEdits} />}
          </div>

          {/* On a phone this sits straight under the canvas; on desktop it pins to the foot of the column. */}
          <div className="order-first border-b border-rule bg-paper px-5 py-4 lg:order-none lg:border-t lg:border-b-0">
            <dl className="mb-3 grid grid-cols-3 gap-2">
              <Stat label="Paths" value={stats ? stats.paths.toLocaleString() : '—'} />
              <Stat label="Nodes" value={stats ? stats.nodes.toLocaleString() : '—'} />
              <Stat label="Size" value={stats ? formatBytes(stats.bytes) : '—'} />
            </dl>
            <p className="num mb-3 min-h-[1.25em]" aria-live="polite">
              {status.kind === 'tracing' && 'Tracing…'}
              {status.kind === 'done' && `Traced in ${status.ms.toLocaleString()} ms${fresh ? '' : ', optimising…'}`}
              {status.kind === 'error' && <span className="text-accent">{status.message}</span>}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-primary col-span-2" disabled={!trace} onClick={download}>
                Download SVG
              </button>
              <button className="btn" disabled={!trace} onClick={copy}>
                {copied ? 'Copied' : 'Copy SVG'}
              </button>
              <button className="btn" disabled={!trace} onClick={downloadLayers} title="One SVG per ink, in a .zip">
                Layers (.zip)
              </button>
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}

function Empty(props: { loading: boolean; error: string | null; onChoose: () => void; onSample: () => void }) {
  return (
    <div className="mat grid flex-1 place-items-center p-6">
      <div className="max-w-sm text-center">
        {props.loading ? (
          <p className="text-[15px] text-ink-muted" aria-live="polite">
            Tracing…
          </p>
        ) : (
          <>
            <h2 className="font-display text-[34px] leading-tight">Drop an image here</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-balance text-ink-muted">
              Or paste one, or choose a file. PNG, JPG, WebP, GIF or BMP. It never leaves this device: tracing runs in your browser.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button className="btn btn-primary" onClick={props.onChoose}>
                Choose an image
              </button>
              <button className="btn" onClick={props.onSample}>
                Try a sample
              </button>
            </div>
            {props.error && (
              <p role="alert" className="mt-4 text-[13.5px] text-accent">
                {props.error}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-faint">{label}</dt>
      <dd className="font-mono text-[14px] tabular-nums">{value}</dd>
    </div>
  )
}

let svgoHere: Promise<typeof import('svgo/browser')> | undefined
async function optimizeHere(svg: string) {
  svgoHere ??= import('svgo/browser')
  const { optimize } = await svgoHere
  return optimize(svg, { multipass: true, floatPrecision: 2, plugins: ['preset-default'] }).data
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
