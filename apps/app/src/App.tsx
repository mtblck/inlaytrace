import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { zipSync, strToU8 } from 'fflate'
import { TraceClient } from './engine/client'
import { BatchDialog } from './components/Batch'
import { SVGO } from './engine/svgo'
import { PrepClient } from './engine/prepClient'
import type { PrepStage } from './engine/prep'
import { paintOut, type TextRun } from './engine/text/match'
import type { Candidate } from './engine/targetSize'
import type { SizeRun } from './components/Controls'
import { canMerge, canSetText, canSmooth, isInk, maxTraceEdge, ownPaletteOf, settingsFor, toTraceOptions, type PresetId, type Settings } from './engine/presets'
import { addColors, nearestColor, OWN_COLORS } from './lib/colors'
import { swatchColors, swatchFile, type SwatchFormat } from './lib/swatches'
import { ACCEPTED, canTraceFiner, colourAt, hasDarkBackground, loadSource, looksBlurry, looksLikePhoto, pixelsOf, UPSCALE_BELOW, type Pixels, type Source } from './lib/image'
import { formatBytes, normalizeHex, parseTrace, statsOf, withText, type Trace } from './lib/svg'
import {
  buildSvg,
  deletePath,
  docFromTrace,
  arrange,
  docOf,
  flagIds,
  stylePath,
  groupPaths,
  hasStrokes,
  reserveGroups,
  ungroupPaths,
  withGroups,
  type Arrange,
  inksOf,
  layerFiles,
  newId,
  NO_EDITS,
  NO_INKS,
  recolorInk,
  removeInk,
  replacePath,
  reserveIds,
  restoreInk,
  shownFill,
  visiblePaths,
  type Edits,
} from './lib/doc'
import { push, redo, startHistory, undo, type History } from './lib/history'
import { centreAxis, likelyAxis, mirrorDoc, type Axis } from './lib/mirror'
import { booleanOp, type BooleanOp } from './lib/boolean'
import { BucketFields, ShapesList, StyleFields, type ShapeFlag, type StylePatch } from './components/Shapes'
import { bucketFill } from './lib/bucket'
import { addShape, SHAPE_DEFAULT, type ShapeSettings } from './lib/draw'
import { eraseDoc, knifeDoc } from './lib/cut'
import { followShared, simplifyShared } from './lib/shared'
import { groupByObject, objectFiles } from './lib/objects'
import { alignMoves, distributeMoves, type AlignHow, type DistributeHow } from './lib/align'
import { SNAP_DEFAULT, type SnapSettings } from './lib/snap'
import type { PenCommand } from './components/DrawLayer'
import { addOp, BRUSH_DEFAULT, BRUSH_MAX, BRUSH_MIN, FILL_DEFAULT, MAX_OPS, pixelOps, type BrushSettings, type CleanupOp, type FillSettings } from './lib/cleanup'
import type { CleanFocus, CleanTool, CropDraft } from './components/CleanUp'
/** The eyedropper's target for the Pen and Shape tools' colour (#210). */
const DRAW_COLOUR = 'draw-colour'
/** Clean up's tool keys. */
const CLEAN_KEYS = { c: 'crop', l: 'straighten', b: 'brush', e: 'eraser', d: 'despeckle', j: 'heal', g: 'fill', w: 'wand', k: 'keep', r: 'remove' } as const satisfies Record<string, CleanTool>
import { loadPaper } from './lib/paper'
import { deleteNodes, moveHandle, moveNode, moveNodes, parsePath, serializePath, nodeCount, type NodePart, type NodeRef, type Pt } from './lib/pathdata'
import { addNode, nearestOnPath, roundNode, sharpenNode, simplifySubpaths, smoothNode } from './lib/nodeops'
import { allRefs, boxToBox, rotateAbout, hasRef, nodesInRect, pathBounds, pathsInRect, transformShape, translate, union, type Affine, type Box } from './lib/transform'
import { usePersisted } from './lib/persisted'
import { bounds, effective, fromSlider, snap, step, toSlider, type Zoom } from './lib/zoom'
import { sampleImage } from './lib/sample'
import { track } from './lib/track'
import { Canvas, type Overlays, type SelectMode, type Tool, type ViewMode } from './components/Canvas'
import { ShortcutsDialog } from './components/Shortcuts'
import { ExportOptions } from './components/ExportOptions'
import { CLEAN_TOOLS, EDIT_TOOLS, ModeSwitch, ToolRail, useWide, type WorkMode } from './components/Workspace'
import { Dock, DOCK_ICON, MoreMenu, type DockSlot } from './components/Dock'
import { clearSession, loadSession, newSessionId, saveImage, saveState } from './lib/session'
import { buildDxf, buildEps, buildPdf, pngPixels, withSize, type ExportSize } from './lib/vectorExport'
import { IconButton, KeyboardIcon, MoonIcon, RedoIcon, SunIcon, UndoIcon } from './components/IconButton'
import { EditPanel } from './components/EditPanel'
import { Support, SUPPORT_URL } from './components/Support'
import { Controls, STAGE } from './components/Controls'
import { Inks } from './components/Inks'
import { useTheme } from './lib/theme'

/** The parts of Trace's panel a phone shows one at a time (the dock's buttons). */
type PhoneView = 'image' | 'type' | 'tune' | 'export'

type Status = { kind: 'idle' } | { kind: 'tracing' } | { kind: 'done'; ms: number } | { kind: 'opened' } | { kind: 'error'; message: string }

const NO_TEXT: TextRun[] = []
// Clean up is loaded the first time it opens, with the replay it runs.
const CleanCanvas = lazy(() => import('./components/CleanUp').then((m) => ({ default: m.CleanCanvas })))
const CleanPanel = lazy(() => import('./components/CleanUp').then((m) => ({ default: m.CleanPanel })))
const NO_CLEANUP: CleanupOp[] = []

/** Logo's defaults, keeping your own colours: they're about what you can print, not this image. */
const keepOwnColors = (s: Settings): Settings => ({ ...settingsFor('logo'), ownColors: s.ownColors, useOwnColors: s.useOwnColors })

