import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { TraceClient } from './engine/client'
import { maxTraceEdge, settingsFor, toVtracerOptions, type PresetId, type Settings } from './engine/presets'
import { ACCEPTED, hasDarkBackground, loadSource, pixelsOf, type Pixels, type Source } from './lib/image'
import { formatBytes, normalizeHex, parseTrace, statsOf, type Trace } from './lib/svg'
import {
  buildSvg,
  deletePath,
  docFromTrace,
  docOf,
  inksOf,
  layerFiles,
  NO_EDITS,
  NO_INKS,
  recolorInk,
  removeInk,
  replacePath,
  restoreInk,
  visiblePaths,
  type Edits,
} from './lib/doc'
import { push, redo, startHistory, undo, type History } from './lib/history'
import { centreAxis, mirrorDoc, type Axis } from './lib/mirror'
import { loadPaper } from './lib/paper'
import { deleteNode, moveNode, parsePath, serializePath, nodeCount, type NodePart, type NodeRef, type Pt } from './lib/pathdata'
import { usePersisted } from './lib/persisted'
import { bounds, effective, fromSlider, snap, step, toSlider, type Zoom } from './lib/zoom'
import { sampleImage } from './lib/sample'
import { Canvas, type Overlays, type Tool, type ViewMode } from './components/Canvas'
import { EditPanel } from './components/EditPanel'
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
  const [history, setHistory] = useState<History<Edits>>(() => startHistory(NO_EDITS))
  const edits = history.present
  /**
   * Record an edit, computed from the latest state rather than the render that
   * started it, so an async step (loading paper.js) or a confirm prompt never
   * reverts edits made in the meantime. Edits sharing a `key` in a row (a drag,
   * a colour-picker sweep) undo as one.
   */
  const commit = useCallback(
    (next: (present: Edits) => Edits, key: string | null = null) => setHistory((h) => push(h, next(h.present), key)),
    [],
  )
  /** Bumped when a colour picker closes, so the next sweep is its own undo step. */
  const recolorSeq = useRef(0)
  const [tool, setTool] = useState<Tool>('select')
  const [panel, setPanel] = useState<'trace' | 'edit'>('trace')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<NodeRef | null>(null)
  const [axis, setAxis] = useState<Axis | null>(null)
  const [mirroring, setMirroring] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  /** An action that would throw away shape edits, waiting for the user to confirm. */
  const [pending, setPending] = useState<{ message: string; confirm: string; run: () => void } | null>(null)
  const [overlays, setOverlays] = usePersisted<Overlays>('img-to-svg:overlays', {
    paths: false,
    pathColor: '#c4451f',
    nodes: false,
    nodeColor: '#2f6fd6',
  })
  const dragSeq = useRef(0)
  const [optimized, setOptimized] = useState<{ from: string; svg: string } | null>(null)
  const [mode, setMode] = useState<ViewMode>('split')
  /** Screen px per original px, or null to fit; see lib/zoom. */
  const [zoom, setZoom] = useState<Zoom>(null)
  const [fitScale, setFitScale] = useState(1)
  const [dragOver, setDragOver] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const pixelCache = useRef<{ source: Source; maxEdge: number; upscale: boolean; pixels: Pixels } | null>(null)

  // ---- Loading ------------------------------------------------------------
  const openNow = useCallback(async (file: Blob, name?: string) => {
    setLoadError(null)
    try {
      const next = await loadSource(file, name ?? (file instanceof File ? file.name : 'image'))
      setSource((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return next
      })
      setTrace(null)
      setHistory(startHistory(NO_EDITS))
      setSelectedId(null)
      setSelectedNode(null)
      setAxis(null)
      setTool('select')
      setPanel('trace')
      setZoom(null)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const detached = edits.doc !== null
  /** Run `action` now, or ask first when it would discard shape edits. */
  const guard = useCallback(
    (message: string, confirm: string, action: () => void) => {
      if (detached) setPending({ message, confirm, run: action })
      else action()
    },
    [detached],
  )

  const open = useCallback(
    (file: Blob, name?: string) =>
      guard('Opening another image discards your edits. This can’t be undone.', 'Discard and open', () => {
        void openNow(file, name)
      }),
    [guard, openNow],
  )

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

  // The trace as a document. New ids per trace, so a selection never points
  // into a stale trace.
  const traced = useMemo(() => (trace ? docFromTrace(trace) : null), [trace])
  const doc = traced ? docOf(edits, traced) : null
  const svg = useMemo(() => (doc ? buildSvg(doc, edits.inks) : ''), [doc, edits.inks])
  const shown = useMemo(() => (doc ? visiblePaths(doc, edits.inks) : []), [doc, edits.inks])
  const inks = useMemo(() => (doc ? inksOf(doc) : []), [doc])

  // A selection that no longer exists (re-trace, undo past its creation) is dropped.
  useEffect(() => {
    if (selectedId && !shown.some((p) => p.id === selectedId)) {
      setSelectedId(null)
      setSelectedNode(null)
    }
  }, [shown, selectedId])
  useEffect(() => {
    if (doc && !axis) setAxis(centreAxis(doc))
  }, [doc, axis])

  // ---- Editing --------------------------------------------------------------
  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    setSelectedNode(null)
    // The selection's tools live in the Edit tab.
    if (id) setPanel('edit')
  }, [])

  const selectedPath = doc?.paths.find((p) => p.id === selectedId) ?? null

  type DocT = NonNullable<typeof doc>
  const editInks = (f: (inks: Edits['inks']) => Edits['inks'], key: string | null = null) => commit((e) => ({ ...e, inks: f(e.inks) }), key)
  /** A geometry edit, applied to the latest document (detaching it from the trace). */
  const editDoc = useCallback(
    (f: (doc: DocT) => DocT, key: string | null = null) => {
      if (!traced) return
      commit((e) => ({ ...e, doc: f(docOf(e, traced)) }), key)
    },
    [commit, traced],
  )
  /** Change one path's nodes, reading its current data at commit time. */
  const editPath = (id: string, f: (subs: ReturnType<typeof parsePath>) => ReturnType<typeof parsePath>, key: string | null = null) =>
    editDoc((d) => {
      const p = d.paths.find((x) => x.id === id)
      if (!p) return d
      const subs = f(parsePath(p.d))
      return subs.length ? replacePath(d, id, serializePath(subs)) : deletePath(d, id)
    }, key)

  const onDragNode = (ref: NodeRef, part: NodePart, to: Pt, phase: 'move' | 'end') => {
    if (!selectedId) return
    editPath(selectedId, (subs) => moveNode(subs, ref, part, to), `drag-${dragSeq.current}`)
    if (phase === 'end') dragSeq.current++
  }

  const deleteSelection = useCallback(() => {
    if (!selectedPath) return
    const id = selectedPath.id
    if (selectedNode) {
      const ref = selectedNode
      const left = deleteNode(parsePath(selectedPath.d), ref)
      editDoc((d) => {
        const p = d.paths.find((x) => x.id === id)
        if (!p) return d
        const subs = deleteNode(parsePath(p.d), ref)
        return subs.length ? replacePath(d, id, serializePath(subs)) : deletePath(d, id)
      })
      setSelectedNode(null)
      if (!left.length) setSelectedId(null)
    } else {
      editDoc((d) => deletePath(d, id))
      setSelectedId(null)
    }
  }, [editDoc, selectedPath, selectedNode])

  const mirror = async () => {
    if (!doc || !axis) return
    setMirroring(true)
    setMirrorError(null)
    try {
      const paper = await loadPaper()
      // Mirrors the drawing as it was when the button was pressed (the button is
      // disabled meanwhile); colour edits made while paper.js loaded are kept.
      const mirrored = mirrorDoc(paper, doc, axis)
      editDoc(() => mirrored)
      setSelectedId(null)
      setSelectedNode(null)
      // Back to Select, so the washed-out preview stops hiding the result.
      setTool('select')
    } catch (error) {
      setMirrorError(`Mirroring failed: ${error instanceof Error ? error.message : String(error)}. Your drawing is unchanged.`)
    } finally {
      setMirroring(false)
    }
  }

  // Keyboard: undo/redo everywhere except text fields; Delete and Esc act on the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['color', 'range', 'checkbox', 'radio'].includes((el as HTMLInputElement).type)))
      const mod = e.metaKey || e.ctrlKey
      if (mod && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)))
      } else if (mod && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        setHistory((h) => redo(h))
      } else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 'Escape') {
        if (selectedNode) setSelectedNode(null)
        else setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, selectedNode, deleteSelection])

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
  // Numbers come only from the optimised file. While a drag or a sweep keeps
  // changing the SVG, the last optimised numbers stay up rather than measuring
  // every intermediate state (20 ms a move on a busy trace).
  const freshStats = useMemo(() => (fresh ? statsOf(fresh) : null), [fresh])
  const [keptStats, setKeptStats] = useState<{ source: Source; stats: NonNullable<typeof freshStats> } | null>(null)
  if (freshStats && source && keptStats?.stats !== freshStats) setKeptStats({ source, stats: freshStats })
  const stats = freshStats ?? (keptStats?.source === source ? keptStats.stats : null)

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
    for (const f of layerFiles(doc!, edits.inks, source!.name)) files[f.name] = strToU8(await optimizeHere(f.svg))
    files[`${source!.name}-all.svg`] = strToU8(await finalSvg())
    const zip = zipSync(files, { level: 6 })
    save(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), `${source!.name}-layers.zip`)
  }

  /**
   * Trace settings re-trace, which replaces detached shapes. Ask first; on
   * confirm, re-attaching is itself an undoable edit, so Undo brings the
   * edited shapes back.
   */
  const changeSettings = (next: Settings) =>
    guard('Changing a trace setting re-traces the image and replaces your shape edits. Undo brings them back.', 'Discard edits and re-trace', () => {
      if (detached) {
        commit((e) => ({ ...e, doc: null }))
        setSelectedId(null)
        setSelectedNode(null)
      }
      setSettings(next)
    })

  const choosePreset = (id: PresetId) => {
    const next = settingsFor(id)
    if (id === 'lineart' && source && hasDarkBackground(source)) next.lightInk = true
    changeSettings(next)
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
                <Canvas
                  imageUrl={source.url}
                  paths={shown}
                  width={doc!.width}
                  height={doc!.height}
                  mode={mode}
                  zoom={zoom}
                  naturalWidth={source.originalWidth}
                  onZoom={setZoom}
                  onFitScale={setFitScale}
                  tool={tool}
                  overlays={overlays}
                  selectedId={selectedId}
                  selectedNode={selectedNode}
                  axis={axis}
                  onSelect={select}
                  onSelectNode={setSelectedNode}
                  onDragNode={onDragNode}
                  onAxis={(position) => axis && setAxis({ ...axis, position })}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-2.5">
                <div role="radiogroup" aria-label="Compare" className="flex gap-px overflow-hidden rounded-md border border-rule bg-rule">
                  {(
                    [
                      ['split', 'Split'],
                      ['difference', 'Difference'],
                      ['vector', 'Vector'],
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
                  {mode === 'vector' && 'The SVG on its own, over a check pattern where it is transparent.'}
                </p>
                <div className="flex items-center gap-3" role="group" aria-label="Overlays">
                  <OverlayToggle
                    label="Paths"
                    on={overlays.paths}
                    color={overlays.pathColor}
                    onToggle={(paths) => setOverlays({ ...overlays, paths })}
                    onColor={(pathColor) => setOverlays({ ...overlays, pathColor })}
                  />
                  <OverlayToggle
                    label="Nodes"
                    on={overlays.nodes}
                    color={overlays.nodeColor}
                    onToggle={(nodes) => setOverlays({ ...overlays, nodes })}
                    onColor={(nodeColor) => setOverlays({ ...overlays, nodeColor })}
                  />
                </div>
                <ZoomControl zoom={zoom} fit={fitScale} onZoom={setZoom} />
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
            {pending && (
              <div role="alertdialog" aria-labelledby="pending-msg" className="border-b border-rule bg-accent-dim px-5 py-4">
                <p id="pending-msg" className="text-[13.5px] text-ink">
                  {pending.message}
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const run = pending.run
                      setPending(null)
                      run()
                    }}
                  >
                    {pending.confirm}
                  </button>
                  <button className="btn" autoFocus onClick={() => setPending(null)}>
                    Keep editing
                  </button>
                </div>
              </div>
            )}
            {doc && (
              <div role="tablist" aria-label="Panel" className="flex border-b border-rule px-5">
                {(
                  [
                    ['trace', 'Trace'],
                    ['edit', 'Edit'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    id={`tab-${id}`}
                    aria-selected={panel === id}
                    aria-controls={`panel-${id}`}
                    onClick={() => setPanel(id)}
                    className={`-mb-px border-b-2 px-1 py-2.5 mr-5 text-[13.5px] ${panel === id ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
                  >
                    {label}
                    {id === 'edit' && detached && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" data-edited="">
                        <span className="sr-only">(edited)</span>
                      </span>}
                  </button>
                ))}
              </div>
            )}
            <div role="tabpanel" id="panel-edit" aria-labelledby="tab-edit" hidden={!doc || panel !== 'edit'}>
            {doc && axis && (
              <EditPanel
                tool={tool}
                onTool={(t) => {
                  setTool(t)
                  if (t === 'mirror') void loadPaper().catch(() => {}) // warm it up while the user picks a side
                }}
                canUndo={history.past.length > 0}
                canRedo={history.future.length > 0}
                onUndo={() => setHistory(undo)}
                onRedo={() => setHistory(redo)}
                detached={detached}
                selection={selectedPath ? { id: selectedPath.id, nodes: nodeCount(parsePath(selectedPath.d)), node: !!selectedNode } : null}
                onDeleteSelection={deleteSelection}
                axis={axis}
                width={doc.width}
                height={doc.height}
                onAxis={setAxis}
                mirroring={mirroring}
                mirrorError={mirrorError}
                onMirror={mirror}
              />
            )}
            {doc && (
              <Inks
                inks={inks}
                edits={edits.inks}
                selectedInk={selectedPath?.fill ?? null}
                onReplace={(hex, to) => {
                  const v = normalizeHex(to)
                  if (v) editInks((i) => recolorInk(i, hex, v), `recolor-${hex}-${recolorSeq.current}`)
                }}
                onReplaceDone={() => recolorSeq.current++}
                onRemove={(hex) => editInks((i) => removeInk(i, hex))}
                onRestore={(hex) => editInks((i) => restoreInk(i, hex))}
                onRestoreAll={() => editInks(() => NO_INKS)}
              />
            )}
            </div>
            <div role="tabpanel" id="panel-trace" aria-labelledby="tab-trace" hidden={!!doc && panel !== 'trace'}>
              <Controls settings={settings} onChange={changeSettings} onPreset={choosePreset} />
            </div>
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

/**
 * − slider + and a readout, then Fit and 100%. The slider is logarithmic, so
 * each stretch of travel is the same ratio of zoom. Fit follows the window;
 * 100% is one original pixel per screen pixel.
 */
function ZoomControl({ zoom, fit, onZoom }: { zoom: Zoom; fit: number; onZoom: (z: Zoom) => void }) {
  const scale = effective(zoom, fit)
  const { min, max } = bounds(fit)
  const pct = `${Math.round(scale * 100)}%`
  const btn = 'num rounded px-1.5 py-1 hover:text-ink disabled:opacity-40'
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Zoom">
      <button className={`${btn} w-6`} onClick={() => onZoom(step(zoom, fit, -1))} disabled={scale <= min * 1.001} aria-label="Zoom out" title="Zoom out (⌘ −)">
        −
      </button>
      <input
        type="range"
        className="w-24 accent-[var(--c-accent)] sm:w-28"
        min={toSlider(min)}
        max={toSlider(max)}
        step="any"
        value={toSlider(scale)}
        onChange={(e) => onZoom(snap(fromSlider(Number(e.target.value)), fit))}
        aria-label="Zoom"
        aria-valuetext={pct}
      />
      <button className={`${btn} w-6`} onClick={() => onZoom(step(zoom, fit, 1))} disabled={scale >= max * 0.999} aria-label="Zoom in" title="Zoom in (⌘ =)">
        +
      </button>
      <span className="num w-12 text-right tabular-nums" aria-live="polite" data-zoom-readout="">
        {pct}
      </span>
      <button className={`${btn} ${zoom === null ? 'bg-paper-sunk text-ink' : ''}`} onClick={() => onZoom(null)} aria-pressed={zoom === null} title="Fit to window (⌘ 0)">
        Fit
      </button>
      <button className={`${btn} ${zoom === 1 ? 'bg-paper-sunk text-ink' : ''}`} onClick={() => onZoom(snap(1, fit))} aria-pressed={zoom === 1} title="Actual size (⌘ 1)">
        100%
      </button>
    </div>
  )
}

function OverlayToggle(props: { label: string; on: boolean; color: string; onToggle: (on: boolean) => void; onColor: (c: string) => void }) {
  return (
    <span className="flex items-center gap-1.5 text-[13px]">
      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" className="accent-[var(--c-accent)]" checked={props.on} onChange={(e) => props.onToggle(e.target.checked)} />
        {props.label}
      </label>
      <label className="relative h-4 w-4 overflow-hidden rounded-sm border border-rule" style={{ background: props.color }} title={`${props.label} colour`}>
        <input
          type="color"
          value={props.color}
          onChange={(e) => props.onColor(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`${props.label} overlay colour`}
        />
      </label>
    </span>
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
