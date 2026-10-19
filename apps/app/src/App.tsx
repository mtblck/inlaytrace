import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { TraceClient } from './engine/client'
import { BatchDialog } from './components/Batch'
import { SVGO } from './engine/svgo'
import { PrepClient } from './engine/prepClient'
import type { PrepStage } from './engine/prep'
import type { SizeRun } from './components/Controls'
import { canMerge, isInk, maxTraceEdge, settingsFor, toTraceOptions, type PresetId, type Settings } from './engine/presets'
import { ACCEPTED, colourAt, hasDarkBackground, loadSource, pixelsOf, UPSCALE_BELOW, type Pixels, type Source } from './lib/image'
import { formatBytes, normalizeHex, parseTrace, statsOf, type Trace } from './lib/svg'
import {
  buildSvg,
  deletePath,
  docFromTrace,
  arrange,
  docOf,
  groupPaths,
  hasStrokes,
  reserveGroups,
  ungroupPaths,
  withGroups,
  type Arrange,
  inksOf,
  layerFiles,
  NO_EDITS,
  NO_INKS,
  recolorInk,
  removeInk,
  replacePath,
  reserveIds,
  restoreInk,
  visiblePaths,
  type Edits,
} from './lib/doc'
import { push, redo, startHistory, undo, type History } from './lib/history'
import { centreAxis, likelyAxis, mirrorDoc, type Axis } from './lib/mirror'
import { loadPaper } from './lib/paper'
import { deleteNodes, moveHandle, moveNode, moveNodes, parsePath, serializePath, nodeCount, type NodePart, type NodeRef, type Pt } from './lib/pathdata'
import { addNode, nearestOnPath, roundNode, sharpenNode, simplifySubpaths, smoothNode } from './lib/nodeops'
import { allRefs, boxToBox, rotateAbout, hasRef, nodesInRect, pathBounds, pathsInRect, transformShape, translate, union, type Affine, type Box } from './lib/transform'
import { usePersisted } from './lib/persisted'
import { bounds, effective, fromSlider, snap, step, toSlider, type Zoom } from './lib/zoom'
import { sampleImage } from './lib/sample'
import { Canvas, type Overlays, type SelectMode, type Tool, type ViewMode } from './components/Canvas'
import { ShortcutsDialog } from './components/Shortcuts'
import { ExportOptions } from './components/ExportOptions'
import { Hd } from './components/Hd'
import { UPSCALE } from '../../../server/pricing'
import { clearSession, loadSession, newSessionId, saveImage, saveState } from './lib/session'
import { buildDxf, buildEps, buildPdf, pngPixels, withSize, type ExportSize } from './lib/vectorExport'
import { IconButton, KeyboardIcon, MoonIcon, SunIcon } from './components/IconButton'
import { EditPanel } from './components/EditPanel'
import { AccountNav } from './components/AccountNav'
import { Controls } from './components/Controls'
import { Inks } from './components/Inks'
import { useTheme } from './lib/theme'

type Status = { kind: 'idle' } | { kind: 'tracing' } | { kind: 'done'; ms: number } | { kind: 'opened' } | { kind: 'error'; message: string }

