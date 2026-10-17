import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import type { Axis } from '../lib/mirror'
import { isSmooth, parsePath, type NodePart, type NodeRef, type Pt, type Subpath } from '../lib/pathdata'
import { angleAt, HANDLE_SET, handlePoint, hasRef, normRect, pathBounds, rotateAbout, scaleFromHandle, translate, union, type Affine, type Box, type Handle } from '../lib/transform'
import { anchorScroll, effective, snap, step, wheelFactor, type Zoom } from '../lib/zoom'

export type ViewMode = 'split' | 'difference' | 'vector'
export type Tool = 'select' | 'nodes' | 'mirror'
/** How a click or marquee combines with the current selection: Shift adds (or toggles), Alt removes. */
export type SelectMode = 'set' | 'add' | 'toggle' | 'subtract'
export type Overlays = { paths: boolean; pathColor: string; nodes: boolean; nodeColor: string }
export type ShownPath = { id: string; d: string; fill: string }

type Props = {
  imageUrl: string
  paths: ShownPath[]
  width: number
  height: number
  mode: ViewMode
  /** Screen pixels per original-image pixel, or null to fit the window. */
  zoom: Zoom
  /** The original image's width in pixels, which 100% is measured against. */
  naturalWidth: number
  onZoom: (zoom: Zoom) => void
  /** Reports the fit-to-window scale whenever the window or image changes. */
  onFitScale: (scale: number) => void
  tool: Tool
  overlays: Overlays
  /** Drawn behind every shape, as it will be exported; null is transparent. */
  background: string | null
  /** Selected shapes. In the Nodes tool only the first is edited. */
  selectedIds: string[]
  /** Selected nodes of the shape being edited with the Nodes tool. */
  selectedNodes: NodeRef[]
  axis: Axis | null
  onSelect: (id: string | null, mode?: SelectMode) => void
  onSelectNodes: (refs: NodeRef[], mode: SelectMode) => void
  /** A finished marquee, in SVG units. */
  onMarquee: (rect: Box, mode: SelectMode) => void
  /** Double-click on a shape with the Select tool: edit its nodes. */
  onEnterNodes: (id: string) => void
  /**
   * Called on every pointer move while dragging a node or handle; `end` on
   * release. `smooth` asks for the opposite handle to stay in line.
   */
  onDragNode: (ref: NodeRef, part: NodePart, to: Pt, phase: 'move' | 'end', smooth: boolean) => void
  /** Moving, scaling or rotating the selected shapes: `m` is relative to where the drag began. */
  onTransform: (m: Affine, phase: 'move' | 'end') => void
  /** Double-click on the edited shape's outline with the Nodes tool: add a node there (SVG units). */
  onAddNode: (at: Pt) => void
  /** The eyedropper is armed: the next click on the image picks a colour from the original there (SVG units). */
  picking: boolean
  onPick: (at: Pt) => void
  onAxis: (position: number) => void
}

// On-screen sizes, constant at every zoom: divided by the sheet's scale to get
// SVG units, so a node is always a 7 px square and a handle a 3 px dot.
const NODE_PX = 7
const HANDLE_PX = 3
const HIT_PX = 10
/** Bounding-box handles: a square this size on screen. */
const BOX_PX = 8
/** How far above the box the rotate handle sits, on screen. */
const ROTATE_PX = 22
const CURSORS: Record<string, string> = { '-1-1': 'nwse-resize', '11': 'nwse-resize', '1-1': 'nesw-resize', '-11': 'nesw-resize', '0-1': 'ns-resize', '01': 'ns-resize', '-10': 'ew-resize', '10': 'ew-resize' }
/** Screen pixels the pointer must travel before a press on a node becomes a drag. */
const DRAG_PX = 3
const HANDLES = ['in', 'out'] as const
/** Beyond this many nodes the overlay is skipped: drawing them costs seconds and shows nothing legible. */
export const MAX_OVERLAY_NODES = 20_000

/**
 * The work surface. Everything is drawn into one box so the split, the
 * difference blend and every overlay line up to the pixel:
 *
 *   raster image  →  the vector (clipped for Split, blended for Difference)
 *                 →  one overlay SVG, never clipped or blended
 *
 * The overlay carries everything interactive: invisible hit shapes for
 * selection, path outlines, nodes, the selected path's handles and the mirror
 * axis. Keeping interaction off the vector layer means clicking a shape works on
 * both sides of the split, and the export never contains editor furniture.
 */
