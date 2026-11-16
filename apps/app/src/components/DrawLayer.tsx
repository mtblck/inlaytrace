/**
 * The Pen and the Shape tool on the canvas (#210): a transparent sheet over
 * the drawing that turns pointer drags into a path, previewed as you go, and
 * hands the finished path data to `onDrawn`. The geometry is lib/draw.ts.
 */
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { penDrag, penPath, shapePath, type PenNode, type ShapeSettings } from '../lib/draw'
import type { Pt } from '../lib/pathdata'

type Props = {
  tool: 'pen' | 'shape'
  width: number
  height: number
  /** SVG units per screen pixel. */
  unit: number
  toSvg: (e: { clientX: number; clientY: number }) => Pt | null
  shape: ShapeSettings
  colour: string
  /** A line's width, in SVG units. */
  strokeWidth: number
  /** A finished path: `open` ones are lines (a stroke), closed ones are filled. */
  onDrawn: (d: string, open: boolean) => void
}

/** On-screen pixels: how near the first node a click closes the path, and how far a press must move to be a drag. */
const CLOSE_PX = 8
const DRAG_PX = 3
const NODE_PX = 7

type Press = { at: Pt; client: Pt; to: Pt | null }

export function DrawLayer(p: Props) {
  const [nodes, setNodes] = useState<PenNode[]>([])
  const [press, setPress] = useState<Press | null>(null)
  const [hover, setHover] = useState<Pt | null>(null)
  const [mods, setMods] = useState({ shift: false, alt: false })
  const live = useRef({ nodes, p })
  live.current = { nodes, p }

  // A tool change drops a half-drawn path.
  useEffect(() => {
    setNodes([])
    setPress(null)
  }, [p.tool])

  // While the Pen has nodes down, Enter or Esc ends the path as a line and
  // Backspace takes back the last node; the app's own keys wait till it's done.
  const penActive = p.tool === 'pen' && nodes.length > 0
  useEffect(() => {
    if (!penActive) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      const { nodes, p } = live.current
      if (e.key === 'Enter' || e.key === 'Escape') {
        if (nodes.length >= 2) p.onDrawn(penPath(nodes, false), true)
        setNodes([])
      } else if (e.key === 'Backspace' || e.key === 'Delete') setNodes(nodes.slice(0, -1))
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [penActive])

  // ⇧ and ⌥ change a shape mid-drag without the pointer moving.
  const shaping = p.tool === 'shape' && !!press
  useEffect(() => {
    if (!shaping) return
    const onKey = (e: KeyboardEvent) => setMods({ shift: e.shiftKey, alt: e.altKey })
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [shaping])

  const nearFirst = (q: Pt | null) => !!q && nodes.length >= 2 && Math.hypot(q.x - nodes[0].x, q.y - nodes[0].y) <= CLOSE_PX * p.unit
  const canClose = nodes.length >= 3 || nodes.some((n) => n.out)

  const onDown = (e: RPointerEvent<SVGRectElement>) => {
    // Left button (or a touch or pen) only: a right-click is for the menu, a middle-drag pans.
    if (e.button !== 0) return
    const at = p.toSvg(e)
    if (!at) return
    e.stopPropagation()
    e.preventDefault()
    // preventDefault keeps focus where it was: take it off a panel field, so Enter and Esc reach the Pen.
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('input, select, textarea')) document.activeElement.blur()
    if (p.tool === 'pen' && nearFirst(at) && canClose) {
      p.onDrawn(penPath(nodes, true), false)
      setNodes([])
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    setMods({ shift: e.shiftKey, alt: e.altKey })
    setPress({ at, client: { x: e.clientX, y: e.clientY }, to: null })
  }
  const onMove = (e: RPointerEvent<SVGRectElement>) => {
    const q = p.toSvg(e)
    setHover(q)
    if (!press || !q) return
    setMods({ shift: e.shiftKey, alt: e.altKey })
    if (press.to || Math.hypot(e.clientX - press.client.x, e.clientY - press.client.y) >= DRAG_PX) setPress({ ...press, to: q })
  }
  const onUp = (e: RPointerEvent<SVGRectElement>) => {
    if (!press) return
    setPress(null)
    if (e.type === 'pointercancel') return
    if (p.tool === 'pen') setNodes([...nodes, press.to ? penDrag(press.at, press.to) : { x: press.at.x, y: press.at.y, out: null }])
    else if (press.to) {
      const d = shapePath(p.shape, press.at, press.to, { shift: e.shiftKey, alt: e.altKey, min: 2 * p.unit })
      if (d) p.onDrawn(d, p.shape.kind === 'line')
    }
  }

  // ---- Preview -------------------------------------------------------------------------
  let preview: { d: string; open: boolean } | null = null
  if (p.tool === 'shape' && press?.to) {
    const d = shapePath(p.shape, press.at, press.to, { ...mods, min: 0 })
    if (d) preview = { d, open: p.shape.kind === 'line' }
  } else if (p.tool === 'pen' && nodes.length + (press ? 1 : 0) > 0) {
    // The nodes so far, the one being placed, and a rubber band to the pointer.
    const placing = press ? [press.to ? penDrag(press.at, press.to) : { x: press.at.x, y: press.at.y, out: null }] : []
    const next = !press && hover ? [nearFirst(hover) && canClose ? { ...nodes[0], out: null } : { x: hover.x, y: hover.y, out: null }] : []
    const all = [...nodes, ...placing, ...next]
    if (all.length >= 2) preview = { d: penPath(all, false), open: true }
  }
  const handle = p.tool === 'pen' && press?.to ? { a: { x: 2 * press.at.x - press.to.x, y: 2 * press.at.y - press.to.y }, b: press.to } : null
  const s = NODE_PX * p.unit

  return (
    <g data-draw={p.tool}>
      {preview && (
        <path
          d={preview.d}
          fill={preview.open ? 'none' : p.colour}
          fillOpacity={0.6}
          stroke={preview.open ? p.colour : 'none'}
          strokeWidth={p.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}
      {preview && <path d={preview.d} fill="none" stroke="var(--c-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" data-draw-preview="" />}
      {handle && (
        <g pointerEvents="none">
          <line x1={handle.a.x} y1={handle.a.y} x2={handle.b.x} y2={handle.b.y} stroke="var(--c-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={handle.a.x} cy={handle.a.y} r={3 * p.unit} fill="var(--c-accent)" />
          <circle cx={handle.b.x} cy={handle.b.y} r={3 * p.unit} fill="var(--c-accent)" />
        </g>
      )}
      {nodes.map((n, i) => (
        <rect
          key={i}
          x={n.x - s / 2}
          y={n.y - s / 2}
          width={s}
          height={s}
          fill={i === 0 && nearFirst(hover) && canClose ? 'var(--c-accent)' : 'white'}
          stroke="var(--c-accent)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
          data-pen-node=""
        />
      ))}
      <rect
        width={p.width}
        height={p.height}
        fill="transparent"
        style={{ cursor: p.tool === 'pen' && nearFirst(hover) && canClose ? 'pointer' : 'crosshair', touchAction: 'none' }}
        data-draw-target=""
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setHover(null)}
      />
    </g>
  )
}
