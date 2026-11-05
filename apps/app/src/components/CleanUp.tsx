/**
 * Clean up mode (#199, #202): the canvas and panel for editing the image
 * before it is traced. Loaded only when the mode is first opened (App
 * lazy-loads this module), with the replay it uses.
 *
 * The canvas shows the cleaned image, replayed from the list on every change,
 * with the current trace as a faint outline while its geometry still matches.
 * Crop draws a box (handles to adjust, Enter or the panel to apply);
 * Straighten draws a line along something that should be level or upright;
 * Brush and Eraser paint, a stroke at a time. It zooms (pinch, ⌘/Ctrl + wheel
 * or the buttons) and pans (two fingers, the wheel, or Space or the middle
 * button and drag) on its own, since painting needs a close look. The panel
 * holds the rest: quarter turns, an angle, flips, the brush, levels,
 * threshold, before and after, and the cleaned PNG.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import {
  addOp,
  adjustmentOf,
  BRUSH_MAX,
  BRUSH_MIN,
  clamp,
  LEVELS_DEFAULT,
  MAX_STROKE_POINTS,
  MIN_CROP_PX,
  sameGeometry,
  setAdjustment,
  straightenAngle,
  THRESHOLD_DEFAULT,
  type BrushSettings,
  type CleanupOp,
  type Img,
  type Paint,
} from '../lib/cleanup'
import { backgroundOf, composite, dabAt, stampSegment, strokeColour, type Dab } from '../lib/cleanupPixels'
import { cleanedPixels, originalPixels, pngOf } from '../lib/cleanupRun'
import type { Ink, ShownPath } from '../lib/doc'
import type { Source } from '../lib/image'
import { wheelFactor } from '../lib/zoom'
import { Section, Slider } from './Controls'

export type CleanTool = 'crop' | 'straighten' | 'brush' | 'eraser'
export const isPaintTool = (t: CleanTool): t is 'brush' | 'eraser' => t === 'brush' || t === 'eraser'
/** A crop box being drawn, in fractions of the cleaned image. */
export type CropDraft = { x: number; y: number; width: number; height: number }

type Pt = { x: number; y: number }
const HANDLE_PX = 9
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const hex2 = (v: number) => v.toString(16).padStart(2, '0')
/** The colour of the pixel at (x, y), fractions of the image. */
const pixelHex = (img: Img, x: number, y: number) => {
  const o = (clamp(Math.floor(y * img.height), 0, img.height - 1) * img.width + clamp(Math.floor(x * img.width), 0, img.width - 1)) * 4
  return `#${hex2(img.rgba[o])}${hex2(img.rgba[o + 1])}${hex2(img.rgba[o + 2])}`
}
const round = (v: number, places: number) => Math.round(v * 10 ** places) / 10 ** places

/** The zoom: `k` times the fitted size, the image's centre moved (tx, ty) screen pixels from the canvas's. */
type View = { k: number; tx: number; ty: number }
const FIT: View = { k: 1, tx: 0, ty: 0 }
const ZOOM_STEP = Math.SQRT2

type Drag =
  | { kind: 'new' | 'move' | 'resize'; start: Pt; from: CropDraft | null; hx: number; hy: number }
  | { kind: 'line'; start: Pt }
  | { kind: 'pan'; x: number; y: number; view: View }
type Stroke = { op: Paint; base: Img; mask: Uint8Array; out: Uint8ClampedArray; data: ImageData; colour: [number, number, number, number]; last: Dab | null }