export default function App() {
  const client = useMemo(() => new TraceClient(), [])
  useEffect(() => () => client.dispose(), [client])
  const prepClient = useMemo(() => new PrepClient(), [])
  useEffect(() => () => prepClient.stop(), [prepClient])
  const [prepared, setPrepared] = useState<{ key: string; source: Source } | null>(null)
  const preparedRef = useRef<{ key: string; source: Source } | null>(null)
  const [prepStatus, setPrepStatus] = useState<{ stage: PrepStage; done: number; total: number } | null>(null)
  const [prepError, setPrepError] = useState<string | null>(null)
  // Target size runs dozens of traces: on a worker of its own, so tracing stays responsive.
  const sizeClient = useMemo(() => new TraceClient(), [])
  useEffect(() => () => sizeClient.dispose(), [sizeClient])
  const [sizeRun, setSizeRun] = useState<SizeRun | null>(null)
  /** Several images dropped or chosen at once, waiting to be batch traced. */
  const [batch, setBatch] = useState<File[] | null>(null)

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
  /** Undo or redo. A node selection is indices into a shape whose nodes may change, so it is cleared. */
  const historyStep = useCallback((dir: 'undo' | 'redo') => {
    setHistory((h) => (dir === 'undo' ? undo(h) : redo(h)))
    setSelectedNodes([])
  }, [])
  const commit = useCallback(
    (next: (present: Edits) => Edits, key: string | null = null) => setHistory((h) => push(h, next(h.present), key)),
    [],
  )
  /** Bumped when a colour picker closes, so the next sweep is its own undo step. */
  const recolorSeq = useRef(0)
  const backgroundSeq = useRef(0)
  /**
   * A new image opens on Split, for comparing. The first time you start editing
   * it (the Edit tab, or selecting a shape) the view switches to Vector, so the
   * original is out of the way. Once per image, and never over a view you
   * picked yourself.
   */
  const viewChosen = useRef(false)
  const startEditing = useCallback(() => {
    if (viewChosen.current) return
    viewChosen.current = true
    setMode('vector')
  }, [])
  const [tool, setTool] = useState<Tool>('select')
  const [panel, setPanel] = useState<'trace' | 'edit'>('trace')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** Nodes selected in the shape the Nodes tool is editing (the first selected shape). */
  const [selectedNodes, setSelectedNodes] = useState<NodeRef[]>([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** The eyedropper is armed for an ink (its traced hex) or the background. */
  const [picking, setPicking] = useState<{ target: string } | null>(null)
  const [axis, setAxis] = useState<Axis | null>(null)
  /** The likeliest symmetry in the traced pixels, and which pixels it was found in. */
  const [detected, setDetected] = useState<{ pixels: Pixels; axis: (Axis & { score: number }) | null } | null>(null)
  /** Whether the user has moved the axis since this image opened; until then a detected one replaces it. */
  const axisTouched = useRef(false)
  const symmetryOf = useRef<Pixels | null>(null)
  const [mirroring, setMirroring] = useState(false)
  const [mirrorError, setMirrorError] = useState<string | null>(null)
  /** An action that would throw away shape edits, waiting for the user to confirm. */
  const [pending, setPending] = useState<{ message: string; confirm: string; run: () => void } | null>(null)
  const [overlays, setOverlays] = usePersisted<Overlays>('img-to-svg:overlays', { // key predates the rename; kept so settings survive
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
  /**
   * The export width and unit, or null for the drawing's own size. The height
   * always follows the drawing's current proportions, so a re-trace at a
   * slightly different shape (Pixel art keeps every source pixel) can't leave
   * a stale height that stretches the PDF.
   */
  const [exportSize, setExportSize] = useState<{ width: number; unit: ExportSize['unit'] } | null>(null)
  const [pngError, setPngError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const pixelCache = useRef<{ source: Source; maxEdge: number; upscale: boolean; pixels: Pixels } | null>(null)

  // ---- Loading ------------------------------------------------------------
  /** The original file, kept so the session can be saved on this device. */
  const fileRef = useRef<Blob | null>(null)
  /** `restore` reopens a saved session: its settings and edits instead of fresh ones. */
  /** Bumped by every open, so a slower earlier one (a restore still decoding) can't land on top of a newer one. */
  const openSeq = useRef(0)
  /** The saved session's id for the image on screen: a new one per image, the saved one when restoring. */
  const sessionId = useRef<string | null>(null)
  const openNow = useCallback(async (file: Blob, name?: string, restore?: { settings: Settings; edits: Edits; id: string }) => {
    const seq = ++openSeq.current
    setLoadError(null)
    try {
      const next = await loadSource(file, name ?? (file instanceof File ? file.name : 'image'))
      if (seq !== openSeq.current) {
        URL.revokeObjectURL(next.url)
        return
      }
      fileRef.current = file
      sessionId.current = restore?.id ?? newSessionId()
      imageSaved.current = !!restore
      setSessionNote(restore ? 'restored' : null)
      setSource((prev) => {
        if (prev) URL.revokeObjectURL(prev.url)
        return next
      })
      setTrace(null)
      if (restore) {
        reserveIds(restore.edits.doc)
        reserveGroups(restore.edits.doc)
        setSettings({ ...restore.settings, merge: restore.settings.merge ?? {} })
      } else {
        // Merges name this image's colours; another image starts without them.
        setSettings((s) => (Object.keys(s.merge).length ? { ...s, merge: {} } : s))
      }
      setHistory(startHistory(restore ? restore.edits : NO_EDITS))
      setExportSize(null)
      setPicking(null)
      setSelectedIds([])
      setSelectedNodes([])
      setAxis(null)
      setDetected(null)
      sizeClient.dispose()
      setSizeRun(null)
      axisTouched.current = false
      setTool('select')
      setPanel(restore?.edits.doc || next.svg ? 'edit' : 'trace')
      setMode(restore ? 'vector' : 'split')
      viewChosen.current = !!restore
      setZoom(null)
    } catch (error) {
      if (seq === openSeq.current) setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // ---- The session, kept on this device ----------------------------------------
  /** 'restored' after bringing back a previous visit; 'saved' once this session is in storage. */
  const [sessionNote, setSessionNote] = useState<'restored' | 'saved' | null>(null)
  const restoredOnce = useRef(false)
  useEffect(() => {
    // StrictMode runs effects twice in development; restore once.
    if (restoredOnce.current) return
    restoredOnce.current = true
    const seqAtStart = openSeq.current
    void loadSession().then((saved) => {
      // Anything opened meanwhile (a drop, a paste, the sample) wins.
      if (!saved || openSeq.current !== seqAtStart) return
      void openNow(saved.image.file, saved.image.name, { settings: saved.settings, edits: saved.edits, id: saved.image.id })
    })
  }, [openNow])
  // The image is stored once, after it has traced: one that can't be traced is never brought back.
  const imageSaved = useRef(false)
  useEffect(() => {
    if (!source || !trace || !fileRef.current || !sessionId.current || imageSaved.current) return
    imageSaved.current = true
    const id = sessionId.current
    void saveImage({ id, file: fileRef.current, name: source.name }).then((ok) => ok && sessionId.current === id && setSessionNote((n) => n ?? 'saved'))
  }, [source, trace])
  // Settings and edits, as you work.
  useEffect(() => {
    if (!source || !trace || !sessionId.current) return
    const id = sessionId.current
    const t = setTimeout(() => void saveState({ id, settings, edits }), 600)
    return () => clearTimeout(t)
  }, [source, trace, settings, edits])
  /** Forget everything: the saved session and what's on screen. Always asks. */
  const startOver = () =>
    setPending({
      message: 'Start over? This clears the image and all your edits, here and from this browser’s storage. It can’t be undone.',
      confirm: 'Start over',
      run: async () => {
        openSeq.current++
        sessionId.current = null
        // Cleared before the screen is: once the empty page shows, a reload (or
        // closing the tab) can't bring the old session back.
        await clearSession()
        fileRef.current = null
        sessionId.current = null
        setSource((prev) => {
          if (prev) URL.revokeObjectURL(prev.url)
          return null
        })
        setTrace(null)
        setHistory(startHistory(NO_EDITS))
        setSelectedIds([])
        setSelectedNodes([])
        setSettings(settingsFor('logo'))
        setSessionNote(null)
        setExportSize(null)
        setPicking(null)
      },
    })

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
      // Not behind an open batch dialog.
      if (document.querySelector('dialog[open][data-batch]')) return
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        open(file, file.name || 'pasted-image')
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [open])

  // ---- AI preparation ---------------------------------------------------------
  // Background removal and 4× upscaling run before tracing, in a worker of
  // their own, and give a prepared copy of the image that's traced (and
  // compared against) instead. Upscaling only applies to small images.
  const wantUpscale = settings.aiUpscale && !!source && Math.max(source.bitmap.width, source.bitmap.height) < UPSCALE_BELOW
  const prepKey = source && (settings.removeBackground || wantUpscale) ? `${source.url}|${settings.removeBackground}|${wantUpscale}` : null
  useEffect(() => {
    if (!source || !prepKey) {
      prepClient.stop()
      setPrepStatus(null)
      setPrepError(null)
      return
    }
    if (preparedRef.current?.key === prepKey) {
      // Back to a copy already made: stop anything still running for another one.
      prepClient.stop()
      setPrepStatus(null)
      setPrepError(null)
      return
    }
    let live = true
    setPrepError(null)
    setPrepStatus({ stage: settings.removeBackground ? 'background' : 'upscale', done: 0, total: 0 })
    const native = pixelsOf(source, Infinity, false)
    void prepClient
      .prepare(native.rgba, native.width, native.height, { background: settings.removeBackground, upscale: wantUpscale }, (stage, done, total) => live && setPrepStatus({ stage, done, total }))
      .then(async (r) => {
        if (!live || !r) return
        if (r instanceof Error) {
          setPrepStatus(null)
          setPrepError(r.message)
          return
        }
        const img = new ImageData(r.rgba as Uint8ClampedArray<ArrayBuffer>, r.width, r.height)
        const canvas = new OffscreenCanvas(r.width, r.height)
        canvas.getContext('2d')!.putImageData(img, 0, 0)
        const [bitmap, blob] = await Promise.all([createImageBitmap(img), canvas.convertToBlob({ type: 'image/png' })])
        if (!live) return
        if (preparedRef.current) URL.revokeObjectURL(preparedRef.current.source.url)
        preparedRef.current = { key: prepKey, source: { ...source, url: URL.createObjectURL(blob), bitmap } }
        setPrepared(preparedRef.current)
        setPrepStatus(null)
      })
    return () => {
      live = false
    }
    // Settings other than the two steps don't change what's prepared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, prepKey, prepClient])
  /** What gets traced: the prepared image when a step is on (none until it's ready), else the original. */
  const traceSource = prepKey ? (prepared?.key === prepKey ? prepared.source : null) : source

  // ---- Tracing ------------------------------------------------------------
  useEffect(() => {
    if (!traceSource) return
    const source = traceSource
    // An SVG opened to edit isn't traced: its own shapes are the drawing.
    if (source.svg) {
      setTrace(source.svg.trace)
      setTraceCount((n) => n + 1)
      setStatus({ kind: 'opened' })
      return
    }
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
      const res = await client.trace(rgba, width, height, toTraceOptions(settings))
      if (!res) return // superseded by a newer request
      if (symmetryOf.current !== cached.pixels) {
        // Once per set of pixels, not per trace: settings don't change the answer.
        // Asked after the trace, so detection never delays the first preview.
        const pixels = (symmetryOf.current = cached.pixels)
        void client.symmetry(rgba, width, height).then((res) => {
          if (symmetryOf.current !== pixels) return
          // Dropped (the worker restarted) or failed: the next trace asks again.
          if (res?.type !== 'symmetry') return void (symmetryOf.current = null)
          const found = likelyAxis(res.found)
          setDetected({ pixels, axis: found })
          if (!axisTouched.current) {
            // An untouched axis follows the image: the detected one, or (none
            // found) back to the centre, since these pixels may be another size.
            if (found) {
              const { score: _, ...axis } = found
              setAxis(axis as Axis)
            } else setAxis(null)
          }
        })
      }
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
  }, [client, traceSource, settings])

  // The trace as a document. New ids per trace, so a selection never points
  // into a stale trace.
  const traced = useMemo(() => (trace ? docFromTrace(trace) : null), [trace])
  const doc = traced ? docOf(edits, traced) : null
  const svg = useMemo(() => (doc ? buildSvg(doc, edits.inks, undefined, edits.background) : ''), [doc, edits.inks, edits.background])
  const shown = useMemo(() => (doc ? visiblePaths(doc, edits.inks) : []), [doc, edits.inks])
  const inks = useMemo(() => (doc ? inksOf(doc) : []), [doc])
  const strokes = useMemo(() => !!doc && hasStrokes(doc), [doc])
  // Strokes can't be mirrored: leave the Mirror tool if a trace turns into them.
  useEffect(() => {
    if (strokes && tool === 'mirror') setTool('select')
  }, [strokes, tool])

  // Shapes that no longer exist (re-trace, undo past their creation) drop out
  // of the selection, and so do nodes that no longer exist in the edited shape.
  useEffect(() => {
    const ids = new Set(shown.map((p) => p.id))
    if (selectedIds.some((id) => !ids.has(id))) {
      const kept = selectedIds.filter((id) => ids.has(id))
      setSelectedIds(kept)
      if (kept[0] !== selectedIds[0]) setSelectedNodes([])
    }
  }, [shown, selectedIds])
  const editing = shown.find((p) => p.id === selectedIds[0]) ?? null
  const editingSubs = useMemo(() => (editing ? parsePath(editing.d) : null), [editing])
  useEffect(() => {
    if (!editingSubs) return
    const ok = (r: NodeRef) => r.sub < editingSubs.length && r.index < editingSubs[r.sub].nodes.length
    if (selectedNodes.some((r) => !ok(r))) setSelectedNodes((n) => n.filter(ok))
  }, [editingSubs, selectedNodes])
  useEffect(() => {
    if (doc && !axis) setAxis(centreAxis(doc))
  }, [doc, axis])

  // ---- Editing --------------------------------------------------------------
  const select = useCallback(
    (id: string | null, how: SelectMode = 'set') => {
      setSelectedIds((cur) => {
        if (id === null) return how === 'set' ? [] : cur
        // A shape in a group stands for its whole group.
        const ids = docRef.current ? withGroups(docRef.current, [id]) : [id]
        if (how === 'set') return ids
        if (how === 'subtract') return cur.filter((x) => !ids.includes(x))
        if (how === 'add') return [...cur, ...ids.filter((x) => !cur.includes(x))]
        return cur.includes(id) ? cur.filter((x) => !ids.includes(x)) : [...cur, ...ids.filter((x) => !cur.includes(x))]
      })
      setSelectedNodes([])
      // The selection's tools live in the Edit tab.
      if (id) {
        setPanel('edit')
        startEditing()
      }
    },
    [startEditing],
  )
  const selectNodes = useCallback((refs: NodeRef[], how: SelectMode) => {
    setSelectedNodes((cur) => {
      if (how === 'set') return refs
      if (how === 'subtract') return cur.filter((r) => !hasRef(refs, r))
      if (how === 'add') return [...cur, ...refs.filter((r) => !hasRef(cur, r))]
      // toggle
      const off = cur.filter((r) => !hasRef(refs, r))
      return [...off, ...refs.filter((r) => !hasRef(cur, r))]
    })
  }, [])

  // The latest document, for callbacks that shouldn't re-create on every edit.
  const docRef = useRef(doc)
  docRef.current = doc
  const selectedPaths = useMemo(() => {
    if (!doc) return []
    const ids = new Set(selectedIds)
    return doc.paths.filter((p) => ids.has(p.id))
  }, [doc, selectedIds])
  const selectionBox = useMemo(() => union(selectedPaths.map((p) => pathBounds(p.d))), [selectedPaths])

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

  const onDragNode = (ref: NodeRef, part: NodePart, to: Pt, phase: 'move' | 'end', smooth: boolean) => {
    const id = selectedIds[0]
    if (!id) return
    // An anchor in a multi-node selection carries the others with it; a handle
    // keeps its partner in line unless the node is a corner or Alt is held.
    const others = part === 'anchor' && hasRef(selectedNodes, ref) && selectedNodes.length > 1 ? selectedNodes : null
    editPath(
      id,
      (subs) => {
        if (part !== 'anchor') return moveHandle(subs, ref, part, to, smooth)
        if (!others) return moveNode(subs, ref, part, to)
        const n = subs[ref.sub]?.nodes[ref.index]
        return n ? moveNodes(subs, others, to.x - n.x, to.y - n.y) : subs
      },
      `drag-${dragSeq.current}`,
    )
    if (phase === 'end') dragSeq.current++
  }

  /**
   * Moving or scaling the selected shapes. Each update is relative to the
   * drag's start, so it is applied to the paths as they were then, not
   * compounded onto the previous update; the whole drag is one undo step.
   */
  const transformBase = useRef<Map<string, { d: string; stroke?: number }> | null>(null)
  const onTransform = (m: Affine, phase: 'move' | 'end') => {
    if (!traced || !doc || !selectedIds.length) {
      transformBase.current = null
      return
    }
    const ids = new Set(selectedIds)
    // Captured here, not in the updater: React may run the updater after this
    // handler has already cleared the ref at the end of the drag.
    transformBase.current ??= new Map(doc.paths.filter((p) => ids.has(p.id)).map((p) => [p.id, { d: p.d, stroke: p.stroke }]))
    const base = transformBase.current
    commit((e) => {
      const d = docOf(e, traced)
      return { ...e, doc: { ...d, paths: d.paths.map((p) => (base.has(p.id) ? { ...p, ...transformShape(base.get(p.id)!, m) } : p)) } }
    }, `transform-${dragSeq.current}`)
    if (phase === 'end') {
      transformBase.current = null
      dragSeq.current++
    }
  }
  /** Apply a transform to the selection as one step (nudges, typed sizes). */
  const transformSelection = useCallback(
    (m: Affine, key: string | null = null) => {
      if (!selectedIds.length) return
      const ids = new Set(selectedIds)
      editDoc((d) => ({ ...d, paths: d.paths.map((p) => (ids.has(p.id) ? { ...p, ...transformShape(p, m) } : p)) }), key)
    },
    [editDoc, selectedIds],
  )
  /**
   * Typed X/Y/W/H. Like a drag, every keystroke is applied to the shapes as
   * they were when the field was first changed: typing "120" passes through
   * W = 1 and 12, and compounding those would round the shape away.
   */
  const boxSeq = useRef(0)
  const boxBase = useRef<{ box: Box; paths: Map<string, { d: string; stroke?: number }> } | null>(null)
  const setBox = (field: keyof Box, value: number, lock: boolean) => {
    if (!traced || !doc || !selectionBox) return
    const ids = new Set(selectedIds)
    boxBase.current ??= { box: selectionBox, paths: new Map(doc.paths.filter((p) => ids.has(p.id)).map((p) => [p.id, { d: p.d, stroke: p.stroke }])) }
    const { box, paths } = boxBase.current
    // Everything but the typed field comes from the captured box too, never
    // from the current one, which the previous keystroke has rounded.
    const next = { ...box, [field]: value }
    if (lock && field === 'w' && box.w > 0) next.h = (box.h * value) / box.w
    if (lock && field === 'h' && box.h > 0) next.w = (box.w * value) / box.h
    const m = boxToBox(box, next)
    commit((e) => {
      const d = docOf(e, traced)
      return { ...e, doc: { ...d, paths: d.paths.map((p) => (paths.has(p.id) ? { ...p, ...transformShape(paths.get(p.id)!, m) } : p)) } }
    }, `box-${boxSeq.current}`)
  }
  const boxDone = () => {
    boxBase.current = null
    boxSeq.current++
  }

  const onMarquee = (rect: Box, how: SelectMode) => {
    if (tool === 'nodes') {
      if (editingSubs) selectNodes(nodesInRect(editingSubs, rect), how)
      return
    }
    const hits = doc ? withGroups(doc, pathsInRect(shown, rect)) : pathsInRect(shown, rect)
    setSelectedIds((cur) => {
      if (how === 'set') return hits
      if (how === 'subtract') return cur.filter((id) => !hits.includes(id))
      return [...cur, ...hits.filter((id) => !cur.includes(id))]
    })
    setSelectedNodes([])
    if (hits.length) {
      setPanel('edit')
      startEditing()
    }
  }

  const enterNodes = useCallback(
    (id: string) => {
      setSelectedIds([id])
      setSelectedNodes([])
      setTool('nodes')
      setPanel('edit')
      startEditing()
    },
    [startEditing],
  )

  // ---- Node and shape operations (Nodes: add, smooth, sharpen, round; Select: simplify, rotate) ----

  /** Double-click on the edited shape's outline: a node there, selected. */
  const onAddNode = (at: Pt) => {
    if (!editing || !editingSubs) return
    const hit = nearestOnPath(editingSubs, at)
    if (!hit) return
    // Ends of a segment are nodes already.
    if (hit.t < 0.01 || hit.t > 0.99) return
    const { ref } = addNode(editingSubs, hit.sub, hit.seg, hit.t)
    editPath(editing.id, (subs) => addNode(subs, hit.sub, hit.seg, hit.t).subs)
    setSelectedNodes([ref])
  }
  /**
   * Apply `f` to each selected node of the edited shape, as one step. Highest
   * index first within each subpath, so a node that `f` turns into two (round)
   * never shifts one still to come.
   */
  const eachNode = (f: (subs: ReturnType<typeof parsePath>, ref: NodeRef) => ReturnType<typeof parsePath>): boolean => {
    if (!editing || !editingSubs || !selectedNodes.length) return false
    const refs = [...selectedNodes].sort((a, b) => a.sub - b.sub || b.index - a.index)
    const apply = (subs: ReturnType<typeof parsePath>) => refs.reduce((acc, r) => f(acc, r), subs)
    // Nothing to do (rounding a smooth node, sharpening a sharp one): no empty undo step.
    if (serializePath(apply(editingSubs)) === editing.d) return false
    editPath(editing.id, apply)
    return true
  }
  const nodeOp = (op: 'smooth' | 'sharpen' | 'round', radius = 0) => {
    const changed = eachNode((subs, r) => (op === 'smooth' ? smoothNode(subs, r) : op === 'sharpen' ? sharpenNode(subs, r) : roundNode(subs, r, radius)))
    // Rounding replaces each node with two, so the old refs no longer point at the corner.
    if (changed && op === 'round') setSelectedNodes([])
  }
  const simplifySelection = (tolerance: number) => {
    if (!selectedPaths.length) return
    const ids = new Set(selectedPaths.map((p) => p.id))
    editDoc((d) => ({ ...d, paths: d.paths.map((p) => (ids.has(p.id) ? { ...p, d: serializePath(simplifySubpaths(parsePath(p.d), tolerance)) } : p)) }))
  }
  const rotateSelection = (degrees: number) => {
    if (selectionBox && degrees) transformSelection(rotateAbout({ x: selectionBox.x + selectionBox.w / 2, y: selectionBox.y + selectionBox.h / 2 }, degrees))
  }
  /** What simplifying would leave, for the panel: counted only for selections small enough to be instant. */
  // Previewed only when the selection is small: simplifying is ~10 ms per 100
  // nodes, and the panel works it out after the selection has settled.
  const PREVIEW_NODES = 1500
  const nodesOfSelection = useMemo(() => {
    const n = selectedPaths.reduce((k, p) => k + nodeCount(parsePath(p.d)), 0)
    return n <= PREVIEW_NODES ? n : null
  }, [selectedPaths])
  const simplifyPreview = useCallback(
    (tolerance: number) => (nodesOfSelection !== null ? selectedPaths.reduce((n, p) => n + nodeCount(simplifySubpaths(parsePath(p.d), tolerance)), 0) : null),
    [selectedPaths, nodesOfSelection],
  )

  /** Group, ungroup and paint order: shape edits on the selection, each one undo step. */
  const groupSelection = () => selectedIds.length > 1 && editDoc((d) => groupPaths(d, selectedIds))
  const ungroupSelection = () => selectedIds.length && editDoc((d) => ungroupPaths(d, selectedIds))
  const arrangeSelection = (how: Arrange) => selectedIds.length && editDoc((d) => arrange(d, selectedIds, how))

  const deleteSelection = useCallback(() => {
    if (!selectedPaths.length) return
    if (tool === 'nodes' && selectedNodes.length && editing) {
      const id = editing.id
      const refs = selectedNodes
      editDoc((d) => {
        const p = d.paths.find((x) => x.id === id)
        if (!p) return d
        const subs = deleteNodes(parsePath(p.d), refs)
        return subs.length ? replacePath(d, id, serializePath(subs)) : deletePath(d, id)
      })
      setSelectedNodes([])
    } else {
      const ids = new Set(selectedPaths.map((p) => p.id))
      editDoc((d) => ({ ...d, paths: d.paths.filter((p) => !ids.has(p.id)) }))
      setSelectedIds([])
      setSelectedNodes([])
    }
  }, [editDoc, selectedPaths, selectedNodes, tool, editing])

  const moveAxis = (a: Axis) => {
    axisTouched.current = true
    setAxis(a)
  }

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
      setSelectedIds([])
      setSelectedNodes([])
      // Back to Select, so the washed-out preview stops hiding the result.
      setTool('select')
    } catch (error) {
      setMirrorError(`Mirroring failed: ${error instanceof Error ? error.message : String(error)}. Your drawing is unchanged.`)
    } finally {
      setMirroring(false)
    }
  }

  /** Arrow-key nudges in trace pixels: the selected nodes with the Nodes tool, else the selected shapes. */
  // A held arrow key repeats; the repeats undo with the press that started them.
  const nudgeSeq = useRef(0)
  const nudge = (dx: number, dy: number, repeat: boolean) => {
    if (!repeat) nudgeSeq.current++
    const key = `nudge-${nudgeSeq.current}`
    if (tool === 'nodes' && editing && selectedNodes.length) {
      const refs = selectedNodes
      editPath(editing.id, (subs) => moveNodes(subs, refs, dx, dy), key)
    } else if (tool === 'select') transformSelection(translate(dx, dy), key)
  }
  const chooseTool = useCallback((t: Tool) => {
    setTool(t)
    setPicking(null)
    setSelectedNodes([])
    // Nodes edits one shape and Mirror shows none, so neither keeps a
    // multi-selection that Delete could act on unseen.
    if (t === 'nodes') setSelectedIds((ids) => ids.slice(0, 1))
    else if (t === 'mirror') setSelectedIds([])
    if (t === 'mirror') void loadPaper().catch(() => {}) // warm it up while the user picks a side
  }, [])

  // Keyboard. The list the shortcuts panel shows is in components/Shortcuts.tsx; keep them in step.
  // The handler reads the latest render through a ref, so it is attached once.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKeyRef.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
  {
    onKeyRef.current = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el &&
        (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && !['color', 'range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)))
      if (typing || shortcutsOpen) return
      if (picking && e.key === 'Escape') {
        setPicking(null)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const hasDoc = !!doc
      if (mod && key === 'z') {
        e.preventDefault()
        historyStep(e.shiftKey ? 'redo' : 'undo')
      } else if (mod && key === 'y') {
        e.preventDefault()
        historyStep('redo')
      } else if (mod && key === 'g' && hasDoc && selectedIds.length) {
        e.preventDefault()
        if (e.shiftKey) ungroupSelection()
        else groupSelection()
      } else if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft') && hasDoc && selectedIds.length) {
        e.preventDefault()
        const up = e.code === 'BracketRight'
        arrangeSelection(e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward')
      } else if (mod && key === 'a' && hasDoc) {
        e.preventDefault()
        if (tool === 'nodes' && editingSubs) setSelectedNodes(allRefs(editingSubs))
        else {
          if (tool !== 'select') setTool('select')
          setSelectedIds(shown.map((p) => p.id))
          setSelectedNodes([])
          setPanel('edit')
          startEditing()
        }
      } else if (mod || e.altKey) {
        return
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length && tool !== 'mirror') {
        e.preventDefault()
        deleteSelection()
      } else if (e.key === 'Escape') {
        if (selectedNodes.length) setSelectedNodes([])
        else if (selectedIds.length) setSelectedIds([])
        else if (tool !== 'select') setTool('select')
      } else if (e.key.startsWith('Arrow') && selectedIds.length && !(el && (el.tagName === 'INPUT' || el.getAttribute('role') === 'slider'))) {
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0, e.repeat)
      } else if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setShortcutsOpen(true)
      } else if (hasDoc && !e.shiftKey && (key === 'v' || key === 'a' || key === 'm')) {
        if (key !== 'm' || !strokes) chooseTool(key === 'v' ? 'select' : key === 'a' ? 'nodes' : 'mirror')
        setPanel('edit')
        startEditing()
      }
    }
  }

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
  const size: ExportSize = exportSize && doc ? { ...exportSize, height: (exportSize.width * doc.height) / doc.width } : { width: doc?.width ?? 0, height: doc?.height ?? 0, unit: 'px' }
  /** The optimised SVG at the export size. */
  const finalSvg = async () => withSize(fresh ?? (await optimizeHere(svg)), size)

  const download = async () => save(new Blob([await finalSvg()], { type: 'image/svg+xml' }), `${source!.name}.svg`)

  /** What PDF and EPS draw: the shapes as shown, with the background. */
  const drawable = () => ({ width: doc!.width, height: doc!.height, background: edits.background ? normalizeHex(edits.background) : null, paths: visiblePaths(doc!, edits.inks) })
  const downloadPdf = () => save(new Blob([buildPdf(drawable(), size, source!.name) as BlobPart], { type: 'application/pdf' }), `${source!.name}.pdf`)
  const downloadDxf = () => save(new Blob([buildDxf(drawable(), size)], { type: 'application/dxf' }), `${source!.name}.dxf`)
  const downloadEps = () => save(new Blob([buildEps(drawable(), size, source!.name)], { type: 'application/postscript' }), `${source!.name}.eps`)
  /** A PNG rendered by the browser from the SVG, at the export size × scale (px) or at a dpi (physical units). */
  const downloadPng = async (scale: number, dpi: number) => {
    const { width, height } = pngPixels(size, scale, dpi)
    setPngError(null)
    if (width * height > MAX_PNG_PIXELS) return setPngError(`${width} × ${height} is larger than browsers can draw. Choose a smaller size or resolution.`)
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([withSize(fresh ?? (await optimizeHere(svg)), { width, height, unit: 'px' })], { type: 'image/svg+xml' }))
    try {
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      ctx.drawImage(img, 0, 0, width, height)
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
      if (!blob) throw new Error('no PNG')
      save(blob, `${source!.name}.png`)
    } catch {
      setPngError('The browser couldn’t make that PNG. Try a smaller size or resolution.')
    } finally {
      URL.revokeObjectURL(img.src)
    }
  }

  const copy = async () => {
    await navigator.clipboard.writeText(await finalSvg())
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const downloadLayers = async () => {
    const files: Record<string, Uint8Array> = {}
    for (const f of layerFiles(doc!, edits.inks, source!.name, edits.background)) files[f.name] = strToU8(withSize(await optimizeHere(f.svg), size))
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
        setSelectedIds([])
        setSelectedNodes([])
      }
      setSettings(next)
      setPicking(null)
      // A size search (or its result) was for the settings before this change.
      sizeClient.dispose()
      setSizeRun(null)
    })

  /** Search for settings that fit the SVG under `kb`. */
  const findSize = async (kb: number) => {
    // The image as traced: the prepared copy when an AI step is on.
    if (!traceSource) return
    const maxEdge = maxTraceEdge(settings.preset)
    const upscale = settings.preset !== 'pixel'
    const { rgba, width, height } = pixelsOf(traceSource, maxEdge, upscale)
    const target = Math.round(kb * 1024)
    const from = settings
    setSizeRun({ target, from, tried: 0, best: null, result: null })
    const res = await sizeClient.fitSize(rgba, width, height, from, target, (tried, best) => setSizeRun((r) => (r && r.from === from ? { ...r, tried, best } : r)))
    setSizeRun((r) => {
      if (!r || r.from !== from) return r // cancelled, or another search started
      if (res?.type === 'sized') return { ...r, tried: res.result.tried, best: res.result.best, result: res.result }
      return { ...r, error: res?.type === 'error' ? res.message : 'The search stopped.' }
    })
  }
  const cancelSize = () => {
    sizeClient.dispose()
    setSizeRun(null)
  }
  const applySize = () => {
    if (!sizeRun?.result) return
    // Only what the search changes, on top of the settings as they are now.
    const { colors, speckle, smoothing } = sizeRun.result.best.settings
    changeSettings({ ...settings, colors, speckle, smoothing })
  }

  /**
   * Fold one traced colour into another. It's a trace setting, so it re-traces
   * (asking first if shapes are edited), and the shared edge disappears; Unmerge
   * in the colour list takes it back.
   */
  /** An opened SVG, traced as an image instead (the drawing of it), after asking if shapes are edited. */
  const traceInstead = () =>
    guard('Tracing the SVG as an image replaces its shapes and your edits to them.', 'Trace it as an image', () => {
      if (detached) commit((e) => ({ ...e, doc: null }))
      setSelectedIds([])
      setSelectedNodes([])
      setSource((s) => (s ? { ...s, svg: undefined } : s))
      setPanel('trace')
    })

  const mergeInk = (from: string, into: string) => changeSettings({ ...settings, merge: { ...settings.merge, [from]: into } })
  const unmergeInk = (from: string) => {
    const merge = { ...settings.merge }
    delete merge[from]
    changeSettings({ ...settings, merge })
  }

  // ---- Eyedropper -------------------------------------------------------------
  /** A picked colour lands on its target as one undo step. */
  const applyPicked = (target: string, hex: string) => {
    const v = normalizeHex(hex)
    if (!v) return
    if (target === 'background') commit((e) => ({ ...e, background: v }))
    else editInks((i) => recolorInk(i, target, v))
  }
  const onPick = (at: Pt) => {
    if (!picking || !source || !doc) return
    // An ink that a re-trace took away has nothing to recolour.
    if (picking.target !== 'background' && !inks.some((i) => i.hex === picking.target)) return setPicking(null)
    const hex = colourAt(traceSource ?? source, at.x / doc.width, at.y / doc.height)
    // A transparent pixel has no colour: stay armed for another click.
    if (!hex) return
    applyPicked(picking.target, hex)
    setPicking(null)
  }
  type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> }
  const screenDropper = typeof window !== 'undefined' ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined
  /** Chromium's EyeDropper: any pixel on screen. Cancelled (Esc) leaves things as they were. */
  const pickFromScreen = async () => {
    if (!picking || !screenDropper) return
    const target = picking.target
    setPicking(null)
    try {
      const { sRGBHex } = await new screenDropper().open()
      applyPicked(target, sRGBHex)
    } catch {
      /* cancelled */
    }
  }

  const choosePreset = (id: PresetId) => {
    const next = settingsFor(id)
    // Reset (the same preset again) puts the sliders back but keeps merges:
    // they're decisions about this image's colours, not settings to tune.
    if (id === settings.preset) next.merge = settings.merge
    next.removeBackground = settings.removeBackground
    next.aiUpscale = settings.aiUpscale
    if (isInk(id) && source && hasDarkBackground(source)) next.lightInk = true
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
        // A batch is open (and modal): drops onto it are ignored, not traced behind it.
        if (batch) return
        const files = [...e.dataTransfer.files]
        if (files.length > 1) setBatch(files)
        else if (files[0]) open(files[0])
      }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-rule px-5">
        <div className="flex items-baseline gap-3">
          <h1 className="leading-none">
            {/* The landing page and docs live beside the app, at the site root. */}
            <a href="/" className="wordmark rounded-sm hover:text-ink-muted" title="Inlay home">
              Inlay
            </a>
          </h1>
          <p className="hidden text-[13px] text-ink-muted sm:block">Image to SVG, in your browser.</p>
        </div>
        <div className="flex items-center gap-1 text-[13px]">
          <IconButton label="Keyboard shortcuts" hint="Keyboard shortcuts (?)" aria-keyshortcuts="?" onClick={() => setShortcutsOpen(true)}>
            <KeyboardIcon />
          </IconButton>
          <IconButton label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={toggle}>
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </IconButton>
          <AccountNav />
        </div>
      </header>

      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {batch && <BatchDialog key={batch.map((f) => f.name).join('|')} files={batch} settings={settings} onClose={() => setBatch(null)} onSave={(zip) => save(zip, `inlay-${settings.preset}-${batch.length}.zip`)} />}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED.join(',')}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length > 1) setBatch(files)
          else if (files[0]) open(files[0])
          e.target.value = ''
        }}
      />

      <main className="flex min-h-0 flex-1 flex-col lg:flex-row" data-traces={traceCount}>
        {/* ---- Work surface ---- */}
        <div className="relative flex min-h-[60vh] flex-1 flex-col lg:min-h-0">
          {source && trace ? (
            <>
              <div className="relative min-h-0 flex-1">
                {picking && (
                  <div role="status" className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md border border-rule bg-paper px-3 py-2 text-[13px] shadow-md" data-picking={picking.target}>
                    <span>Click the image to pick a colour from the original.</span>
                    {screenDropper && (
                      <button className="text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={pickFromScreen}>
                        Pick from screen
                      </button>
                    )}
                    <button className="text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setPicking(null)}>
                      Cancel
                    </button>
                  </div>
                )}
                <Canvas
                  imageUrl={(traceSource ?? source).url}
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
                  background={edits.background}
                  selectedIds={selectedIds}
                  selectedNodes={selectedNodes}
                  axis={axis}
                  onSelect={select}
                  onSelectNodes={selectNodes}
                  onMarquee={onMarquee}
                  onEnterNodes={enterNodes}
                  onDragNode={onDragNode}
                  onTransform={onTransform}
                  onAddNode={onAddNode}
                  picking={!!picking}
                  onPick={onPick}
                  onAxis={moveAxis}
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
                      onClick={() => {
                        viewChosen.current = true
                        setMode(v)
                      }}
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
                <div className="flex shrink-0 gap-1.5">
                  <button className="btn" onClick={() => fileInput.current?.click()}>
                    Replace
                  </button>
                  <button className="btn" onClick={startOver} title="Clear this image and your edits, here and from this browser’s storage">
                    Start over
                  </button>
                </div>
              </div>
            )}
            {source && (
              sessionNote && (
                <p className="border-b border-rule px-5 py-2 text-[12px] text-ink-faint" data-session={sessionNote}>
                  {sessionNote === 'restored' ? 'Restored from your last visit. ' : ''}Your image and edits are kept in this browser only, so a reload doesn’t lose them.
                </p>
              )
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
                    onClick={() => {
                      setPanel(id)
                      if (id === 'edit') startEditing()
                    }}
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
                onTool={chooseTool}
                canUndo={history.past.length > 0}
                canRedo={history.future.length > 0}
                onUndo={() => historyStep('undo')}
                onRedo={() => historyStep('redo')}
                detached={detached}
                selection={
                  selectedPaths.length
                    ? { key: selectedIds.join(' '), shapes: selectedPaths.length, nodes: editingSubs ? nodeCount(editingSubs) : 0, selectedNodes: tool === 'nodes' ? selectedNodes.length : 0, box: selectionBox }
                    : null
                }
                onDeleteSelection={deleteSelection}
                onGroup={groupSelection}
                onUngroup={ungroupSelection}
                onArrange={arrangeSelection}
                grouped={!!doc && doc.paths.some((p) => p.group && selectedIds.includes(p.id))}
                onBox={setBox}
                onBoxDone={boxDone}
                onNodeOp={nodeOp}
                selectionNodes={nodesOfSelection}
                simplifyPreview={simplifyPreview}
                onSimplify={simplifySelection}
                onRotate={rotateSelection}
                axis={axis}
                width={doc.width}
                height={doc.height}
                onAxis={moveAxis}
                strokes={strokes}
                detected={detected?.axis ?? null}
                mirroring={mirroring}
                mirrorError={mirrorError}
                onMirror={mirror}
              />
            )}
            {doc && (
              <Inks
                inks={inks}
                edits={edits.inks}
                selectedInk={selectedPaths.length === 1 ? selectedPaths[0].fill : null}
                onReplace={(hex, to) => {
                  const v = normalizeHex(to)
                  if (v) editInks((i) => recolorInk(i, hex, v), `recolor-${hex}-${recolorSeq.current}`)
                }}
                onReplaceDone={() => recolorSeq.current++}
                onRemove={(hex) => editInks((i) => removeInk(i, hex))}
                onRestore={(hex) => editInks((i) => restoreInk(i, hex))}
                onRestoreAll={() => editInks(() => NO_INKS)}
                background={edits.background}
                onBackground={(c) => {
                  // Adding and removing are each their own undo step; colour
                  // changes in one picker session undo together.
                  const sweep = c !== null && edits.background !== null
                  if (!sweep) backgroundSeq.current++
                  commit((e) => ({ ...e, background: c === null ? null : normalizeHex(c) }), sweep ? `background-${backgroundSeq.current}` : null)
                }}
                onBackgroundDone={() => backgroundSeq.current++}
                picking={picking?.target ?? null}
                onPick={(target) => setPicking((p) => (p?.target === target ? null : { target }))}
                merged={canMerge(settings.preset) ? settings.merge : null}
                onMerge={mergeInk}
                onUnmerge={unmergeInk}
              />
            )}
            </div>
            <div role="tabpanel" id="panel-trace" aria-labelledby="tab-trace" hidden={!!doc && panel !== 'trace'}>
              {source?.svg ? (
                <SvgOpened svg={source.svg} onTrace={() => traceInstead()} />
              ) : (
              <Controls
                settings={settings}
                onChange={changeSettings}
                onPreset={choosePreset}
                measuredStroke={settings.preset === 'centerline' && settings.strokeWidth === 0 ? (trace?.paths[0]?.stroke ?? null) : null}
                prep={{ smallImage: !!source && Math.max(source.bitmap.width, source.bitmap.height) < UPSCALE_BELOW, status: prepStatus, error: prepError }}
                currentBytes={stats?.bytes ?? null}
                sizeRun={sizeRun}
                onFindSize={findSize}
                onApplySize={applySize}
                onCancelSize={cancelSize}
              />
              )}
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
              {status.kind === 'opened' && `Opened the SVG${fresh ? '' : ', optimising…'}`}
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
            {doc && (
              <ExportOptions
                size={size}
                aspect={doc.width / doc.height}
                onSize={(s) => setExportSize({ width: s.width, unit: s.unit })}
                maxPixels={MAX_PNG_PIXELS}
                pngError={pngError}
                onReset={() => setExportSize(null)}
                isDefault={exportSize === null}
                disabled={!trace}
                onPng={downloadPng}
                onPdf={downloadPdf}
                onEps={downloadEps}
                onDxf={downloadDxf}
              />
            )}
            {/* HD (beta), never for an opened SVG: a full-size trace for images bigger than the app traces, or a 4× upscale for small ones. */}
            {traceSource && !traceSource.svg && (Math.max(traceSource.bitmap.width, traceSource.bitmap.height) > maxTraceEdge(settings.preset) || traceSource.bitmap.width * traceSource.bitmap.height <= UPSCALE.maxPixels) && (
              <Hd
                key={traceSource.url}
                kind={Math.max(traceSource.bitmap.width, traceSource.bitmap.height) > maxTraceEdge(settings.preset) ? 'trace' : 'upscale'}
                bitmap={traceSource.bitmap}
                settings={settings}
                traceEdge={maxTraceEdge(settings.preset)}
                onSave={(blob) => save(blob, `${source!.name}-hd.${blob.type === 'image/png' ? 'png' : 'svg'}`)}
                onOpen={(blob) => void openNow(blob, `${source!.name}-hd.${blob.type === 'image/png' ? 'png' : 'svg'}`)}
              />
            )}
          </div>

          {/* No room for a page footer, so one quiet line ends the sidebar. */}
          <nav aria-label="About Inlay" className="flex gap-4 border-t border-rule px-5 py-2.5 text-[12px] text-ink-muted">
            <a href="/docs/overview/" className="hover:text-ink">
              Docs
            </a>
            <a href="/privacy/" className="hover:text-ink">
              Privacy
            </a>
            <a href="https://github.com/mtblck/inlaytrace" className="hover:text-ink">
              Source
            </a>
            <a href="https://ko-fi.com/inlay" className="hover:text-ink">
              Support
            </a>
          </nav>
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
              Or paste one, or choose a file. PNG, JPG, WebP, GIF or BMP to trace, or an SVG to edit; several at once to trace them all. It never leaves this device: everything runs in your browser.
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

/** Safari's canvas limit, the smallest of the browsers': anything larger fails to draw. */
const MAX_PNG_PIXELS = 16_777_216

let svgoHere: Promise<typeof import('svgo/browser')> | undefined
async function optimizeHere(svg: string) {
  svgoHere ??= import('svgo/browser')
  const { optimize } = await svgoHere
  return optimize(svg, SVGO).data
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** The Trace tab for an opened SVG: what came in, what didn't, and the way to trace it instead. */
function SvgOpened({ svg, onTrace }: { svg: NonNullable<Source['svg']>; onTrace: () => void }) {
  const fills = svg.trace.paths.filter((p) => !p.stroke).length
  const strokes = svg.trace.paths.length - fills
  return (
    <section className="space-y-3 border-b border-rule px-5 py-5" data-svg-opened="">
      <h2 className="text-[13.5px] font-medium">An SVG to edit</h2>
      <p className="text-[13px]">
        Opened {fills ? `${fills} ${fills === 1 ? 'shape' : 'shapes'}` : ''}
        {fills && strokes ? ' and ' : ''}
        {strokes ? `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}` : ''}, ready in the Edit tab. Nothing is traced: the SVG’s own paths are the drawing.
      </p>
      {svg.notes.length > 0 && (
        <div className="text-[12.5px]" role="status">
          <p className="font-medium">Not kept as it was:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {svg.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <button className="btn w-full" onClick={onTrace}>
        Trace it as an image instead
      </button>
    </section>
  )
}