export default function App() {
  const client = useMemo(() => new TraceClient(), [])
  useEffect(() => () => client.dispose(), [client])
  const prepClient = useMemo(() => new PrepClient(), [])
  useEffect(() => () => prepClient.stop(), [prepClient])
  // `text`: lines found in the image, drawn as type (recognise text), in the prepared image's pixels.
  // The worker's result as it came back (`prepRaw`), then with the mask strokes laid over it (`prepared`, keyed by both).
  type PrepRaw = { key: string; source: Source; rgba: Uint8ClampedArray; width: number; height: number; text: TextRun[] }
  const [prepRaw, setPrepRaw] = useState<PrepRaw | null>(null)
  const prepRawRef = useRef<PrepRaw | null>(null)
  const [prepared, setPrepared] = useState<{ key: string; mask: string; source: Source; text: TextRun[] } | null>(null)
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
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  /** Whether a preset was chosen for the image on screen; until one is, a photo gets the Poster suggestion. */
  const [presetPicked, setPresetPicked] = useState(false)
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
   * it (Edit mode, or selecting a shape) the view switches to Vector, so the
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
  /** Opened as the SVG editor (/app/?mode=edit, from the site's /svg-editor/ page): the empty screen asks for an SVG, and the first file opens in Edit mode. */
  const [editEntry] = useState(() => typeof location !== 'undefined' && new URLSearchParams(location.search).get('mode') === 'edit')
  const editFirst = useRef(editEntry)
  /**
   * Once a file has opened, ?mode=edit has done its job: drop it from the URL,
   * so a reload restores the work like any other session instead of starting empty.
   */
  const consumeEditEntry = () => {
    editFirst.current = false
    const url = new URL(location.href)
    url.searchParams.delete('mode')
    window.history.replaceState(window.history.state, '', url)
  }
  /** The workspace's mode (components/Workspace.tsx): Trace sets up the trace, Edit fixes its shapes. */
  const [workMode, setWorkMode] = useState<WorkMode>('trace')
  /** Which part of Trace's panel a phone shows, picked in the dock. */
  const [phoneView, setPhoneView] = useState<PhoneView>('type')
  /** A line under the canvas on a phone, after a dock button that needs something first. */
  const [dockNote, setDockNote] = useState<string | null>(null)
  const aside = useRef<HTMLElement>(null)
  // The note goes after a while, or once there is a selection or another mode (below).
  useEffect(() => {
    if (!dockNote) return
    const t = setTimeout(() => setDockNote(null), 5000)
    return () => clearTimeout(t)
  }, [dockNote])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  useEffect(() => setDockNote(null), [selectedIds, workMode])
  /** Nodes selected in the shape the Nodes tool is editing (the first selected shape). */
  const [selectedNodes, setSelectedNodes] = useState<NodeRef[]>([])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** The eyedropper is armed for an ink (its traced hex) or the background. */
  const [picking, setPicking] = useState<{ target: string } | null>(null)
  // When the eyedropper is put away (a pick, Esc, Cancel), the canvas's
  // keyboard target unmounts and focus would fall to the page: hand it back to
  // whatever armed the eyedropper (#223).
  const pickOpener = useRef<HTMLElement | null>(null)
  const armed = !!picking
  useEffect(() => {
    if (armed) {
      pickOpener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      return
    }
    const opener = pickOpener.current
    pickOpener.current = null
    const active = document.activeElement
    if (opener?.isConnected && (!active || active === document.body)) opener.focus()
  }, [armed])
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
  const [optimized, setOptimized] = useState<{ from: string; svg: string; trace: Trace } | null>(null)
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
  const pixelCache = useRef<{ source: Source; maxEdge: number; upscale: boolean; fine: boolean; pixels: Pixels } | null>(null)

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
      setPresetPicked(!!restore)
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
      // Opened from the SVG editor page (/app/?mode=edit): the first file opens in Edit, traced first if it's an image.
      const toEdit = !restore && editFirst.current
      if (editFirst.current) consumeEditEntry()
      setWorkMode(restore?.edits.doc || next.svg || toEdit ? 'edit' : 'trace')
      setMode(restore || toEdit ? 'vector' : 'split')
      viewChosen.current = !!restore || toEdit
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
    // The SVG editor link starts empty, waiting for a file, rather than bringing back the last image.
    if (editEntry) return
    const seqAtStart = openSeq.current
    void loadSession().then((saved) => {
      // Anything opened meanwhile (a drop, a paste, the sample) wins.
      if (!saved || openSeq.current !== seqAtStart) return
      void openNow(saved.image.file, saved.image.name, { settings: saved.settings, edits: saved.edits, id: saved.image.id })
    })
  }, [openNow, editEntry])
  // A batch isn't the first file: whatever opens after it opens as usual.
  useEffect(() => {
    if (batch && editFirst.current) consumeEditEntry()
  }, [batch])
  // The image is stored once, after it has traced: one that can't be traced is never brought back.
  const imageSaved = useRef(false)
  useEffect(() => {
    if (!source || !trace || !fileRef.current || !sessionId.current || imageSaved.current) return
    imageSaved.current = true
    const id = sessionId.current
    void saveImage({ id, file: fileRef.current, name: source.name }).then((ok) => ok && sessionId.current === id && setSessionNote((n) => n ?? 'saved'))
  }, [source, trace])
  // Settings and edits, as you work: 600 ms after the last change (a drag is
  // many changes), and at once when the page is hidden or unloads, so a
  // reload straight after a change keeps it (it was lost before).
  const pendingState = useRef<Parameters<typeof saveState>[0] | null>(null)
  useEffect(() => {
    if (!source || !trace || !sessionId.current) return
    const state = { id: sessionId.current, settings, edits }
    pendingState.current = state
    const t = setTimeout(() => {
      pendingState.current = null
      void saveState(state)
    }, 600)
    return () => clearTimeout(t)
  }, [source, trace, settings, edits])
  useEffect(() => {
    const flush = () => {
      const state = pendingState.current
      if (!state || state.id !== sessionId.current) return
      pendingState.current = null
      void saveState(state)
    }
    const onHidden = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])
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
        setSettings(keepOwnColors)
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
    setSettings(keepOwnColors)
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

  // ---- Clean up -----------------------------------------------------------------
  // Clean up (#199) edits the image before tracing, as a list of ops in the
  // edits (so Undo and the session carry it). The trace follows the list
  // outside the mode; inside it, the list it was traced from is held while the
  // canvas previews the new one, so leaving the mode re-traces once.
  const cleanup = edits.cleanup ?? NO_CLEANUP
  const [heldCleanup, setHeldCleanup] = useState<CleanupOp[] | null>(null)
  const tracedCleanup = workMode === 'clean' && heldCleanup ? heldCleanup : cleanup
  const cleanable = !!source && !source.svg
  // Written out once per list, not per render: strokes make it long.
  const tracedJson = useMemo(() => JSON.stringify(tracedCleanup), [tracedCleanup])
  const cleanupJson = useMemo(() => JSON.stringify(cleanup), [cleanup])
  /** The list differs from the one traced: leaving Clean up re-traces. Compared by content, so undoing back to it counts as no change. */
  const cleanupPending = cleanupJson !== tracedJson
  // Mask strokes (#204) change no pixels, so they're left out of the cleaned image's key: painting the mask doesn't run background removal again.
  const tracedPixels = useMemo(() => pixelOps(tracedCleanup), [tracedCleanup])
  const tracedPixelJson = useMemo(() => JSON.stringify(tracedPixels), [tracedPixels])
  const cleanupPixelJson = useMemo(() => JSON.stringify(pixelOps(cleanup)), [cleanup])
  const cleanKey = cleanable && tracedPixels.length ? `${source!.url}|${tracedPixelJson}` : null
  const [cleaned, setCleaned] = useState<{ key: string; source: Source } | null>(null)
  useEffect(() => {
    const drop = (prev: { source: Source } | null) => {
      if (prev && prev.source !== source) {
        URL.revokeObjectURL(prev.source.url)
        prev.source.bitmap.close()
      }
    }
    // Nothing to clean (none, or another image): let the last cleaned image go.
    if (!cleanKey || !source) return void setCleaned((prev) => (drop(prev), null))
    let live = true
    const ops = tracedPixels
    void import('./lib/cleanupRun')
      .then((m) => m.cleanedSource(source, ops))
      .then((s) => {
        if (!live) return void (URL.revokeObjectURL(s.url), s.bitmap.close())
        setCleaned((prev) => (drop(prev), { key: cleanKey, source: s }))
      })
      .catch((error) => {
        if (!live) return
        // Trace the original rather than nothing, and say why.
        setLoadError(`Clean-up couldn’t be applied (${error instanceof Error ? error.message : String(error)}), so the original is traced.`)
        setCleaned((prev) => (drop(prev), { key: cleanKey, source }))
      })
    return () => {
      live = false
    }
    // The key names the source and the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanKey, source])
  /** The image the rest of the pipeline sees: the cleaned one once it's ready, or the original when there's nothing to clean. */
  const base = !source ? null : cleanKey ? (cleaned?.key === cleanKey ? cleaned.source : null) : source
  const [cleanTool, setCleanTool] = useState<CleanTool>('crop')
  const [cropDraft, setCropDraft] = useState<CropDraft | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [brush, setBrush] = useState<BrushSettings>(BRUSH_DEFAULT)
  /** The next click on the image picks the brush colour. */
  const [cleanPick, setCleanPick] = useState(false)
  const [fillSettings, setFillSettings] = useState<FillSettings>(FILL_DEFAULT)
  /** The magic wand's clicks (x, y, … in fractions of the cleaned image), or null with nothing selected. */
  const [wand, setWand] = useState<number[] | null>(null)
  /** Fix in image (#208): the shapes Clean up opened on, zoomed to and highlighted. */
  const [cleanFocus, setCleanFocus] = useState<CleanFocus | null>(null)
  const chooseCleanTool = (t: CleanTool) => {
    setCleanTool(t)
    setCropDraft(null)
    setCleanPick(false)
    setWand(null)
  }
  const cleanSeq = useRef(0)
  /**
   * Change the list. The first change made over shape edits asks first, and
   * clears them in the same step, so one Undo brings back both the edits and
   * the image they were drawn on.
   */
  const editCleanup = (next: CleanupOp[], key?: string) => {
    if (next.length > MAX_OPS && next.length > cleanup.length) return setLoadError(`Clean up keeps up to ${MAX_OPS} changes. Undo all clean-up, or download the cleaned PNG and open that to carry on.`)
    const k = key ?? `cleanup-${++cleanSeq.current}`
    if (!detached) return commit((e) => ({ ...e, cleanup: next }), k)
    guard('Cleaning up the image re-traces it, which replaces your shape edits. Undo brings them back.', 'Discard edits and clean up', () => {
      commit((e) => ({ ...e, cleanup: next, doc: null }))
      setSelectedIds([])
      setSelectedNodes([])
    })
  }
  // A crop box is drawn on the image as it is: any other change to it (a turn, an undo) puts the box away.
  // Keep and Remove go with Remove the background.
  useEffect(() => {
    if (!settings.removeBackground && (cleanTool === 'keep' || cleanTool === 'remove')) setCleanTool('brush')
  }, [settings.removeBackground, cleanTool])
  // So is the wand's selection: it was found in pixels that have changed.
  useEffect(() => {
    setCropDraft(null)
    setWand(null)
  }, [cleanup])
  const applyCrop = () => {
    if (!cropDraft) return
    editCleanup(addOp(cleanup, { kind: 'crop', ...cropDraft }))
    setCropDraft(null)
  }

  // ---- AI preparation ---------------------------------------------------------
  // Background removal and 4× upscaling run before tracing, in a worker of
  // their own, and give a prepared copy of the image that's traced (and
  // compared against) instead. Upscaling only applies to small images.
  // Recognising text finds lines to draw as type; the tracer gets the image
  // with them painted out.
  const wantUpscale = settings.aiUpscale && !!base && Math.max(base.bitmap.width, base.bitmap.height) < UPSCALE_BELOW
  const wantText = settings.recogniseText && canSetText(settings.preset) && !!base && !base.svg
  const prepKey = base && (settings.removeBackground || wantUpscale || wantText) ? `${base.url}|${settings.removeBackground}|${wantUpscale}|${wantText}` : null
  useEffect(() => {
    const source = base
    if (!source || !prepKey) {
      prepClient.stop()
      setPrepStatus(null)
      setPrepError(null)
      return
    }
    if (prepRawRef.current?.key === prepKey) {
      // Back to a copy already made: stop anything still running for another one.
      prepClient.stop()
      setPrepStatus(null)
      setPrepError(null)
      return
    }
    let live = true
    setPrepError(null)
    setPrepStatus({ stage: settings.removeBackground ? 'background' : wantUpscale ? 'upscale' : 'textData', done: 0, total: 0 })
    const native = pixelsOf(source, Infinity, false)
    void prepClient
      .prepare(native.rgba, native.width, native.height, { background: settings.removeBackground, upscale: wantUpscale, text: wantText }, (stage, done, total) => live && setPrepStatus({ stage, done, total }))
      .then(async (r) => {
        if (!live || !r) return
        if (r instanceof Error) {
          setPrepStatus(null)
          setPrepError(r.message)
          return
        }
        prepRawRef.current = { key: prepKey, source, rgba: r.rgba, width: r.width, height: r.height, text: r.text }
        setPrepRaw(prepRawRef.current)
        setPrepStatus(null)
      })
    return () => {
      live = false
    }
    // Settings other than the steps don't change what's prepared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, prepKey, prepClient])
  // The Keep and Remove strokes over the mask (#204): the traced list's, so they apply on leaving Clean up, like its other changes.
  const maskKey = settings.removeBackground && tracedCleanup.some((o) => o.kind === 'mask') ? tracedJson : ''
  useEffect(() => {
    const raw = prepRaw
    if (!raw || !source) return
    let live = true
    void (async () => {
      const rgba = maskKey ? (await import('./lib/cleanupRun')).withMaskStrokes(raw.rgba, raw.width, raw.height, source, tracedCleanup) : raw.rgba
      const img = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, raw.width, raw.height)
      const canvas = new OffscreenCanvas(raw.width, raw.height)
      canvas.getContext('2d')!.putImageData(img, 0, 0)
      const [bitmap, blob] = await Promise.all([createImageBitmap(img), canvas.convertToBlob({ type: 'image/png' })])
      if (!live) return void bitmap.close()
      setPrepared((prev) => {
        if (prev) URL.revokeObjectURL(prev.source.url)
        return { key: raw.key, mask: maskKey, source: { ...raw.source, url: URL.createObjectURL(blob), bitmap }, text: raw.text }
      })
    })()
    return () => {
      live = false
    }
    // maskKey names the strokes (and the list they're carried through).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepRaw, maskKey])
  const preparedNow = prepared?.key === prepKey && prepared.mask === maskKey ? prepared : null
  /** What gets traced: the prepared image when a step is on (none until it's ready), else the (cleaned) original. */
  const traceSource = prepKey ? (preparedNow?.source ?? null) : base
  const foundText = wantText && preparedNow ? preparedNow.text : NO_TEXT
  /** Background removal's mask for Clean up to show and paint over, while the image it was made from is the one on screen. */
  const cleanMask = settings.removeBackground && prepRaw?.key === prepKey && cleanupPixelJson === tracedPixelJson ? prepRaw : null
  // Tracing to your own colours: text set as type takes the nearest of them too.
  const ownKey = ownPaletteOf(settings)?.join() ?? ''
  const traceText = useMemo(() => {
    const own = ownKey ? ownKey.split(',') : null
    return own && foundText.length ? foundText.map((r) => ({ ...r, fill: nearestColor(r.fill, own) })) : foundText
  }, [foundText, ownKey])

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
      const fine = settings.fineDetail
      if (!cached || cached.source !== source || cached.maxEdge !== maxEdge || cached.upscale !== upscale || cached.fine !== fine) {
        cached = { source, maxEdge, upscale, fine, pixels: pixelsOf(source, maxEdge, upscale, fine) }
        pixelCache.current = cached
      }
      const { rgba, width, height } = cached.pixels
      setStatus({ kind: 'tracing' })
      // Text drawn as type is painted out of what's traced, so it isn't drawn twice.
      let traced = rgba
      if (traceText.length) paintOut((traced = rgba.slice()), width, height, traceText, width / source.bitmap.width)
      const res = await client.trace(traced, width, height, toTraceOptions(settings, cached.pixels.upscale))
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
          setTrace(withText(parseTrace(res.svg), traceText, source.bitmap.width))
          setTraceCount((n) => n + 1)
          setStatus({ kind: 'done', ms: res.ms })
          // Once per image, not per retrace as the settings change.
          track('traced', source.name)
        } catch (error) {
          setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        }
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [client, traceSource, traceText, settings])

  // The trace as a document. New ids per trace, so a selection never points
  // into a stale trace.
  const traced = useMemo(() => (trace ? docFromTrace(trace) : null), [trace])
  const doc = traced ? docOf(edits, traced) : null
  const svg = useMemo(() => (doc ? buildSvg(doc, edits.inks, undefined, edits.background) : ''), [doc, edits.inks, edits.background])
  const shown = useMemo(() => (doc ? visiblePaths(doc, edits.inks) : []), [doc, edits.inks])
  // Hidden shapes aren't drawn and locked ones can't be picked (#209); both still export.
  const hiddenSet = useMemo(() => new Set(edits.hidden ?? []), [edits.hidden])
  const lockedSet = useMemo(() => new Set(edits.locked ?? []), [edits.locked])
  const drawn = useMemo(() => (hiddenSet.size ? shown.filter((p) => !hiddenSet.has(p.id)) : shown), [shown, hiddenSet])
  const selectable = useMemo(() => (lockedSet.size ? drawn.filter((p) => !lockedSet.has(p.id)) : drawn), [drawn, lockedSet])
  const selectableIds = useMemo(() => new Set(selectable.map((p) => p.id)), [selectable])
  const selectableRef = useRef(selectableIds)
  selectableRef.current = selectableIds
  const inks = useMemo(() => (doc ? inksOf(doc) : []), [doc])
  const strokes = useMemo(() => !!doc && hasStrokes(doc), [doc])
  // Fill needs the trace's lines filled (not Centerline). A shape given a stroke later just doesn't bound a fill.
  const lineTrace = useMemo(() => !!traced && hasStrokes(traced), [traced])
  // Strokes can't be mirrored or bound a fill: leave those tools if a trace turns into them.
  useEffect(() => {
    if ((strokes && tool === 'mirror') || (lineTrace && (tool === 'fill' || tool === 'erase' || tool === 'knife'))) setTool('select')
  }, [strokes, lineTrace, tool])

  // Shapes that no longer exist (re-trace, undo past their creation), or are
  // hidden or locked now, drop out of the selection, and so do nodes that no
  // longer exist in the edited shape.
  useEffect(() => {
    if (selectedIds.some((id) => !selectableIds.has(id))) {
      const kept = selectedIds.filter((id) => selectableIds.has(id))
      setSelectedIds(kept)
      if (kept[0] !== selectedIds[0]) setSelectedNodes([])
    }
  }, [selectableIds, selectedIds])
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
        // A shape in a group stands for its whole group (but for any of it hidden or locked).
        const ids = (docRef.current ? withGroups(docRef.current, [id]) : [id]).filter((x) => selectableRef.current.has(x))
        if (!ids.length) return cur
        if (how === 'set') return ids
        if (how === 'subtract') return cur.filter((x) => !ids.includes(x))
        if (how === 'add') return [...cur, ...ids.filter((x) => !cur.includes(x))]
        return cur.includes(id) ? cur.filter((x) => !ids.includes(x)) : [...cur, ...ids.filter((x) => !cur.includes(x))]
      })
      setSelectedNodes([])
      // The selection’s tools live in Edit mode.
      if (id) {
        setWorkMode('edit')
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
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  /** The selection as drawn (colours resolved), for Fill and stroke. */
  const selectedShown = useMemo(() => shown.filter((p) => selectedSet.has(p.id)), [shown, selectedSet])
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
  /** Shared edges (#212): a node or handle moved on an edge two shapes share moves in both, unless this is off. */
  const [shareEdges, setShareEdges] = useState(true)
  /**
   * Change one path's nodes, reading its current data at commit time. Where it
   * shares an edge with a neighbour, the neighbour's copy follows (#212).
   */
  const editPath = (id: string, f: (subs: ReturnType<typeof parsePath>) => ReturnType<typeof parsePath>, key: string | null = null) =>
    editDoc((d) => {
      const p = d.paths.find((x) => x.id === id)
      if (!p) return d
      const before = parsePath(p.d)
      const subs = f(before)
      if (!subs.length) return deletePath(d, id)
      const next = replacePath(d, id, serializePath(subs))
      return shareEdges ? followShared(next, id, before, subs, lockedSet) : next
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
    transformBase.current ??= new Map(doc.paths.filter((p) => ids.has(p.id)).map((p) => [p.id, { d: p.d, stroke: p.stroke, gradient: p.gradient }]))
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
    boxBase.current ??= { box: selectionBox, paths: new Map(doc.paths.filter((p) => ids.has(p.id)).map((p) => [p.id, { d: p.d, stroke: p.stroke, gradient: p.gradient }])) }
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
    const hits = (doc ? withGroups(doc, pathsInRect(selectable, rect)) : pathsInRect(selectable, rect)).filter((id) => selectableIds.has(id))
    setSelectedIds((cur) => {
      if (how === 'set') return hits
      if (how === 'subtract') return cur.filter((id) => !hits.includes(id))
      return [...cur, ...hits.filter((id) => !cur.includes(id))]
    })
    setSelectedNodes([])
    if (hits.length) {
      setWorkMode('edit')
      startEditing()
    }
  }

  const enterNodes = useCallback(
    (id: string) => {
      setSelectedIds([id])
      setSelectedNodes([])
      setTool('nodes')
      setWorkMode('edit')
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
    // Edge by edge (#212), so a neighbour's side of a re-fitted edge changes with it and no gap opens.
    if (shareEdges) editDoc((d) => simplifyShared(d, [...ids], tolerance, lockedSet))
    else editDoc((d) => ({ ...d, paths: d.paths.map((p) => (ids.has(p.id) ? { ...p, d: serializePath(simplifySubpaths(parsePath(p.d), tolerance)) } : p)) }))
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
    (tolerance: number) => {
      if (nodesOfSelection === null || !doc) return null
      if (!shareEdges) return selectedPaths.reduce((n, p) => n + nodeCount(simplifySubpaths(parsePath(p.d), tolerance)), 0)
      const out = simplifyShared(doc, selectedIds, tolerance, lockedSet)
      const ids = new Set(selectedIds)
      return out.paths.reduce((n, p) => n + (ids.has(p.id) ? nodeCount(parsePath(p.d)) : 0), 0)
    },
    [selectedPaths, nodesOfSelection, shareEdges, doc, selectedIds, lockedSet],
  )

  /**
   * Hide or show, lock or unlock shapes (#209): an edit, so it undoes. A group
   * goes all together, so it never splits. They're kept by shape id, and a
   * trace's ids are new each time it's traced, so the first one detaches the
   * drawing from the trace, like a shape edit.
   */
  const flagShapes = useCallback(
    (flag: ShapeFlag, ids: string[], on: boolean) => {
      if (!traced) return
      commit((e) => {
        const d = docOf(e, traced)
        const next = flagIds(d, e[flag] ?? [], ids, on)
        const { [flag]: _, ...rest } = e
        return { ...rest, doc: d, ...(next.length ? { [flag]: next } : {}) }
      })
    },
    [commit, traced],
  )
  /** The selection's own fill, outline or opacity (#209). A slider's drag shares a key, so it undoes as one step. */
  const styleSelection = (patch: StylePatch, key: string) => {
    const ids = new Set(selectedIds)
    editDoc((d) => ({ ...d, paths: d.paths.map((p) => (ids.has(p.id) ? stylePath(p, patch, edits.inks) : p)) }), key)
  }
  /** Group, ungroup and paint order: shape edits on the selection, each one undo step. */
  const groupSelection = () => selectedIds.length > 1 && editDoc((d) => groupPaths(d, selectedIds))
  const ungroupSelection = () => selectedIds.length && editDoc((d) => ungroupPaths(d, selectedIds))
  const arrangeSelection = (how: Arrange) => selectedIds.length && editDoc((d) => arrange(d, selectedIds, how))
  /** Align and distribute (#213): each shape or whole group is one item, moved as one undo step. */
  const moveItems = (moves: (boxes: Box[]) => { dx: number; dy: number }[]) => {
    if (!doc || !selectedIds.length) return
    const sel = new Set(selectedIds)
    const items = new Map<string, string[]>()
    for (const p of doc.paths) if (sel.has(p.id)) items.set(p.group ?? p.id, [...(items.get(p.group ?? p.id) ?? []), p.id])
    const ids = [...items.values()]
    const byId = new Map(doc.paths.map((p) => [p.id, p]))
    const boxes = ids.map((m) => union(m.map((id) => pathBounds(byId.get(id)!.d))))
    if (boxes.some((b) => !b)) return
    const by = new Map<string, { dx: number; dy: number }>()
    moves(boxes as Box[]).forEach((m, i) => ids[i].forEach((id) => by.set(id, m)))
    if ([...by.values()].every((m) => Math.abs(m.dx) < 1e-9 && Math.abs(m.dy) < 1e-9)) return
    editDoc((d) => ({ ...d, paths: d.paths.map((p) => (by.has(p.id) ? { ...p, ...transformShape(p, translate(by.get(p.id)!.dx, by.get(p.id)!.dy)) } : p)) }))
  }
  const alignSelection = (how: AlignHow) => doc && moveItems((boxes) => alignMoves(boxes, how, { x: 0, y: 0, w: doc.width, h: doc.height }))
  const distributeSelection = (how: DistributeHow) => moveItems((boxes) => distributeMoves(boxes, how))
  /** Snapping (#213), remembered on this device. */
  const [snapping, setSnapping] = usePersisted<SnapSettings>('inlay:snap', SNAP_DEFAULT)
  /** Group by object (#195): each set of touching shapes in one group, one undo step; says how many it found. */
  const [objectsNote, setObjectsNote] = useState<string | null>(null)
  const groupObjects = () => {
    if (!doc) return
    const { doc: next, objects } = groupByObject(doc, edits.inks)
    if (next !== doc) editDoc((d) => (d === doc ? next : groupByObject(d, edits.inks).doc))
    setObjectsNote(!objects ? 'No separate objects found.' : `${objects === 1 ? '1 object' : `${objects} objects`}${next === doc ? ', already grouped.' : ', each now a group.'}`)
    setTimeout(() => setObjectsNote(null), 6000)
  }
  /** Unite, Subtract, Intersect or Divide the selection (#207); resolves to why it couldn't, or null. */
  const combining = useRef(false)
  const combineSelection = async (op: BooleanOp): Promise<string | null> => {
    const ids = selectedIds
    if (combining.current || ids.length < 2) return null
    combining.current = true
    try {
      const paper = await loadPaper()
      // The drawing as it is now, after the wait for paper.js: edits made meanwhile are kept.
      const current = docRef.current
      if (!current) return null
      const r = booleanOp(paper, current, ids, op)
      if ('error' in r) return r.error
      editDoc(() => r.doc)
      setSelectedIds(r.selected)
      setSelectedNodes([])
      return null
    } catch (error) {
      return `That didn’t work: ${error instanceof Error ? error.message : String(error)}. Your drawing is unchanged.`
    } finally {
      combining.current = false
    }
  }

  // ---- Fill tool (#193) -----------------------------------------------------------
  const [fillColour, setFillColour] = useState('#f2c14e')
  // ---- Pen and Shape tools (#210): they draw in the Fill tool's colour --------------
  const [shape, setShape] = useState<ShapeSettings>(SHAPE_DEFAULT)
  const [drawStroke, setDrawStroke] = useState(4)
  /** A finished Pen or Shape path joins the drawing just above the selection, and becomes the selection. */
  const onDrawn = (d: string, open: boolean) => {
    const id = newId()
    const above = selectedIds
    editDoc((doc) => addShape(doc, d, fillColour, open ? drawStroke : null, above, id).doc)
    setSelectedIds([id])
    setSelectedNodes([])
    startEditing()
  }
  const [penCommand, setPenCommand] = useState<PenCommand | null>(null)
  const [penNodes, setPenNodes] = useState(0)

  // ---- Eraser and Knife (#211): on the selection, or every visible unlocked shape ----------
  const [eraserWidth, setEraserWidth] = useState(12)
  const [cutError, setCutError] = useState<string | null>(null)
  const [cutting, setCutting] = useState(false)
  const cuttingRef = useRef(false)
  const cutInputs = useRef({ selectedIds, selectableIds })
  cutInputs.current = { selectedIds, selectableIds }
  const cutWith = async (run: (paper: Awaited<ReturnType<typeof loadPaper>>, doc: DocT, targets: string[]) => ReturnType<typeof eraseDoc>, keep: 'add' | 'trim') => {
    // One cut at a time; the panel says "Working…" meanwhile, so a drag made then isn't silently lost.
    if (cuttingRef.current) return setCutError('Still working on the last one: try again in a moment.')
    cuttingRef.current = true
    setCutting(true)
    setCutError(null)
    try {
      const paper = await loadPaper()
      const current = docRef.current
      if (!current) return
      const { selectedIds, selectableIds } = cutInputs.current
      const sel = selectedIds.filter((id) => selectableIds.has(id))
      const r = run(paper, current, sel.length ? sel : [...selectableIds])
      if ('error' in r) return setCutError(r.error)
      editDoc(() => r.doc)
      // A selection follows its shapes: the Knife's new pieces join it, what the Eraser took leaves it.
      if (sel.length) setSelectedIds(keep === 'add' ? [...new Set([...sel, ...r.selected])] : sel.filter((id) => r.doc.paths.some((p) => p.id === id)))
    } catch (error) {
      setCutError(`That didn’t work: ${error instanceof Error ? error.message : String(error)}. Your drawing is unchanged.`)
    } finally {
      cuttingRef.current = false
      setCutting(false)
    }
  }
  const onErase = (points: Pt[]) => void cutWith((paper, doc, targets) => eraseDoc(paper, doc, targets, points, eraserWidth), 'trim')
  const onKnife = (a: Pt, b: Pt) => void cutWith((paper, doc, targets) => knifeDoc(paper, doc, targets, a, b), 'add')

  const [fillError, setFillError] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const fillingRef = useRef(false)
  const drawnIds = useMemo(() => new Set(drawn.map((p) => p.id)), [drawn])
  // Read after the wait for paper.js, so the doc and these are from the same moment.
  const fillInputs = useRef({ inks: edits.inks, drawnIds, lockedSet, fillColour })
  fillInputs.current = { inks: edits.inks, drawnIds, lockedSet, fillColour }
  /** The colours on screen, for the Fill tool's swatches: recolours applied, removed inks dropped. */
  const shownInks = useMemo(() => [...new Set(inks.map((i) => shownFill(edits.inks, i.hex)).filter((h): h is string => !!h))], [inks, edits.inks])
  /** A click with the Fill tool: the shape there takes the colour, or the area the shapes enclose there becomes a shape. */
  const fillAt = async (at: Pt) => {
    if (fillingRef.current) return
    fillingRef.current = true
    setFilling(true)
    setFillError(null)
    try {
      const paper = await loadPaper()
      // Let "Filling…" paint before a big drawing's booleans hold the thread.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
      // The drawing as it is now, after the wait for paper.js.
      const current = docRef.current
      if (!current) return
      const { inks, drawnIds, lockedSet, fillColour } = fillInputs.current
      const r = bucketFill(paper, current, inks, drawnIds, lockedSet, at, fillColour)
      if ('error' in r) return setFillError(r.error)
      editDoc(() => r.doc)
    } catch (error) {
      setFillError(`That didn’t work: ${error instanceof Error ? error.message : String(error)}. Your drawing is unchanged.`)
    } finally {
      fillingRef.current = false
      setFilling(false)
    }
  }

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
  /** Fix in image (#208): Clean up, zoomed on the selected shapes with their outline picked out; leaving re-traces as usual. */
  const fixInImage = () => {
    if (!doc || !selectionBox || !cleanable) return
    const pad = 0.02
    const x = Math.max(0, selectionBox.x / doc.width - pad)
    const y = Math.max(0, selectionBox.y / doc.height - pad)
    const ids = selectedIds.slice()
    chooseMode('clean')
    setCleanFocus({ x, y, width: Math.min(1, (selectionBox.x + selectionBox.w) / doc.width + pad) - x, height: Math.min(1, (selectionBox.y + selectionBox.h) / doc.height + pad) - y, ids })
  }
  const chooseMode = (m: WorkMode) => {
    if (m === workMode) return
    setWorkMode(m)
    setCleanFocus(null)
    // Clean up holds the trace's list while you work; leaving lets it follow the edited one, which re-traces.
    setHeldCleanup(m === 'clean' ? cleanup : null)
    setCropDraft(null)
    setShowOriginal(false)
    if (m === 'edit') return startEditing()
    // Leaving Edit puts its tools away: no hidden selection for Delete or the
    // arrows to act on, and no Nodes or Mirror on a canvas without a rail.
    setTool('select')
    setSelectedIds([])
    setSelectedNodes([])
    setPicking(null)
  }
  const chooseTool = useCallback((t: Tool) => {
    setTool(t)
    setPicking(null)
    setSelectedNodes([])
    // Nodes edits one shape and Mirror shows none, so neither keeps a
    // multi-selection that Delete could act on unseen.
    if (t === 'nodes') setSelectedIds((ids) => ids.slice(0, 1))
    else if (t === 'mirror' || t === 'fill') setSelectedIds([])
    if (t === 'mirror' || t === 'fill' || t === 'erase' || t === 'knife') void loadPaper().catch(() => {}) // warm it up while the user picks a side, a colour or a place
    setFillError(null)
    setCutError(null)
  }, [])

  /** Edit mode's tool rail: beside the canvas on a wide screen, in the mode bar on a phone (one or the other, never both). */
  const wide = useWide()
  const rail = (
    <ToolRail
      tools={EDIT_TOOLS(strokes, lineTrace)}
      tool={tool}
      onTool={chooseTool}
      canUndo={history.past.length > 0}
      canRedo={history.future.length > 0}
      onUndo={() => historyStep('undo')}
      onRedo={() => historyStep('redo')}
    />
  )
  const cleanRail = (
    <ToolRail
      tools={CLEAN_TOOLS(settings.removeBackground)}
      tool={cleanTool}
      onTool={chooseCleanTool}
      canUndo={history.past.length > 0}
      canRedo={history.future.length > 0}
      onUndo={() => historyStep('undo')}
      onRedo={() => historyStep('redo')}
    />
  )
  const modeRail = workMode === 'edit' ? rail : workMode === 'clean' ? cleanRail : null

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
      } else if (mod && key === 'a' && hasDoc && workMode !== 'clean') {
        e.preventDefault()
        if (tool === 'nodes' && editingSubs) setSelectedNodes(allRefs(editingSubs))
        else {
          if (tool !== 'select') setTool('select')
          setSelectedIds(selectable.map((p) => p.id))
          setSelectedNodes([])
          setWorkMode('edit')
          startEditing()
        }
      } else if (mod || e.altKey) {
        return
      } else if (workMode === 'clean') {
        // Clean up's own keys; Edit's tool keys don't reach past it, so leaving always goes through the mode switch.
        if (e.key === '?' || (e.key === '/' && e.shiftKey)) setShortcutsOpen(true)
        else if (Object.hasOwn(CLEAN_KEYS, key) && (settings.removeBackground || (key !== 'k' && key !== 'r'))) chooseCleanTool(CLEAN_KEYS[key as keyof typeof CLEAN_KEYS])
        else if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && ['brush', 'eraser', 'despeckle', 'heal', 'keep', 'remove'].includes(cleanTool)) {
          // [ ] size, Shift + [ ] hardness, as in most paint programs.
          e.preventDefault()
          const up = e.code === 'BracketRight'
          setBrush((b) =>
            e.shiftKey
              ? { ...b, hardness: Math.round(Math.min(1, Math.max(0, b.hardness + (up ? 0.1 : -0.1))) * 10) / 10 }
              : { ...b, size: Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, up ? Math.max(b.size + 1, Math.round(b.size * 1.25)) : Math.min(b.size - 1, Math.round(b.size / 1.25)))) },
          )
        } else if (e.key === 'Enter' && cropDraft && el?.tagName !== 'BUTTON' && el?.tagName !== 'A') {
          e.preventDefault()
          applyCrop()
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && wand && cleanTool === 'wand') {
          // Delete clears the selection to the background, as in most paint programs.
          e.preventDefault()
          editCleanup(addOp(cleanup, { kind: 'fill', seeds: wand, tolerance: fillSettings.tolerance, contiguous: fillSettings.contiguous }))
        } else if (e.key === 'Escape') {
          setCropDraft(null)
          setCleanPick(false)
          setWand(null)
        }
      } else if (key === 'f' && workMode === 'edit' && selectedIds.length && cleanable && !e.shiftKey) {
        e.preventDefault()
        fixInImage()
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
      } else if (hasDoc && !e.shiftKey && (key === 'v' || key === 'a' || key === 'm' || key === 'k' || key === 'p' || key === 'u' || key === 'e' || key === 'c')) {
        if (!(key === 'm' && strokes) && !(lineTrace && (key === 'k' || key === 'e' || key === 'c')))
          chooseTool(({ v: 'select', a: 'nodes', m: 'mirror', k: 'fill', p: 'pen', u: 'shape', e: 'erase', c: 'knife' } as const)[key])
        setWorkMode('edit')
        startEditing()
      }
    }
  }

  // Optimise in the background so the numbers shown are the numbers exported.
  useEffect(() => {
    if (!svg || !trace) return
    const timer = setTimeout(async () => {
      const res = await client.optimize(svg)
      if (res?.type === 'optimized') setOptimized({ from: svg, svg: res.svg, trace })
    }, 300)
    return () => clearTimeout(timer)
  }, [client, svg, trace])

  const fresh = optimized?.from === svg ? optimized.svg : null
  /** What the canvas is waiting on, if anything. Optimising counts once per trace, not after every edit. */
  const busy = prepStatus
    ? STAGE[prepStatus.stage]
    : status.kind === 'tracing'
      ? 'Tracing'
      : (status.kind === 'done' || status.kind === 'opened') && !fresh && optimized?.trace !== trace
        ? 'Optimising'
        : null
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
  /** The colours as drawn (#192), so a designer can take the palette into other tools. */
  const downloadSwatches = (format: SwatchFormat) => {
    const f = swatchFile(format, swatchColors(shown, edits.background), source!.name)
    save(new Blob([f.data as BlobPart], { type: f.type }), `${source!.name}-swatches.${f.ext}`)
  }
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

  const [objectsError, setObjectsError] = useState<string | null>(null)
  /** One SVG per object (#195), each cropped to it and sized at the export's scale. */
  const downloadObjects = async () => {
    const files: Record<string, Uint8Array> = {}
    const sx = size.width / doc!.width
    const sy = size.height / doc!.height
    const objects = objectFiles(doc!, edits.inks, source!.name)
    if (!objects.length) {
      setObjectsError('Nothing to export: every shape is the background or a hidden colour.')
      return
    }
    setObjectsError(null)
    for (const f of objects) files[f.name] = strToU8(withSize(await optimizeHere(f.svg), { width: f.box.w * sx, height: f.box.h * sy, unit: size.unit }))
    const zip = zipSync(files, { level: 6 })
    save(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), `${source!.name}-objects.zip`)
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
    const { rgba, width, height, upscale: scale } = pixelsOf(traceSource, maxEdge, upscale, settings.fineDetail)
    // Recognised text is the same whatever the settings: it's painted out of what
    // the search traces, and its markup counts against the target.
    if (traceText.length) paintOut(rgba, width, height, traceText, width / traceSource.bitmap.width)
    const textBytes = traceText.length ? withText({ width: width / scale, height: height / scale, paths: [] }, traceText, traceSource.bitmap.width).paths.reduce((n, p) => n + p.d.length + 30, 0) : 0
    const withTextBytes = (c: Candidate): Candidate => ({ ...c, bytes: c.bytes + textBytes })
    const target = Math.round(kb * 1024)
    const from = settings
    setSizeRun({ target, from, tried: 0, best: null, result: null })
    const res = await sizeClient.fitSize(rgba, width, height, from, Math.max(1, target - textBytes), (tried, best) => setSizeRun((r) => (r && r.from === from ? { ...r, tried, best: withTextBytes(best) } : r)), scale)
    setSizeRun((r) => {
      if (!r || r.from !== from) return r // cancelled, or another search started
      if (res?.type === 'sized') {
        const result = { ...res.result, start: withTextBytes(res.result.start), best: withTextBytes(res.result.best) }
        return { ...r, tried: result.tried, best: result.best, result }
      }
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
      setWorkMode('trace')
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
    else if (target === DRAW_COLOUR) setFillColour(v)
    else if (target === OWN_COLORS) {
      // The screen picker resolves later: build on the settings as they are then.
      const now = settingsRef.current
      const ownColors = addColors(now.ownColors, [v])
      if (ownColors.length !== now.ownColors.length) changeSettings({ ...now, ownColors })
    }
    else editInks((i) => recolorInk(i, target, v))
  }
  const onPick = (at: Pt) => {
    if (!picking || !source || !doc) return
    // An ink that a re-trace took away has nothing to recolour.
    if (picking.target !== 'background' && picking.target !== OWN_COLORS && picking.target !== DRAW_COLOUR && !inks.some((i) => i.hex === picking.target)) return setPicking(null)
    const hex = colourAt(traceSource ?? base ?? source, at.x / doc.width, at.y / doc.height)
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

  const photo = useMemo(() => !!source && looksLikePhoto(source), [source])
  // Measured on the image as given (or as cleaned up), never enlarged: enlarging alone softens edges.
  const smoothable = canSmooth(settings.preset)
  const blurry = useMemo(() => smoothable && !!base && looksBlurry(base), [smoothable, base])
  const suggestPoster = photo && !presetPicked && settings.preset !== 'photo'

  const choosePreset = (id: PresetId) => {
    setPresetPicked(true)
    const next = settingsFor(id)
    // Reset (the same preset again) puts the sliders back but keeps merges:
    // they're decisions about this image's colours, not settings to tune.
    if (id === settings.preset) next.merge = settings.merge
    next.removeBackground = settings.removeBackground
    next.aiUpscale = settings.aiUpscale
    next.fineDetail = settings.fineDetail
    next.sharpen = settings.sharpen
    next.smoothShading = settings.smoothShading
    next.keepOutlines = settings.keepOutlines
    next.grayscale = settings.grayscale
    next.recogniseText = settings.recogniseText
    // Your own colours are about what you can print, not this preset.
    next.ownColors = settings.ownColors
    next.useOwnColors = settings.useOwnColors
    if (isInk(id) && source && hasDarkBackground(source)) next.lightInk = true
    changeSettings(next)
  }

  const { theme, toggle } = useTheme()

  /** A phone with a trace open: the layout fits the screen, with the canvas above, the panel scrolling below it and the dock at the foot. */
  const docked = !!(source && trace)
  const showPhone = (v: PhoneView) => {
    setPhoneView(v)
    aside.current?.scrollTo({ top: 0 })
  }
  /** Scroll the panel on a phone to a part of it, for the dock's Combine and Levels. */
  const reveal = (selector: string) => requestAnimationFrame(() => aside.current?.querySelector(selector)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  const editTools = EDIT_TOOLS(strokes, lineTrace)
  const cleanTools = CLEAN_TOOLS(settings.removeBackground)
  /** A slot that holds a few of the rail's tools. */
  const toolSlot = <T extends string>(id: string, label: string, icon: ReactNode, rail: { id: T; label: string; icon: ReactNode; disabled?: string }[], ids: T[], current: T, pick: (t: T) => void): DockSlot => {
    const items = ids.map((i) => rail.find((t) => t.id === i)!).filter(Boolean)
    const mine = (ids as string[]).includes(current)
    return {
      id,
      label: mine && ids.length > 1 ? (items.find((t) => t.id === current)?.label ?? label) : label,
      icon,
      active: mine,
      onSelect: () => pick(items.find((t) => !t.disabled)?.id ?? ids[0]),
      items: ids.length > 1 ? items.map((t) => ({ id: t.id, label: t.label, icon: t.icon, disabled: t.disabled })) : undefined,
      current,
      onItem: (t) => pick(t as T),
    }
  }
  const view = (v: PhoneView, label: string): DockSlot => ({ id: v, label, icon: DOCK_ICON[v], active: phoneView === v, onSelect: () => showPhone(v) })
  const dockSlots: [DockSlot, DockSlot, DockSlot, DockSlot] =
    workMode === 'edit'
      ? [
          toolSlot('select', 'Select', DOCK_ICON.select, editTools, ['select', 'mirror'], tool, chooseTool),
          toolSlot('nodes', 'Nodes', DOCK_ICON.nodes, editTools, ['nodes'], tool, chooseTool),
          {
            id: 'combine',
            label: 'Combine',
            icon: DOCK_ICON.combine,
            active: false,
            onSelect: () => {
              if (tool !== 'select') chooseTool('select')
              setDockNote(selectedIds.length ? null : 'Tap a shape to select it, then combine it with others below.')
              reveal('[data-combine]')
            },
          },
          toolSlot('draw', 'Draw', DOCK_ICON.draw, editTools, ['pen', 'shape', 'fill', 'erase', 'knife'], tool, chooseTool),
        ]
      : workMode === 'clean'
        ? [
            toolSlot('crop', 'Crop', DOCK_ICON.crop, cleanTools, ['crop', 'straighten'], cleanTool, chooseCleanTool),
            toolSlot('brush', 'Brush', DOCK_ICON.brush, cleanTools, ['brush', 'fill', 'heal', 'despeckle'], cleanTool, chooseCleanTool),
            toolSlot('erase', 'Erase', DOCK_ICON.erase, cleanTools, ['eraser', 'wand', 'keep', 'remove'], cleanTool, chooseCleanTool),
            { id: 'levels', label: 'Levels', icon: DOCK_ICON.levels, active: false, onSelect: () => reveal('[data-section="levels"]') },
          ]
        : [view('image', 'Image'), view('type', 'Type'), view('tune', 'Tune'), view('export', 'Export')]

  return (
    <div
      className={`flex flex-col ${docked ? 'h-full' : 'min-h-full lg:h-full'}`}
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
      {/* On a phone the page scrolls under it until a trace opens; then the layout fits the screen. */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-rule bg-paper px-4 lg:static lg:px-5">
        <div className="flex items-baseline gap-3">
          <h1 className="leading-none">
            {/* The landing page and docs live beside the app, at the site root. */}
            <a href="/" className="wordmark rounded-sm hover:text-ink-muted" title="Inlay home">
              {/* The mark from brand/mark-dark.svg; its square turns green in the light theme (brand/mark.svg). */}
              <svg className="logo-mark" viewBox="0 0 128 128" aria-hidden="true">
                <path className="logo-mark-square" d="M0 0H128V56A72 72 0 0 0 56 128H0Z" />
                <path d="M128 56V128H56A72 72 0 0 1 128 56Z" fill="#f2c230" />
              </svg>
              Inlay
            </a>
          </h1>
          <p className="hidden text-[13px] text-ink-muted sm:block">Image to SVG, in your browser.</p>
        </div>
        <div className="flex items-center gap-1 text-[13px]">
          {/* A phone's undo and redo: on a wide screen they are at the foot of the tool rail. */}
          {docked && workMode !== 'trace' && (
            <div role="group" aria-label="History" className="flex gap-0.5 lg:hidden">
              <IconButton label="Undo" disabled={history.past.length === 0} onClick={() => historyStep('undo')}>
                <UndoIcon />
              </IconButton>
              <IconButton label="Redo" disabled={history.future.length === 0} onClick={() => historyStep('redo')}>
                <RedoIcon />
              </IconButton>
            </div>
          )}
          <span className="hidden lg:contents">
            <IconButton label="Keyboard shortcuts" hint="Keyboard shortcuts (?)" aria-keyshortcuts="?" onClick={() => setShortcutsOpen(true)}>
              <KeyboardIcon />
            </IconButton>
            <IconButton label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} onClick={toggle}>
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </IconButton>
          </span>
          <Support />
          <MoreMenu theme={theme} onTheme={toggle} supportUrl={SUPPORT_URL} />
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
        {/* On a phone with a trace, a fixed share of the screen, the panel scrolling under it; before one, the drop zone. */}
        <div className={`relative flex min-w-0 flex-col lg:min-h-0 lg:flex-1 ${docked ? 'h-[46svh] shrink-0 lg:h-auto' : 'min-h-[52vh] flex-1'}`}>
          {source && trace ? (
            <>
              {/* The mode switcher, above the canvas; a phone switches modes and tools in the dock instead. */}
              <div className="hidden flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule px-4 py-2 lg:flex" data-workspace={workMode}>
                <ModeSwitch modes={cleanable ? ['clean', 'trace', 'edit'] : ['trace', 'edit']} mode={workMode} onMode={chooseMode} edited={detached} />
              </div>
              <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                {modeRail && wide && modeRail}
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
                  {workMode === 'clean' && cleanable && (
                    <Suspense fallback={null}>
                      <CleanCanvas
                        source={source}
                        ops={cleanup}
                        traced={tracedCleanup}
                        outline={doc ? { paths: shown, width: doc.width, height: doc.height } : null}
                        showOriginal={showOriginal}
                        tool={cleanTool}
                        draft={cropDraft}
                        onDraft={setCropDraft}
                        onStraighten={(degrees) => editCleanup(addOp(cleanup, { kind: 'rotate', degrees }))}
                        brush={brush}
                        onBrush={setBrush}
                        onStroke={(op) => editCleanup(addOp(cleanup, op))}
                        picking={cleanPick}
                        onPick={(hex) => {
                          setBrush((b) => ({ ...b, color: hex }))
                          setCleanPick(false)
                        }}
                        fill={fillSettings}
                        onFill={(op) => editCleanup(addOp(cleanup, op))}
                        wand={wand}
                        onWand={setWand}
                        mask={cleanMask}
                        focus={cleanFocus}
                      />
                    </Suspense>
                  )}
                  <Canvas
                    imageUrl={(traceSource ?? source).url}
                    paths={drawn}
                    locked={lockedSet}
                    width={doc!.width}
                    height={doc!.height}
                    mode={mode}
                    zoom={zoom}
                    naturalWidth={(base ?? source).originalWidth}
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
                    snapping={snapping}
                    onTransform={onTransform}
                    onAddNode={onAddNode}
                    picking={!!picking}
                    onPick={onPick}
                    onFill={(at) => void fillAt(at)}
                    onAxis={moveAxis}
                    draw={{ shape, colour: fillColour, strokeWidth: drawStroke, onDrawn, eraserWidth, onErase, onKnife, penCommand, onPenNodes: setPenNodes }}
                  />
                  {busy && (
                    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                      <div key={busy} role="status" className="busy flex items-center gap-2.5 rounded-full border border-rule bg-paper px-4 py-2 text-[13.5px] font-medium shadow-md" data-busy={busy}>
                        <span className="spinner" aria-hidden="true" />
                        {busy}…
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* One row, the same height as the sidebar's footer beside it (lg). The hint shows where there's room for it
                  (each view's button carries it as a tooltip too) and shortens rather than wrapping. */}
              <div className={`${workMode === 'clean' ? 'hidden' : 'flex'} flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-rule px-4 py-2 lg:h-13 lg:flex-nowrap lg:py-0`}>
                <div role="radiogroup" aria-label="Compare" className="flex shrink-0 gap-px overflow-hidden rounded-md border border-rule bg-rule">
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
                      title={COMPARE_HINT[v]}
                      onClick={() => {
                        viewChosen.current = true
                        setMode(v)
                      }}
                      aria-label={label}
                      className={`px-2.5 py-1 text-[13px] sm:px-3 ${mode === v ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk hover:bg-paper'}`}
                    >
                      {/* "Diff" on a phone, so the row fits one line. */}
                      {v === 'difference' ? (
                        <>
                          <span className="sm:hidden">Diff</span>
                          <span className="hidden sm:inline">{label}</span>
                        </>
                      ) : (
                        label
                      )}
                    </button>
                  ))}
                </div>
                <p className="hidden text-[12.5px] text-ink-muted lg:block lg:min-w-0 lg:flex-1 lg:truncate lg:max-[1399px]:hidden" title={COMPARE_HINT[mode]}>
                  {COMPARE_HINT[mode]}
                </p>
                <div className="flex shrink-0 items-center gap-3" role="group" aria-label="Overlays">
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
                <span className="hidden sm:contents">
                  <ZoomControl zoom={zoom} fit={fitScale} onZoom={setZoom} />
                </span>
              </div>
            </>
          ) : (
            <Empty
              editFirst={editEntry}
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
        <aside
          ref={aside}
          className={`flex w-full shrink-0 flex-col border-rule lg:w-[340px] lg:border-l lg:pb-0 ${docked ? 'min-h-0 flex-1 overflow-y-auto pb-[calc(var(--dock-h)+24px)] lg:flex-none lg:overflow-visible' : ''}`}
          data-phone-show={docked && workMode === 'trace' && !source?.svg ? phoneView : undefined}
        >
          {/* A phone's Download, always in reach at the top of the panel; on a wide screen it is in the column's foot. */}
          {docked && (
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-rule bg-paper px-4 py-2 lg:hidden" data-export-bar="">
              <span className="num min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap" aria-live="polite">
                {dockNote ?? (stats ? `${stats.paths.toLocaleString()} paths · ${formatBytes(stats.bytes)}` : 'Tracing…')}
              </span>
              <button className="btn btn-primary h-10 shrink-0 px-4" disabled={!trace} onClick={download}>
                Download SVG
              </button>
            </div>
          )}
          {/* On a phone the whole aside scrolls (docked), so this must not shrink inside it. */}
          <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {source && (
              <div className="flex items-center justify-between gap-3 border-b border-rule px-5 py-3" data-phone="image">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{source.name}</div>
                  <div className="truncate text-[13px] text-ink-muted tabular-nums" data-image-info="">
                    {source.originalWidth} × {source.originalHeight}
                    {trace && trace.width > source.originalWidth && `, upscaled ${Math.round((trace.width / source.originalWidth) * 10) / 10}× to trace`}
                    {trace && trace.width < source.originalWidth && `, traced at ${trace.width} × ${trace.height}`}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button className="btn" onClick={startOver} title="Clear this image and your edits, here and from this browser’s storage">
                    Start over
                  </button>
                  <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
                    Replace
                  </button>
                </div>
              </div>
            )}
            {source && (
              sessionNote && (
                <p className="border-b border-rule px-5 py-2 text-[12px] text-ink-faint" data-session={sessionNote} data-phone="image">
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
            {cleanable && (
              <div role="tabpanel" id="panel-clean" aria-labelledby="tab-clean" hidden={!doc || workMode !== 'clean'}>
                {workMode === 'clean' && (
                  <Suspense fallback={null}>
                    <CleanPanel
                      source={source}
                      ops={cleanup}
                      onOps={editCleanup}
                      tool={cleanTool}
                      draft={cropDraft}
                      onDraft={setCropDraft}
                      onApplyCrop={applyCrop}
                      showOriginal={showOriginal}
                      onShowOriginal={setShowOriginal}
                      pending={cleanupPending}
                      onSave={save}
                      brush={brush}
                      onBrush={setBrush}
                      inks={inks}
                      picking={cleanPick}
                      onPicking={setCleanPick}
                      fill={fillSettings}
                      onFill={setFillSettings}
                      wand={wand}
                      onWand={setWand}
                      mask={!settings.removeBackground ? 'off' : cleanMask ? 'ready' : cleanupPixelJson !== tracedPixelJson ? 'stale' : 'working'}
                    />
                  </Suspense>
                )}
              </div>
            )}
            <div role="tabpanel" id="panel-edit" aria-labelledby="tab-edit" hidden={!doc || workMode !== 'edit'}>
            {doc && axis && (
              <EditPanel
                tool={tool}
                fillFields={<BucketFields colour={fillColour} onColour={setFillColour} inks={shownInks} busy={filling} error={fillError} />}
                draw={{
                  shape,
                  onShape: setShape,
                  strokeWidth: drawStroke,
                  onStrokeWidth: setDrawStroke,
                  colour: fillColour,
                  onColour: setFillColour,
                  inks: shownInks,
                  onPick: () => setPicking((p) => (p?.target === DRAW_COLOUR ? null : { target: DRAW_COLOUR })),
                  picking: picking?.target === DRAW_COLOUR,
                  penNodes,
                  onPenCommand: (kind) => setPenCommand((c) => ({ kind, seq: (c?.seq ?? 0) + 1 })),
                }}
                cut={{ eraserWidth, onEraserWidth: setEraserWidth, error: cutError, selected: selectedIds.length, busy: cutting }}
                detached={detached}
                selection={
                  selectedPaths.length
                    ? { key: selectedIds.join(' '), shapes: selectedPaths.length, nodes: editingSubs ? nodeCount(editingSubs) : 0, selectedNodes: tool === 'nodes' ? selectedNodes.length : 0, box: selectionBox }
                    : null
                }
                onDeleteSelection={deleteSelection}
                onGroup={groupSelection}
                onUngroup={ungroupSelection}
                onGroupObjects={groupObjects}
                onAlign={alignSelection}
                onDistribute={distributeSelection}
                snapping={snapping}
                onSnapping={setSnapping}
                objectsNote={objectsNote}
                onArrange={arrangeSelection}
                onCombine={combineSelection}
                grouped={!!doc && doc.paths.some((p) => p.group && selectedIds.includes(p.id))}
                onBox={setBox}
                onBoxDone={boxDone}
                onNodeOp={nodeOp}
                shareEdges={shareEdges}
                onShareEdges={setShareEdges}
                selectionNodes={nodesOfSelection}
                simplifyPreview={simplifyPreview}
                onSimplify={simplifySelection}
                onRotate={rotateSelection}
                onFixInImage={cleanable ? fixInImage : undefined}
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
            {doc && tool === 'select' && selectedShown.length > 0 && (
              <StyleFields key={selectedIds.join(' ')} paths={selectedShown} defaultStroke={Math.max(1, Math.round(Math.max(doc.width, doc.height) / 200))} onStyle={styleSelection} />
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
            {doc && workMode === 'edit' && (
              <ShapesList paths={shown} hidden={hiddenSet} locked={lockedSet} selected={selectedSet} onSelect={select} onFlag={flagShapes} />
            )}
            </div>
            <div role="tabpanel" id="panel-trace" aria-labelledby="tab-trace" hidden={!!doc && workMode !== 'trace'}>
              {source?.svg ? (
                <SvgOpened svg={source.svg} onTrace={() => traceInstead()} />
              ) : (
              <Controls
                settings={settings}
                onChange={changeSettings}
                onPreset={choosePreset}
                suggestPoster={suggestPoster}
                measuredStroke={settings.preset === 'centerline' && settings.strokeWidth === 0 ? (trace?.paths[0]?.stroke ?? null) : null}
                prep={{ smallImage: !!base && Math.max(base.bitmap.width, base.bitmap.height) < UPSCALE_BELOW, finer: !!base && settings.preset !== 'pixel' && canTraceFiner(base, maxTraceEdge(settings.preset)), textPreset: canSetText(settings.preset), smoothable: canSmooth(settings.preset), blurry, text: wantText && preparedNow ? preparedNow.text : null, status: prepStatus, error: prepError }}
                currentBytes={stats?.bytes ?? null}
                sizeRun={sizeRun}
                onFindSize={findSize}
                onApplySize={applySize}
                onCancelSize={cancelSize}
                pickingOwn={picking?.target === OWN_COLORS}
                onPickOwn={() => setPicking((p) => (p?.target === OWN_COLORS ? null : { target: OWN_COLORS }))}
              />
              )}
            </div>
          </div>

          {/* On desktop this pins to the foot of the column; on a phone it is the dock's Export view, and the bar at
              the top of the panel keeps Download in reach. Nothing to export before an image is open. */}
          {source && (
            <div id="export" className="scroll-mt-4 border-t border-rule bg-paper px-5 py-4" data-phone="export">
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
                <button className={`btn btn-primary hidden lg:inline-flex ${workMode === 'edit' ? 'col-span-2' : ''}`} disabled={!trace} onClick={download}>
                  Download SVG
                </button>
                {workMode !== 'edit' && (
                  <button className="btn hidden lg:inline-flex" disabled={!trace} onClick={() => chooseMode('edit')} title="Fix the shapes before you download: recolour, move, reshape, mirror">
                    Edit SVG
                  </button>
                )}
                <button className="btn" disabled={!trace} onClick={copy}>
                  {copied ? 'Copied' : 'Copy SVG'}
                </button>
                <button className="btn" disabled={!trace} onClick={downloadLayers} title="One SVG per ink, in a .zip">
                  Layers (.zip)
                </button>
                <button className="btn col-span-2" disabled={!trace} onClick={downloadObjects} title="One SVG per object (each icon or sticker), cropped to it, in a .zip" data-objects-zip="">
                  Objects (.zip)
                </button>
                {objectsError && (
                  <p role="alert" className="col-span-2 text-[12.5px] text-accent">
                    {objectsError}
                  </p>
                )}
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
                  onSwatches={downloadSwatches}
                  hasSwatches={shown.length > 0 || !!edits.background}
                />
              )}
            </div>
          )}

          {/* No room for a page footer, so one quiet line ends the sidebar. A phone has these in the header's menu. */}
          <nav aria-label="About Inlay" className="hidden items-center gap-4 border-t border-rule px-5 py-2.5 text-[12px] text-ink-muted lg:flex lg:h-13 lg:py-0">
            <a href="/docs/overview/" className="hover:text-ink">
              Docs
            </a>
            <a href="/privacy/" className="hover:text-ink">
              Privacy
            </a>
            <a href="https://github.com/mtblck/inlaytrace" className="hover:text-ink">
              Source
            </a>
            <a href="https://ko-fi.com/mtblck" className="hover:text-ink">
              Support Inlay
            </a>
          </nav>
        </aside>
      </main>

      {docked && <Dock modes={cleanable ? ['clean', 'trace', 'edit'] : ['trace', 'edit']} mode={workMode} onMode={chooseMode} edited={detached} slots={dockSlots} />}
    </div>
  )
}

/** The compare views, in a sentence each (the canvas footer). */
const COMPARE_HINT = {
  split: 'Original on the left, SVG on the right. Drag the handle.',
  difference: 'Black means the SVG matches. Bright areas are where it differs.',
  vector: 'The SVG on its own, over a check pattern where it is transparent.',
} as const

function Empty(props: { editFirst: boolean; loading: boolean; error: string | null; onChoose: () => void; onSample: () => void }) {
  return (
    <div className="mat grid flex-1 place-items-center p-4 sm:p-6">
      <div className="w-full max-w-lg rounded-2xl border-2 border-dashed border-on-mat/45 bg-mat-panel px-6 py-10 text-center sm:px-10 sm:py-14">
        {props.loading ? (
          <p className="text-[15px] text-on-mat" aria-live="polite">
            Tracing…
          </p>
        ) : (
          <>
            <h2 className="font-display text-[32px] leading-tight text-on-mat-strong sm:text-[42px]">{props.editFirst ? 'Drop an SVG to edit' : 'Drop an image here'}</h2>
            <p className="mx-auto mt-3 max-w-md text-[14.5px] leading-relaxed text-balance text-on-mat">
              {props.editFirst
                ? 'Or paste one, or choose a file. Its shapes open to edit. A PNG, JPG, WebP, GIF or BMP is traced into shapes first. It never leaves this device: everything runs in your browser.'
                : 'Or paste one, or choose a file. PNG, JPG, WebP, GIF or BMP to trace, or an SVG to edit; several at once to trace them all. It never leaves this device: everything runs in your browser.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button className="btn btn-primary h-11 px-5 text-[15px]" onClick={props.onChoose}>
                {props.editFirst ? 'Choose a file' : 'Choose an image'}
              </button>
              <button className="btn h-11 border-on-mat/50 bg-transparent px-5 text-[15px] text-on-mat-strong hover:bg-white/5" onClick={props.onSample}>
                Try a sample
              </button>
            </div>
            {props.error && (
              <p role="alert" className="mt-4 text-[13.5px] text-mark">
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
    <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Zoom">
      <button className={`${btn} w-6`} onClick={() => onZoom(step(zoom, fit, -1))} disabled={scale <= min * 1.001} aria-label="Zoom out" title="Zoom out (⌘ −)">
        −
      </button>
      <input
        type="range"
        className="w-24 accent-[var(--c-accent)] sm:w-28 lg:max-xl:hidden"
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
      {/* The colour swatch waits for a wider screen, so a phone's compare row stays one line. */}
      <label className="relative hidden h-4 w-4 overflow-hidden rounded-sm border border-rule sm:block" style={{ background: props.color }} title={`${props.label} colour`}>
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
  track('downloaded')
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
        {strokes ? `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'}` : ''}, ready in Edit mode. Nothing is traced: the SVG’s own paths are the drawing.
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