export function CleanCanvas(p: {
  source: Source
  ops: CleanupOp[]
  /** The list the current trace was made from: its outline shows while the geometry matches. */
  traced: CleanupOp[]
  outline: { paths: ShownPath[]; width: number; height: number } | null
  showOriginal: boolean
  tool: CleanTool
  draft: CropDraft | null
  onDraft: (d: CropDraft | null) => void
  onStraighten: (degrees: number) => void
  brush: BrushSettings
  onBrush: (b: BrushSettings) => void
  onStroke: (op: Paint) => void
  /** The next click picks the brush colour from the image. */
  picking: boolean
  onPick: (hex: string) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<SVGSVGElement>(null)
  const [room, setRoom] = useState({ w: 0, h: 0 })
  const img: Img = useMemo(() => (p.showOriginal ? originalPixels(p.source) : cleanedPixels(p.source, p.ops)), [p.source, p.ops, p.showOriginal])

  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => setRoom({ w: Math.max(0, box.clientWidth - 48), h: Math.max(0, box.clientHeight - 48) })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const draw = (from: Img) => {
    const c = canvasRef.current
    if (!c) return
    c.width = from.width
    c.height = from.height
    c.getContext('2d')!.putImageData(new ImageData(from.rgba as Uint8ClampedArray<ArrayBuffer>, from.width, from.height), 0, 0)
  }
  useEffect(() => draw(img), [img])
  const imgRef = useRef(img)
  imgRef.current = img

  const scale = room.w && room.h ? Math.min(room.w / img.width, room.h / img.height) : 0
  const w = img.width * scale
  const h = img.height * scale

  // ---- Zoom and pan -------------------------------------------------------------
  const [view, setView] = useState<View>(FIT)
  // Up to 16 screen pixels an image pixel, or 8× fit if that's more.
  const maxK = scale ? Math.max(8, 16 / scale) : 8
  const geo = useRef({ w, h, maxK })
  geo.current = { w, h, maxK }
  const fitView = (v: View): View => {
    const { w, h, maxK } = geo.current
    const k = clamp(v.k, 1, maxK)
    if (k < 1.001) return FIT
    // Keep some of the image under the canvas's centre.
    return { k, tx: clamp(v.tx, (-w * k) / 2, (w * k) / 2), ty: clamp(v.ty, (-h * k) / 2, (h * k) / 2) }
  }
  /** Zoom by `factor` keeping the image point under (cx, cy) on screen where it is; from `base` when given (a pinch). */
  const zoomAt = (factor: number, cx: number, cy: number, base?: View, to?: Pt) => {
    const r = boxRef.current!.getBoundingClientRect()
    const ox = r.left + r.width / 2
    const oy = r.top + r.height / 2
    setView((now) => {
      const v = base ?? now
      const k = clamp(v.k * factor, 1, geo.current.maxK)
      const ux = (cx - ox - v.tx) / v.k
      const uy = (cy - oy - v.ty) / v.k
      return fitView({ k, tx: (to?.x ?? cx) - ox - k * ux, ty: (to?.y ?? cy) - oy - k * uy })
    })
  }
  const zoomRef = useRef(zoomAt)
  zoomRef.current = zoomAt
  // A new size (a crop or a turn) starts from the whole image again.
  useEffect(() => setView(FIT), [img.width, img.height])

  const hovering = useRef<Pt | null>(null)
  const space = useRef(false)
  useEffect(() => {
    const box = boxRef.current!
    const centre = () => {
      const r = box.getBoundingClientRect()
      return hovering.current ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }
    // A trackpad pinch is a wheel event with ctrlKey set; ⌘/Ctrl + wheel zooms too, and the plain wheel pans once zoomed in.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        zoomRef.current(wheelFactor(e.deltaY, e.deltaMode), e.clientX, e.clientY)
      } else {
        e.preventDefault()
        setView((v) => (v.k === 1 ? v : fitView({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY })))
      }
    }
    // Safari reports trackpad pinches as gesture events.
    type Gesture = UIEvent & { scale: number; clientX: number; clientY: number }
    let last = 1
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      last = 1
    }
    const onGestureChange = (e: Event) => {
      const g = e as Gesture
      e.preventDefault()
      zoomRef.current(g.scale / last, g.clientX, g.clientY)
      last = g.scale
    }
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && hovering.current && !typing(e.target)) {
        e.preventDefault()
        space.current = true
        return
      }
      // ⌘/Ctrl + = − 0 while the pointer is over the image.
      if (!(e.metaKey || e.ctrlKey) || e.altKey || !hovering.current) return
      const at = centre()
      if (e.key === '=' || e.key === '+') zoomRef.current(ZOOM_STEP, at.x, at.y)
      else if (e.key === '-' || e.key === '_') zoomRef.current(1 / ZOOM_STEP, at.x, at.y)
      else if (e.key === '0') setView(FIT)
      else return
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    box.addEventListener('gesturestart', onGestureStart)
    box.addEventListener('gesturechange', onGestureChange)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      box.removeEventListener('wheel', onWheel)
      box.removeEventListener('gesturestart', onGestureStart)
      box.removeEventListener('gesturechange', onGestureChange)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
    // Attached once: fitView reads geo, a ref, and the rest are refs or state setters.
  }, [])

  // On-screen size of the image now, for handles and the like that stay the same size on screen.
  const sw = w * view.k
  const sh = h * view.k

  /** Pointer position in fractions of the image. */
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = overlayRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const drag = useRef<Drag | null>(null)
  const [line, setLine] = useState<{ a: Pt; b: Pt } | null>(null)
  const [cursor, setCursor] = useState<Pt | null>(null)
  const minW = MIN_CROP_PX / img.width
  const minH = MIN_CROP_PX / img.height

  // ---- Strokes --------------------------------------------------------------------
  const stroke = useRef<Stroke | null>(null)
  const addPoint = (s: Stroke, pt: Pt, pressure: number) => {
    const n = s.op.points.length
    if (n >= MAX_STROKE_POINTS * 3) return
    // Stored rounded, and drawn from the stored numbers, so the replay matches to the pixel.
    const x = round(clamp(pt.x, -0.5, 1.5), 5)
    const y = round(clamp(pt.y, -0.5, 1.5), 5)
    const pr = round(pressure, 2)
    const d = dabAt(s.base, s.op, x, y, pr)
    // Points closer than a tenth of the brush add nothing but storage.
    if (s.last && Math.hypot(d.x - s.last.x, d.y - s.last.y) < Math.max(0.75, d.r * 0.1)) return
    s.op.points.push(x, y, pr)
    const r = stampSegment(s.mask, s.base.width, s.base.height, s.last, d, s.op.hardness)
    s.last = d
    if (!r) return
    composite(s.out, s.base.rgba, s.mask, s.base.width, s.colour, r)
    canvasRef.current?.getContext('2d')!.putImageData(s.data, 0, 0, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0)
  }
  const startStroke = (pt: Pt, pressure: number) => {
    const t = p.tool as 'brush' | 'eraser'
    const op: Paint = {
      kind: 'paint',
      tool: t,
      ...(t === 'brush' ? { color: p.brush.color.toLowerCase() } : {}),
      size: round(Math.min(1, p.brush.size / Math.max(img.width, img.height)), 6),
      hardness: round(p.brush.hardness, 2),
      points: [],
    }
    const out = img.rgba.slice()
    const s: Stroke = { op, base: img, mask: new Uint8Array(img.width * img.height), out, data: new ImageData(out as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), colour: strokeColour(img, op), last: null }
    stroke.current = s
    addPoint(s, pt, pressure)
  }
  const cancelStroke = () => {
    if (!stroke.current) return
    stroke.current = null
    draw(img)
  }
  const pressureOf = (e: { pointerType: string; pressure: number }) => (e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 1)

  // ---- Pointers -------------------------------------------------------------------
  // Touches down, for a two-finger pinch; the pinch's start; and whether the rest of this touch is spent (a pinch ended).
  const touches = useRef(new Map<number, Pt>())
  const pinch = useRef<null | { d: number; m: Pt; view: View }>(null)
  const spent = useRef(false)
  const pair = () => {
    const [a, b] = [...touches.current.values()]
    return { d: Math.hypot(b.x - a.x, b.y - a.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }

  /** The zoom buttons and the brush bar sit over the canvas: their clicks are theirs. */
  const onControls = (e: { target: EventTarget }) => e.target instanceof Element && !!e.target.closest('[data-clean-controls]')
  const capture = (e: RPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // A pointer that's already gone: nothing to hold.
    }
  }
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (onControls(e)) return
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size >= 2) {
        // A second finger: whatever the first began is dropped, and the two pinch and pan.
        cancelStroke()
        drag.current = null
        setLine(null)
        capture(e)
        if (touches.current.size === 2) pinch.current = { ...pair(), view }
        spent.current = true
        return
      }
      spent.current = false
    }
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault()
      capture(e)
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, view }
      return
    }
    if (p.showOriginal || e.button !== 0) return
    const pt = at(e)
    if (isPaintTool(p.tool) && (p.picking || e.altKey)) return p.onPick(pixelHex(img, pt.x, pt.y))
    capture(e)
    if (isPaintTool(p.tool)) return startStroke(pt, pressureOf(e))
    if (p.tool === 'straighten') {
      drag.current = { kind: 'line', start: pt }
      setLine({ a: pt, b: pt })
      return
    }
    const d = p.draft
    if (d) {
      // A handle: which edges it moves, -1 for left/top, 1 for right/bottom, 0 for neither.
      const tolX = HANDLE_PX / sw
      const tolY = HANDLE_PX / sh
      const hx = Math.abs(pt.x - d.x) < tolX ? -1 : Math.abs(pt.x - (d.x + d.width)) < tolX ? 1 : 0
      const hy = Math.abs(pt.y - d.y) < tolY ? -1 : Math.abs(pt.y - (d.y + d.height)) < tolY ? 1 : 0
      const within = pt.x > d.x - tolX && pt.x < d.x + d.width + tolX && pt.y > d.y - tolY && pt.y < d.y + d.height + tolY
      if (within && (hx || hy)) return void (drag.current = { kind: 'resize', start: pt, from: d, hx, hy })
      if (within) return void (drag.current = { kind: 'move', start: pt, from: d, hx: 0, hy: 0 })
    }
    drag.current = { kind: 'new', start: pt, from: null, hx: 0, hy: 0 }
  }
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    hovering.current = { x: e.clientX, y: e.clientY }
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const start = pinch.current
      if (start && touches.current.size >= 2) {
        const now = pair()
        zoomAt(now.d / Math.max(1, start.d), start.m.x, start.m.y, start.view, now.m)
        return
      }
      if (spent.current) return
    }
    const pt = at(e)
    if (isPaintTool(p.tool) && e.pointerType !== 'touch') setCursor(onControls(e) ? null : pt)
    const s = stroke.current
    if (s) {
      // Every sample since the last event, so a fast stroke keeps its shape.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? []
      for (const c of events.length ? events : [e.nativeEvent]) addPoint(s, at(c), pressureOf(c))
      return
    }
    const g = drag.current
    if (!g) return
    if (g.kind === 'pan') return setView(fitView({ ...g.view, tx: g.view.tx + e.clientX - g.x, ty: g.view.ty + e.clientY - g.y }))
    if (g.kind === 'line') return setLine({ a: g.start, b: pt })
    if (g.kind === 'new') {
      const x0 = clamp01(Math.min(g.start.x, pt.x))
      const y0 = clamp01(Math.min(g.start.y, pt.y))
      const x1 = clamp01(Math.max(g.start.x, pt.x))
      const y1 = clamp01(Math.max(g.start.y, pt.y))
      if (x1 - x0 >= minW && y1 - y0 >= minH) p.onDraft({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
      return
    }
    const d = g.from!
    const dx = pt.x - g.start.x
    const dy = pt.y - g.start.y
    if (g.kind === 'move') {
      p.onDraft({ ...d, x: Math.min(1 - d.width, Math.max(0, d.x + dx)), y: Math.min(1 - d.height, Math.max(0, d.y + dy)) })
      return
    }
    let { x, y } = d
    let x2 = d.x + d.width
    let y2 = d.y + d.height
    if (g.hx < 0) x = Math.min(x2 - minW, clamp01(d.x + dx))
    if (g.hx > 0) x2 = Math.max(x + minW, clamp01(x2 + dx))
    if (g.hy < 0) y = Math.min(y2 - minH, clamp01(d.y + dy))
    if (g.hy > 0) y2 = Math.max(y + minH, clamp01(y2 + dy))
    p.onDraft({ x, y, width: x2 - x, height: y2 - y })
  }
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId)
      if (touches.current.size < 2) pinch.current = null
      if (spent.current) return
    }
    const s = stroke.current
    if (s) {
      stroke.current = null
      if (e.type === 'pointercancel') draw(img)
      else if (s.op.points.length) {
        p.onStroke(s.op)
        // If the stroke wasn't kept (shape edits to confirm first), the canvas goes back to the image as it is.
        requestAnimationFrame(() => {
          if (!stroke.current && imgRef.current === s.base) draw(s.base)
        })
      }
      return
    }
    const g = drag.current
    drag.current = null
    if (g?.kind !== 'line' || !line) return
    setLine(null)
    if (e.type === 'pointercancel') return
    // In image pixels, so the angle is the image's, not the fitted box's.
    const a = { x: line.a.x * img.width, y: line.a.y * img.height }
    const b = { x: line.b.x * img.width, y: line.b.y * img.height }
    if (Math.hypot((line.b.x - line.a.x) * sw, (line.b.y - line.a.y) * sh) < 8) return
    const degrees = straightenAngle(a, b)
    if (Math.abs(degrees) >= 0.05) p.onStraighten(degrees)
  }

  const showOutline = !!p.outline && !p.showOriginal && sameGeometry(p.ops, p.traced)
  const d = p.tool === 'crop' ? p.draft : null
  const handles = d
    ? [-1, 0, 1].flatMap((hx) => [-1, 0, 1].filter((hy) => hx || hy).map((hy) => ({ x: d.x + ((hx + 1) / 2) * d.width, y: d.y + ((hy + 1) / 2) * d.height })))
    : []
  const paintTool = isPaintTool(p.tool) && !p.showOriginal
  const pixelScale = scale * view.k
  return (
    <div
      ref={boxRef}
      className={`mat absolute inset-0 z-[5] grid touch-none place-items-center overflow-hidden ${p.showOriginal ? '' : 'cursor-crosshair'}`}
      data-clean-canvas={`${img.width}x${img.height}`}
      data-clean-zoom={round(view.k, 2)}
      data-original={p.showOriginal ? '' : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onAuxClick={(e) => e.preventDefault()}
      onPointerLeave={() => {
        hovering.current = null
        setCursor(null)
      }}
    >
      <div className="relative" style={{ width: w, height: h, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.k})` }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
          style={pixelScale >= 2 ? { imageRendering: 'pixelated' } : undefined}
          aria-label={p.showOriginal ? 'The original image' : 'The cleaned image'}
          role="img"
        />
        {showOutline && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${p.outline!.width} ${p.outline!.height}`} preserveAspectRatio="none" aria-hidden="true">
            {p.outline!.paths.map((s) => (
              <path key={s.id} d={s.d} fill="none" stroke="var(--color-accent, #c2410c)" strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        <svg
          ref={overlayRef}
          className="absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          data-clean-overlay={p.tool}
          data-picking={p.picking ? '' : undefined}
        >
          {d && (
            <g data-crop-draft="">
              <path d={`M0 0H1V1H0Z M${d.x} ${d.y}V${d.y + d.height}H${d.x + d.width}V${d.y}Z`} fill="rgb(0 0 0 / 0.45)" fillRule="evenodd" />
              <rect x={d.x} y={d.y} width={d.width} height={d.height} fill="none" stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              {handles.map((hp, i) => (
                <rect key={i} x={hp.x - HANDLE_PX / 2 / sw} y={hp.y - HANDLE_PX / 2 / sh} width={HANDLE_PX / sw} height={HANDLE_PX / sh} fill="white" stroke="black" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {line && <line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
          {paintTool && cursor && !p.picking && (
            <g className="pointer-events-none" aria-hidden="true">
              {[
                ['black', 2],
                ['white', 1],
              ].map(([c, sw]) => (
                <ellipse key={c} cx={cursor.x} cy={cursor.y} rx={p.brush.size / 2 / img.width} ry={p.brush.size / 2 / img.height} fill="none" stroke={c as string} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
        </svg>
      </div>

      {/* Zoom: the buttons for a mouse without a wheel, and the way back to the whole image. */}
      <div data-clean-controls="" className="absolute top-2 right-2 z-10 flex items-center gap-px overflow-hidden rounded-md border border-rule bg-paper text-[12.5px] shadow-sm" role="group" aria-label="Zoom">
        <button className="grid h-7 w-7 place-items-center hover:bg-paper-2" onClick={() => zoomCentre(1 / ZOOM_STEP)} aria-label="Zoom out" disabled={view.k <= 1}>
          −
        </button>
        <span className="num w-12 text-center" data-clean-zoom-label="">
          {Math.round(pixelScale * 100)}%
        </span>
        <button className="grid h-7 w-7 place-items-center hover:bg-paper-2" onClick={() => zoomCentre(ZOOM_STEP)} aria-label="Zoom in" disabled={view.k >= maxK}>
          +
        </button>
        {view.k > 1 && (
          <button className="h-7 border-l border-rule px-2 hover:bg-paper-2" onClick={() => setView(FIT)}>
            Fit
          </button>
        )}
      </div>

      {/* On a phone the panel is below the fold, so the brush's settings ride along at the bottom of the canvas. */}
      {paintTool && (
        <div data-clean-controls="" className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-3 rounded-md border border-rule bg-paper px-3 py-1.5 text-[12.5px] shadow-md lg:hidden" data-brush-bar="">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0">Size</span>
            <input type="range" className="range min-w-0 flex-1" min={0} max={1} step={0.01} value={sizeToSlider(p.brush.size)} onChange={(e) => p.onBrush({ ...p.brush, size: sliderToSize(Number(e.target.value)) })} aria-label="Brush size" />
          </label>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0">Hard</span>
            <input type="range" className="range min-w-0 flex-1" min={0} max={100} step={5} value={Math.round(p.brush.hardness * 100)} onChange={(e) => p.onBrush({ ...p.brush, hardness: Number(e.target.value) / 100 })} aria-label="Brush hardness" />
          </label>
          {p.tool === 'brush' && (
            <input type="color" className="size-7 shrink-0 cursor-pointer rounded border border-rule" value={p.brush.color} onChange={(e) => p.onBrush({ ...p.brush, color: e.target.value })} aria-label="Brush colour" />
          )}
        </div>
      )}
    </div>
  )

  function zoomCentre(factor: number) {
    const r = boxRef.current!.getBoundingClientRect()
    zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2)
  }
}

/** The size slider runs on a log scale, so small brushes get as much travel as big ones. */
const sizeToSlider = (px: number) => Math.log(px / BRUSH_MIN) / Math.log(BRUSH_MAX / BRUSH_MIN)
const sliderToSize = (v: number) => Math.max(BRUSH_MIN, Math.round(BRUSH_MIN * (BRUSH_MAX / BRUSH_MIN) ** v))

export function CleanPanel(p: {
  source: Source
  ops: CleanupOp[]
  /** Change the list; edits sharing a key (one slider's drag) undo together. */
  onOps: (ops: CleanupOp[], key?: string) => void
  tool: CleanTool
  draft: CropDraft | null
  onDraft: (d: CropDraft | null) => void
  onApplyCrop: () => void
  showOriginal: boolean
  onShowOriginal: (on: boolean) => void
  /** The list differs from what was traced: leaving the mode re-traces. */
  pending: boolean
  onSave: (blob: Blob, name: string) => void
  brush: BrushSettings
  onBrush: (b: BrushSettings) => void
  /** The trace's inks, most used first: a stroke in one of them lands in that ink. */
  inks: Ink[]
  picking: boolean
  onPicking: (on: boolean) => void
}) {
  const size = useMemo(() => cleanedPixels(p.source, p.ops), [p.source, p.ops])
  const [angle, setAngle] = useState('')
  const seq = useRef(0)
  const levels = adjustmentOf(p.ops, 'levels')
  const threshold = adjustmentOf(p.ops, 'threshold')
  // One slider drag, one undo step: the key changes when the pointer lets go.
  const sliderKey = (name: string) => `${name}-${seq.current}`
  const endSlide = () => seq.current++
  const px = (f: number, n: number) => Math.round(f * n)

  return (
    <>
      <Section title={{ crop: 'Crop', straighten: 'Straighten', brush: 'Brush', eraser: 'Eraser' }[p.tool]}>
        {isPaintTool(p.tool) ? (
          <BrushFields {...p} tool={p.tool} background={backgroundOf(size)} />
        ) : p.tool === 'crop' ? (
          <div className="space-y-2">
            <p className="field-hint">Drag a box on the image; drag its edges or corners to adjust. Cutting away borders and watermarks also makes the trace quicker.</p>
            {p.draft && (
              <>
                <div className="grid grid-cols-2 gap-2" data-crop-fields="">
                  {(
                    [
                      ['X', 'x', size.width],
                      ['Y', 'y', size.height],
                      ['W', 'width', size.width],
                      ['H', 'height', size.height],
                    ] as const
                  ).map(([label, k, n]) => (
                    <label key={k} className="flex items-center gap-2">
                      <span className="field-label w-3 shrink-0">{label}</span>
                      <input
                        type="number"
                        aria-label={`Crop ${{ x: 'left', y: 'top', width: 'width', height: 'height' }[k]}`}
                        className="w-full min-w-0 rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[13px]"
                        value={px(p.draft![k], n)}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          if (!Number.isFinite(v)) return
                          const d = { ...p.draft! }
                          const f = Math.max(0, v) / n
                          if (k === 'x') d.x = Math.min(f, 1 - d.width)
                          else if (k === 'y') d.y = Math.min(f, 1 - d.height)
                          else if (k === 'width') d.width = Math.min(Math.max(f, MIN_CROP_PX / n), 1 - d.x)
                          else d.height = Math.min(Math.max(f, MIN_CROP_PX / n), 1 - d.y)
                          p.onDraft(d)
                        }}
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn btn-primary" onClick={p.onApplyCrop}>
                    Crop
                  </button>
                  <button className="btn" onClick={() => p.onDraft(null)}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <p className="field-hint">Drag along a line in the image that should be level or upright, such as a horizon, a border or a column of text. The image turns to match.</p>
        )}
      </Section>

      <Section title="Rotate and flip">
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-1" role="group" aria-label="Rotate and flip">
            <button className="btn h-8 px-1 text-[12px]" onClick={() => p.onOps(addOp(p.ops, { kind: 'rotate', degrees: -90 }))} title="Rotate a quarter turn anticlockwise">
              ⟲ 90°
            </button>
            <button className="btn h-8 px-1 text-[12px]" onClick={() => p.onOps(addOp(p.ops, { kind: 'rotate', degrees: 90 }))} title="Rotate a quarter turn clockwise">
              ⟳ 90°
            </button>
            <button className="btn h-8 px-1 text-[12px]" onClick={() => p.onOps(addOp(p.ops, { kind: 'flip', axis: 'horizontal' }))} title="Flip left to right">
              Flip ↔
            </button>
            <button className="btn h-8 px-1 text-[12px]" onClick={() => p.onOps(addOp(p.ops, { kind: 'flip', axis: 'vertical' }))} title="Flip top to bottom">
              Flip ↕
            </button>
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const v = Number(angle)
              if (angle.trim() && Number.isFinite(v) && Math.abs(v) <= 360) p.onOps(addOp(p.ops, { kind: 'rotate', degrees: v }))
              setAngle('')
            }}
          >
            <input
              type="number"
              step="any"
              aria-label="Rotate by degrees, clockwise"
              placeholder="Angle, °"
              className="w-full min-w-0 rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[13px]"
              value={angle}
              onChange={(e) => setAngle(e.target.value)}
            />
            <button className="btn h-8 shrink-0 px-3 text-[12.5px]" type="submit">
              Rotate
            </button>
          </form>
        </div>
      </Section>

      <Section
        title="Levels"
        action={
          levels && (
            <button className="text-[12.5px] text-ink-muted hover:text-ink" onClick={() => p.onOps(setAdjustment(p.ops, 'levels', null))}>
              Reset
            </button>
          )
        }
      >
        <div className="space-y-3" onPointerUp={endSlide} onKeyUp={endSlide}>
          {(
            [
              ['black', 'Black point', 0, 254, 'Everything this dark or darker becomes black: faded ink comes back.'],
              ['white', 'White point', 1, 255, 'Everything this light or lighter becomes white: grey paper turns clean white.'],
            ] as const
          ).map(([k, label, min, max, hint]) => {
            const l = levels ?? LEVELS_DEFAULT
            return (
              <Slider
                key={k}
                label={label}
                value={l[k]}
                min={min}
                max={max}
                step={1}
                hint={hint}
                format={String}
                onChange={(v) => {
                  const next = { ...l, [k]: v }
                  if (next.black >= next.white) return
                  p.onOps(setAdjustment(p.ops, 'levels', next), sliderKey(k))
                }}
              />
            )
          })}
          <Slider
            label="Midtones"
            value={Math.log2((levels ?? LEVELS_DEFAULT).gamma)}
            min={-2}
            max={2}
            step={0.05}
            hint="Brighten or darken the middle greys without moving black or white."
            format={(v) => (2 ** v).toFixed(2)}
            onChange={(v) => p.onOps(setAdjustment(p.ops, 'levels', { ...(levels ?? LEVELS_DEFAULT), gamma: Math.round(2 ** v * 100) / 100 }), sliderKey('gamma'))}
          />
        </div>
      </Section>

      <Section title="Threshold">
        <div className="space-y-3" onPointerUp={endSlide} onKeyUp={endSlide}>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={!!threshold} onChange={(e) => p.onOps(setAdjustment(p.ops, 'threshold', e.target.checked ? THRESHOLD_DEFAULT : null))} />
            Black and white only
          </label>
          {threshold && (
            <Slider
              label="Level"
              value={threshold.level}
              min={1}
              max={255}
              step={1}
              hint="Lighter than this turns white, darker turns black. The one-click fix for line art."
              format={String}
              onChange={(v) => p.onOps(setAdjustment(p.ops, 'threshold', { kind: 'threshold', level: v }), sliderKey('threshold'))}
            />
          )}
        </div>
      </Section>

      <Section title="Cleaned image">
        <div className="space-y-2">
          <p className="field-hint" data-clean-size="">
            {size.width} × {size.height} px.{' '}
            {p.pending ? 'Leaving Clean up traces the cleaned image.' : p.ops.length ? 'This is what’s traced.' : 'No changes yet: the original is traced.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn" aria-pressed={p.showOriginal} onClick={() => p.onShowOriginal(!p.showOriginal)} title="Compare with the image as you opened it">
              {p.showOriginal ? 'Show cleaned' : 'Show original'}
            </button>
            <button
              className="btn"
              onClick={async () => p.onSave(await pngOf(cleanedPixels(p.source, p.ops)), `${p.source.name}-cleaned.png`)}
            >
              Download PNG
            </button>
          </div>
          {p.ops.length > 0 && (
            <button className="btn w-full" onClick={() => p.onOps([])}>
              Undo all clean-up
            </button>
          )}
        </div>
      </Section>
    </>
  )
}

function BrushFields(p: {
  tool: 'brush' | 'eraser'
  brush: BrushSettings
  onBrush: (b: BrushSettings) => void
  inks: Ink[]
  picking: boolean
  onPicking: (on: boolean) => void
  background: [number, number, number, number]
}) {
  const b = p.brush
  const bg = p.background[3] ? `#${p.background.slice(0, 3).map(hex2).join('')}` : null
  const swatches = [...new Set(p.inks.map((i) => i.hex.toLowerCase()))].slice(0, 16)
  return (
    <div className="space-y-3" data-brush-fields={p.tool}>
      <p className="field-hint">
        {p.tool === 'brush'
          ? 'Paint over gaps in an outline, holes in a fill or a broken letter. Alt-click the image to pick its colour. A pen’s pressure sets the width.'
          : bg
            ? `Paints the background colour, ${bg}, so stray marks, dust and signatures trace as nothing.`
            : 'Paints the background, which is transparent here, so stray marks trace as nothing.'}
      </p>
      <Slider label="Size" value={sizeToSlider(b.size)} min={0} max={1} step={0.005} hint="[ and ] make it smaller and bigger." format={() => `${b.size} px`} onChange={(v) => p.onBrush({ ...b, size: sliderToSize(v) })} />
      <Slider
        label="Hardness"
        value={Math.round(b.hardness * 100)}
        min={0}
        max={100}
        step={5}
        hint="Hard for a crisp edge that joins an outline; soft to even out a blotchy fill. Shift + [ and ] change it."
        format={(v) => `${v}%`}
        onChange={(v) => p.onBrush({ ...b, hardness: v / 100 })}
      />
      {p.tool === 'brush' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input type="color" className="size-8 shrink-0 cursor-pointer rounded border border-rule" value={b.color} onChange={(e) => p.onBrush({ ...b, color: e.target.value })} aria-label="Brush colour" />
            <span className="num grow text-[13px]" data-brush-colour="">
              {b.color}
            </span>
            <button className="btn h-8 px-3 text-[12.5px]" aria-pressed={p.picking} onClick={() => p.onPicking(!p.picking)}>
              {p.picking ? 'Click the image…' : 'Pick from image'}
            </button>
          </div>
          {swatches.length > 0 && (
            <div>
              <p className="field-label mb-1">The trace’s colours</p>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Brush colour from the trace">
                {swatches.map((hex) => (
                  <button
                    key={hex}
                    className={`size-6 rounded border ${hex === b.color.toLowerCase() ? 'border-ink ring-1 ring-ink' : 'border-rule'}`}
                    style={{ background: hex }}
                    title={hex}
                    aria-label={`Paint in ${hex}`}
                    aria-pressed={hex === b.color.toLowerCase()}
                    onClick={() => p.onBrush({ ...b, color: hex })}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