export function Canvas(props: Props) {
  const { width, height, mode, zoom, tool, overlays } = props
  const matRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ w: 0, h: 0 })
  const [split, setSplit] = useState(50)
  const drag = useRef<
    | null
    | { kind: 'split' }
    | { kind: 'axis' }
    // `grab` is the node's offset from the pointer at press, so the node keeps
    // its place under the pointer instead of jumping to it; `moved` stays false
    // until the pointer travels DRAG_PX, so a plain click selects without editing.
    // `smooth` is decided once, at the press: a drag that bends a handle past the
    // threshold shouldn't suddenly let go of its partner.
    | { kind: 'node'; ref: NodeRef; part: NodePart; grab: Pt; from: { x: number; y: number }; moved: boolean; smooth: boolean; reselect: boolean }
    // Moving the selected shapes; `reselect` narrows a multi-selection to the
    // pressed shape if the press turns out to be a click.
    // `last` is the latest transform sent, so a drag the browser cancels still ends where it was.
    | { kind: 'move'; id: string; start: Pt; from: { x: number; y: number }; moved: boolean; reselect: boolean; last: Affine | null }
    | { kind: 'scale'; handle: Handle; box: Box; grab: Pt; from: { x: number; y: number }; moved: boolean; last: Affine | null }
    | { kind: 'rotate'; centre: Pt; start: number; from: { x: number; y: number }; moved: boolean; last: Affine | null }
    | { kind: 'marquee'; start: Pt; from: { x: number; y: number }; moved: boolean; mode: SelectMode; clickId: string | null }
  >(null)
  const [marquee, setMarquee] = useState<Box | null>(null)

  useLayoutEffect(() => {
    const mat = matRef.current
    if (!mat) return
    const measure = () => {
      const pad = 32
      const availW = Math.max(0, mat.clientWidth - pad * 2)
      const availH = Math.max(0, mat.clientHeight - pad * 2)
      const scale = Math.min(availW / width, availH / height)
      setFit({ w: Math.floor(width * scale), h: Math.floor(height * scale) })
      setView({ w: mat.clientWidth, h: mat.clientHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(mat)
    return () => ro.disconnect()
  }, [width, height])

  const fitScale = fit.w > 0 && props.naturalWidth > 0 ? fit.w / props.naturalWidth : 1
  const scale = effective(zoom, fitScale)
  const w = fit.w > 0 ? Math.round(props.naturalWidth * scale) : 0
  const h = width > 0 ? Math.round((w * height) / width) : 0
  // Zoomed past fit, the sheet can be panned until any edge reaches the middle
  // of the window, so zooming around a point near an edge keeps that point
  // under the cursor instead of snapping to the edge. At fit or below it is
  // simply centred.
  const zoomedIn = scale > fitScale * 1.001
  const padX = zoomedIn ? Math.max(32, Math.round(view.w / 2)) : 32
  const padY = zoomedIn ? Math.max(32, Math.round(view.h / 2)) : 32
  // SVG units per screen pixel.
  const unit = w > 0 ? width / w : 1

  const { onFitScale } = props
  useLayoutEffect(() => {
    if (fit.w > 0) onFitScale(fitScale)
  }, [fit.w, fitScale, onFitScale])

  // ---- Zoom around a point ------------------------------------------------------
  // The sheet's last on-screen rect, the point a pending zoom should hold
  // still, and the scale the next wheel event builds on (several can arrive
  // before React re-renders).
  const sheetRef = useRef<HTMLDivElement>(null)
  const lastRect = useRef<DOMRect | null>(null)
  const anchor = useRef<{ x: number; y: number } | null>(null)
  const target = useRef(scale)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const live = useRef({ scale, fitScale, onZoom: props.onZoom })
  live.current = { scale, fitScale, onZoom: props.onZoom }

  useLayoutEffect(() => {
    const mat = matRef.current
    const sheet = sheetRef.current
    if (!mat || !sheet) return
    const before = lastRect.current
    const after = sheet.getBoundingClientRect()
    if (before && (before.width !== after.width || before.height !== after.height)) {
      const m = mat.getBoundingClientRect()
      const at = anchor.current ?? { x: m.left + m.width / 2, y: m.top + m.height / 2 }
      const { dx, dy } = anchorScroll(before, after, at.x, at.y)
      mat.scrollLeft += dx
      mat.scrollTop += dy
    }
    anchor.current = null
    target.current = scale
    lastRect.current = sheet.getBoundingClientRect()
  }, [w, h, scale])

  useEffect(() => {
    const mat = matRef.current
    if (!mat) return
    const zoomTo = (next: number, at: { x: number; y: number } | null) => {
      const { fitScale, onZoom } = live.current
      target.current = next
      anchor.current = at
      onZoom(snap(next, fitScale))
    }
    // A trackpad pinch is a wheel event with ctrlKey set (Chrome, Firefox, Edge);
    // ⌘/Ctrl + mouse wheel zooms too. Plain scrolling is left alone.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomTo(target.current * wheelFactor(e.deltaY, e.deltaMode), { x: e.clientX, y: e.clientY })
    }
    // Safari reports pinches as gesture events instead.
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number }
    let base = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      base = target.current
    }
    const onGestureChange = (e: Event) => {
      const g = e as Gesture
      e.preventDefault()
      zoomTo(base * g.scale, { x: g.clientX, y: g.clientY })
    }
    const onScroll = () => {
      if (sheetRef.current) lastRect.current = sheetRef.current.getBoundingClientRect()
    }
    // ⌘/Ctrl + = − 0 1 while the pointer is over the canvas or focus is inside it.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      if (!pointer.current && !mat.contains(document.activeElement)) return
      const { fitScale, onZoom } = live.current
      const at = pointer.current
      if (e.key === '=' || e.key === '+') zoomTo(effective(step(target.current, fitScale, 1), fitScale), at)
      else if (e.key === '-' || e.key === '_') zoomTo(effective(step(target.current, fitScale, -1), fitScale), at)
      else if (e.key === '0') {
        anchor.current = null
        onZoom(null)
      } else if (e.key === '1') zoomTo(1, at)
      else return
      e.preventDefault()
    }
    mat.addEventListener('wheel', onWheel, { passive: false })
    mat.addEventListener('gesturestart', onGestureStart)
    mat.addEventListener('gesturechange', onGestureChange)
    mat.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      mat.removeEventListener('wheel', onWheel)
      mat.removeEventListener('gesturestart', onGestureStart)
      mat.removeEventListener('gesturechange', onGestureChange)
      mat.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  /** Screen → SVG coordinates, through the overlay's own transform, so zoom and scroll never matter. */
  const toSvg = useCallback((e: { clientX: number; clientY: number }): Pt | null => {
    const svg = overlayRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }, [])

  const selectedSet = useMemo(() => new Set(props.selectedIds), [props.selectedIds])
  const selectedPaths = useMemo(() => props.paths.filter((p) => selectedSet.has(p.id)), [props.paths, selectedSet])
  // The Nodes tool edits one shape at a time.
  const selected = tool === 'nodes' ? (selectedPaths.find((p) => p.id === props.selectedIds[0]) ?? null) : null
  const box = useMemo(() => (tool === 'select' && selectedPaths.length ? union(selectedPaths.map((p) => pathBounds(p.d))) : null), [tool, selectedPaths])
  const selectedSubs = useMemo<Subpath[]>(() => (selected ? parsePath(selected.d) : []), [selected])
  const nodeList = useMemo(() => selectedSubs.flatMap((s, sub) => s.nodes.map((n, index) => ({ ref: { sub, index }, n }))), [selectedSubs])
  // Nodes per path, cached by path data: during a drag only one path changes,
  // so only that one is parsed again.
  const nodeCache = useRef(new Map<string, Pt[]>())
  const allNodes = useMemo(() => {
    if (!overlays.nodes) return null
    const prev = nodeCache.current
    const next = new Map<string, Pt[]>()
    const pts: Pt[] = []
    for (const p of props.paths) {
      let n = next.get(p.d) ?? prev.get(p.d)
      if (!n) n = parsePath(p.d).flatMap((s) => s.nodes.map(({ x, y }) => ({ x, y })))
      next.set(p.d, n)
      for (const q of n) pts.push(q)
    }
    nodeCache.current = next
    return pts
  }, [overlays.nodes, props.paths])
  // Every node as one path of squares: one element instead of tens of thousands.
  const nodeOverlay = useMemo(() => {
    if (!allNodes || allNodes.length > MAX_OVERLAY_NODES) return null
    const s = NODE_PX * unit
    const r = (n: number) => Math.round(n * 100) / 100
    return allNodes.map((n) => `M${r(n.x - s / 2)} ${r(n.y - s / 2)}h${r(s)}v${r(s)}h${r(-s)}z`).join('')
  }, [allNodes, unit])

  // ---- Pointer handling ----------------------------------------------------
  const far = (d: { from: { x: number; y: number } }, e: { clientX: number; clientY: number }) => Math.hypot(e.clientX - d.from.x, e.clientY - d.from.y) >= DRAG_PX
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'split') {
      const rect = sheetRef.current!.getBoundingClientRect()
      setSplit(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)))
      return
    }
    const p = toSvg(e)
    if (!p) return
    if (d.kind === 'node') {
      if (!d.moved && !far(d, e)) return
      d.moved = true
      props.onDragNode(d.ref, d.part, { x: p.x + d.grab.x, y: p.y + d.grab.y }, 'move', d.smooth && !e.altKey)
    } else if (d.kind === 'move') {
      if (!d.moved && !far(d, e)) return
      d.moved = true
      d.last = moveBy(d.start, p, e.shiftKey)
      props.onTransform(d.last, 'move')
    } else if (d.kind === 'scale') {
      // Like a node, a handle only starts scaling after DRAG_PX: a click on it changes nothing.
      if (!d.moved && !far(d, e)) return
      d.moved = true
      d.last = scaleFromHandle(d.box, d.handle, { x: p.x + d.grab.x, y: p.y + d.grab.y }, { proportional: e.shiftKey, fromCentre: e.altKey })
      props.onTransform(d.last, 'move')
    } else if (d.kind === 'rotate') {
      if (!d.moved && !far(d, e)) return
      d.moved = true
      d.last = rotateBy(d, p, e.shiftKey)
      props.onTransform(d.last, 'move')
    } else if (d.kind === 'marquee') {
      if (!d.moved && !far(d, e)) return
      d.moved = true
      setMarquee(normRect(d.start, p))
    } else props.onAxis(clampAxis(props.axis!, p, width, height))
  }
  const onUp = (e: RPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    const p = toSvg(e)
    // A press that never became a drag only selected; it changes nothing.
    if (d.kind === 'node') {
      if (d.moved && p) props.onDragNode(d.ref, d.part, { x: p.x + d.grab.x, y: p.y + d.grab.y }, 'end', d.smooth && !e.altKey)
      else if (!d.moved && d.reselect) props.onSelectNodes([d.ref], 'set')
    } else if (d.kind === 'move') {
      if (d.moved) props.onTransform(e.type === 'pointerup' && p ? moveBy(d.start, p, e.shiftKey) : d.last!, 'end')
      else if (d.reselect) props.onSelect(d.id, 'set')
    } else if (d.kind === 'scale') {
      if (d.moved)
        props.onTransform(e.type === 'pointerup' && p ? scaleFromHandle(d.box, d.handle, { x: p.x + d.grab.x, y: p.y + d.grab.y }, { proportional: e.shiftKey, fromCentre: e.altKey }) : d.last!, 'end')
    } else if (d.kind === 'rotate') {
      if (d.moved) props.onTransform(e.type === 'pointerup' && p ? rotateBy(d, p, e.shiftKey) : d.last!, 'end')
    } else if (d.kind === 'marquee') {
      setMarquee(null)
      if (d.moved && p) props.onMarquee(normRect(d.start, p), d.mode)
      // A plain click on empty canvas clears the selection, and on a shape
      // (Nodes tool) selects it. A ⇧/⌥-click that misses keeps the selection.
      else if (!d.moved && d.mode === 'set') props.onSelect(d.clickId, 'set')
    }
  }
  /** Start dragging the anchor or a handle at `at` (SVG units). */
  const grabNode = (e: RPointerEvent, ref: NodeRef, part: NodePart, at: Pt, node: Subpath['nodes'][number]) => {
    const already = hasRef(props.selectedNodes, ref)
    let reselect = false
    if (part === 'anchor') {
      if (e.shiftKey) props.onSelectNodes([ref], 'toggle')
      else if (!already) props.onSelectNodes([ref], 'set')
      // Pressing one of several selected nodes keeps them all, so they drag
      // together; a plain click (no drag) then narrows to this one.
      else reselect = props.selectedNodes.length > 1
    } else if (!already) props.onSelectNodes([ref], 'set')
    const p = toSvg(e) ?? at
    startDrag(e, { kind: 'node', ref, part, grab: { x: at.x - p.x, y: at.y - p.y }, from: { x: e.clientX, y: e.clientY }, moved: false, smooth: part !== 'anchor' && isSmooth(node), reselect })
  }
  const startDrag = (e: RPointerEvent, next: NonNullable<typeof drag.current>) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = next
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }
  const modeOf = (e: { shiftKey: boolean; altKey: boolean }): SelectMode => (e.altKey ? 'subtract' : e.shiftKey ? 'add' : 'set')
  const startMarquee = (e: RPointerEvent, clickId: string | null) => {
    const p = toSvg(e)
    if (!p || e.button !== 0) return
    startDrag(e, { kind: 'marquee', start: p, from: { x: e.clientX, y: e.clientY }, moved: false, mode: modeOf(e), clickId })
  }
  // Read through a ref so the memoised hit paths can keep one stable callback.
  const shapeDown = useRef<(e: RPointerEvent, id: string) => void>(() => {})
  shapeDown.current = (e, id) => {
    if (tool === 'nodes') {
      // In the Nodes tool a drag anywhere draws a marquee round nodes; a click picks the shape.
      if (id === props.selectedIds[0]) startMarquee(e, id)
      else {
        e.stopPropagation()
        props.onSelect(id, 'set')
      }
      return
    }
    if (tool !== 'select') return
    if (e.shiftKey) {
      e.stopPropagation()
      props.onSelect(id, 'toggle')
      return
    }
    const was = selectedSet.has(id)
    if (!was) props.onSelect(id, 'set')
    const p = toSvg(e)
    if (p) startDrag(e, { kind: 'move', id, start: p, from: { x: e.clientX, y: e.clientY }, moved: false, reselect: was && props.selectedIds.length > 1, last: null })
  }
  const onShapeDown = useCallback((e: RPointerEvent, id: string) => shapeDown.current(e, id), [])
  const enterNodes = useRef(props.onEnterNodes)
  enterNodes.current = props.onEnterNodes
  const onShapeDouble = useCallback((id: string) => tool === 'select' && enterNodes.current(id), [tool])

  const onSplitKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0, s - step))
    else if (e.key === 'ArrowRight') setSplit((s) => Math.min(100, s + step))
    else if (e.key === 'Home') setSplit(0)
    else if (e.key === 'End') setSplit(100)
    else return
    e.preventDefault()
  }

  const vectorBox = `0 0 ${width} ${height}`

  return (
    <div
      ref={matRef}
      className="mat absolute inset-0 overflow-auto"
      data-zoom={Math.round(scale * 1000) / 1000}
      onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
      onPointerLeave={() => (pointer.current = null)}
    >
      {/* Sized to the sheet plus padding, never smaller than the window, so a
          zoomed sheet scrolls in both directions and a fitted one stays centred. */}
      <div
        className="grid min-h-full min-w-full place-items-center"
        style={{ width: w + 2 * padX, height: h + 2 * padY, padding: `${padY}px ${padX}px` }}
        // A marquee can start in the margin round the image, which matters when a
        // background shape covers the whole canvas.
        onPointerDown={(e) => {
          if (e.target === e.currentTarget && (tool === 'select' || tool === 'nodes')) startMarquee(e, null)
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div
          ref={sheetRef}
          className="checker relative shadow-[0_0_0_1px_var(--c-rule)] select-none"
          // Touch scrolls the page unless something on the canvas is draggable:
          // a selected shape's nodes or the mirror axis. The split handle opts
          // out on its own.
          style={{ width: w, height: h, touchAction: props.selectedIds.length || tool === 'mirror' ? 'none' : undefined }}
        >
          {mode !== 'vector' && (
            <img
              src={props.imageUrl}
              alt="Original image"
              draggable={false}
              className="absolute inset-0 h-full w-full"
              style={{ imageRendering: scale >= 3 ? 'pixelated' : undefined }}
            />
          )}

          {/* The vector, exactly as it will be exported. */}
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={vectorBox}
            preserveAspectRatio="none"
            role="img"
            aria-label="Traced SVG"
            style={{
              clipPath: mode === 'split' ? `inset(0 0 0 ${split}%)` : undefined,
              mixBlendMode: mode === 'difference' ? 'difference' : undefined,
              pointerEvents: 'none',
            }}
          >
            {props.background && <rect width={width} height={height} fill={props.background} data-background="" />}
            {props.paths.map((p) => (
              <VectorPath key={p.id} d={p.d} fill={p.fill} />
            ))}
          </svg>

          {/* Everything interactive or editorial. Never exported. */}
          <svg
            ref={overlayRef}
            className="absolute inset-0 h-full w-full"
            viewBox={vectorBox}
            preserveAspectRatio="none"
            onPointerDown={(e) => {
              // Empty canvas: a drag draws a marquee, a click clears the selection.
              if ((tool === 'select' || tool === 'nodes') && e.target === e.currentTarget) startMarquee(e, null)
            }}
          >
            {tool !== 'mirror' &&
              props.paths.map((p) => <HitPath key={p.id} id={p.id} d={p.d} movable={tool === 'select' && selectedSet.has(p.id)} onDown={onShapeDown} onDouble={onShapeDouble} />)}

            {overlays.paths && (
              <g fill="none" stroke={overlays.pathColor} strokeWidth={1} pointerEvents="none">
                {props.paths.map((p) => (
                  <OutlinePath key={p.id} d={p.d} />
                ))}
              </g>
            )}

            {nodeOverlay !== null && (
              <path d={nodeOverlay} fill={overlays.nodeColor} opacity={0.9} pointerEvents="none" data-overlay="nodes" data-count={allNodes!.length} />
            )}

            {selected && (
              // Drawn in layers across all nodes, so a neighbour's generous hit
              // area can never sit on top of the node you can see: invisible
              // targets (handles, then anchors) under visible handles, under
              // visible anchors.
              <g data-selected={selected.id}>
                <path d={selected.d} fill="none" stroke="var(--c-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {/* The outline as a wide invisible stroke: double-click adds a node there. A
                    press still behaves as on the shape (a marquee round nodes). */}
                <path
                  d={selected.d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={HIT_PX}
                  vectorEffect="non-scaling-stroke"
                  pointerEvents="stroke"
                  data-outline-hit=""
                  style={{ cursor: 'copy' }}
                  onPointerDown={(e) => {
                    // A press near the edge belongs to whichever shape is under the
                    // pointer, so a touching neighbour can still be clicked; only
                    // the double-click is this stroke's own.
                    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof SVGPathElement && el.dataset.pathId)
                    onShapeDown(e, (under as SVGPathElement | undefined)?.dataset.pathId ?? selected.id)
                  }}
                  onDoubleClick={(e) => {
                    const p = toSvg(e)
                    if (p) props.onAddNode(p)
                  }}
                />
                {nodeList.map(({ ref, n }) =>
                  HANDLES.map((part) => {
                    const hnd = n[part]
                    return hnd && <circle key={`h${ref.sub}:${ref.index}:${part}`} cx={hnd.x} cy={hnd.y} r={HIT_PX * unit} fill="transparent" onPointerDown={(e) => grabNode(e, ref, part, hnd, n)} style={{ cursor: 'grab' }} />
                  }),
                )}
                {nodeList.map(({ ref, n }) => (
                  <circle key={`a${ref.sub}:${ref.index}`} cx={n.x} cy={n.y} r={HIT_PX * unit} fill="transparent" onPointerDown={(e) => grabNode(e, ref, 'anchor', n, n)} style={{ cursor: 'move' }} />
                ))}
                {nodeList.map(({ ref, n }) =>
                  HANDLES.map((part) => {
                    const hnd = n[part]
                    if (!hnd) return null
                    return (
                      <g key={`v${ref.sub}:${ref.index}:${part}`}>
                        <line x1={n.x} y1={n.y} x2={hnd.x} y2={hnd.y} stroke="var(--c-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                        <circle
                          cx={hnd.x}
                          cy={hnd.y}
                          r={HANDLE_PX * unit}
                          fill="var(--c-paper)"
                          stroke="var(--c-accent)"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          data-handle={`${ref.sub}:${ref.index}:${part}`}
                          style={{ cursor: 'grab' }}
                          onPointerDown={(e) => grabNode(e, ref, part, hnd, n)}
                        />
                      </g>
                    )
                  }),
                )}
                {nodeList.map(({ ref, n }) => {
                  const isSel = hasRef(props.selectedNodes, ref)
                  return (
                    <rect
                      key={`n${ref.sub}:${ref.index}`}
                      x={n.x - (NODE_PX * unit) / 2}
                      y={n.y - (NODE_PX * unit) / 2}
                      width={NODE_PX * unit}
                      height={NODE_PX * unit}
                      fill={isSel ? 'var(--c-accent)' : 'var(--c-paper)'}
                      stroke="var(--c-accent)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      data-node={`${ref.sub}:${ref.index}`}
                      data-node-selected={isSel ? '' : undefined}
                      style={{ cursor: 'move' }}
                      onPointerDown={(e) => grabNode(e, ref, 'anchor', n, n)}
                    />
                  )
                })}
              </g>
            )}

            {box && (
              <g data-selection-box={props.selectedIds.length}>
                {selectedPaths.length > 1 &&
                  selectedPaths.map((p) => <path key={p.id} d={p.d} fill="none" stroke="var(--c-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />)}
                {selectedPaths.length === 1 && <path d={selectedPaths[0].d} fill="none" stroke="var(--c-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />}
                <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="none" stroke="var(--c-accent)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {(() => {
                  const top = handlePoint(box, { h: 0, v: -1 })
                  const knob = { x: top.x, y: top.y - ROTATE_PX * unit }
                  const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
                  return (
                    <g>
                      <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} stroke="var(--c-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                      <circle
                        cx={knob.x}
                        cy={knob.y}
                        r={(BOX_PX / 2 + 1) * unit}
                        fill="var(--c-paper)"
                        stroke="var(--c-accent)"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        data-rotate-handle=""
                        style={{ cursor: 'grab' }}
                        onPointerDown={(e) => {
                          const p = toSvg(e)
                          if (p) startDrag(e, { kind: 'rotate', centre, start: angleAt(centre, p), from: { x: e.clientX, y: e.clientY }, moved: false, last: null })
                        }}
                      />
                    </g>
                  )
                })()}
                {HANDLE_SET.map((k) => {
                  const at = handlePoint(box, k)
                  const s = BOX_PX * unit
                  return (
                    <rect
                      key={`${k.h}${k.v}`}
                      x={at.x - s / 2}
                      y={at.y - s / 2}
                      width={s}
                      height={s}
                      fill="var(--c-paper)"
                      stroke="var(--c-accent)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      data-box-handle={`${k.h},${k.v}`}
                      style={{ cursor: CURSORS[`${k.h}${k.v}`] }}
                      onPointerDown={(e) => {
                        const p = toSvg(e)
                        if (p) startDrag(e, { kind: 'scale', handle: k, box, grab: { x: at.x - p.x, y: at.y - p.y }, from: { x: e.clientX, y: e.clientY }, moved: false, last: null })
                      }}
                    />
                  )
                })}
              </g>
            )}

            {marquee && (
              <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} fill="var(--c-accent-dim)" stroke="var(--c-accent)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" pointerEvents="none" data-marquee="" />
            )}

            {/* The eyedropper: over everything, so the click picks instead of selecting. */}
            {props.picking && (
              <rect
                width={width}
                height={height}
                fill="transparent"
                data-picker=""
                style={{ cursor: 'crosshair' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  const p = toSvg(e)
                  if (p) props.onPick(p)
                }}
              />
            )}

            {tool === 'mirror' && props.axis && <AxisOverlay axis={props.axis} width={width} height={height} unit={unit} onGrab={(e) => startDrag(e, { kind: 'axis' })} />}
          </svg>

          {allNodes && allNodes.length > MAX_OVERLAY_NODES && (
            <p className="absolute top-2 left-2 rounded bg-paper/90 px-2 py-1 text-[12px] text-ink-muted shadow-sm" role="status">
              {allNodes.length.toLocaleString()} nodes is too many to draw. Select a shape to see its own.
            </p>
          )}

          {mode === 'split' && (
            <div
              role="slider"
              tabIndex={0}
              aria-label="Comparison split. Left is the original, right is the SVG."
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              onKeyDown={onSplitKey}
              onPointerDown={(e) => startDrag(e, { kind: 'split' })}
              className="group absolute top-0 bottom-0 -ml-3 w-6 cursor-ew-resize"
              style={{ left: `${split}%`, touchAction: 'none' }}
            >
              <div className="mx-auto h-full w-px bg-accent" />
              <div className="absolute top-1/2 left-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-accent bg-paper text-accent shadow-sm">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M5 3 1 7l4 4M9 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Each shape is its own memoised element: dragging a node changes one path,
// and the thousands of others in a busy trace skip re-rendering entirely.
const VectorPath = memo(function VectorPath({ d, fill }: { d: string; fill: string }) {
  return <path d={d} fill={fill} />
})
const OutlinePath = memo(function OutlinePath({ d }: { d: string }) {
  return <path d={d} vectorEffect="non-scaling-stroke" />
})
type HitProps = { id: string; d: string; movable: boolean; onDown: (e: RPointerEvent, id: string) => void; onDouble: (id: string) => void }
const HitPath = memo(function HitPath({ id, d, movable, onDown, onDouble }: HitProps) {
  return (
    <path
      d={d}
      fill="transparent"
      pointerEvents="fill"
      data-path-id={id}
      style={{ cursor: movable ? 'move' : 'pointer' }}
      onPointerDown={(e) => onDown(e, id)}
      onDoubleClick={() => onDouble(id)}
    />
  )
})

/** A rotation about the drag's centre by how far the pointer has swung round it; Shift snaps to 15°. */
function rotateBy(d: { centre: Pt; start: number }, p: Pt, snap: boolean) {
  let deg = angleAt(d.centre, p) - d.start
  if (snap) deg = Math.round(deg / 15) * 15
  return rotateAbout(d.centre, deg)
}

/** A move from `start` to `p`; with Shift, along whichever axis moved further. */
function moveBy(start: Pt, p: Pt, constrain: boolean) {
  let dx = p.x - start.x
  let dy = p.y - start.y
  if (constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0
    else dx = 0
  }
  return translate(dx, dy)
}

/** The mirror axis: a draggable line, with the side being replaced washed out. */
function AxisOverlay({ axis, width, height, unit, onGrab }: { axis: Axis; width: number; height: number; unit: number; onGrab: (e: RPointerEvent) => void }) {
  const v = axis.orientation === 'vertical'
  const a = axis.position
  // The discarded side, which the reflection will replace.
  const gone = v
    ? axis.keep === 'start'
      ? { x: a, y: 0, width: width - a, height }
      : { x: 0, y: 0, width: a, height }
    : axis.keep === 'start'
      ? { x: 0, y: a, width, height: height - a }
      : { x: 0, y: 0, width, height: a }
  const line = v ? { x1: a, y1: 0, x2: a, y2: height } : { x1: 0, y1: a, x2: width, y2: a }
  return (
    <g data-overlay="axis">
      <rect {...gone} fill="var(--c-paper)" opacity={0.55} pointerEvents="none" />
      <line {...line} stroke="var(--c-accent)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
      <line {...line} stroke="transparent" strokeWidth={HIT_PX * 2 * unit} style={{ cursor: v ? 'ew-resize' : 'ns-resize' }} onPointerDown={onGrab} data-axis-handle="" />
    </g>
  )
}

function clampAxis(axis: Axis, p: Pt, width: number, height: number) {
  const v = axis.orientation === 'vertical'
  const max = v ? width : height
  return Math.round(Math.min(max, Math.max(0, v ? p.x : p.y)) * 10) / 10
}
