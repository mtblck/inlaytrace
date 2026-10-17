import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react'
import type { Axis } from '../lib/mirror'
import { parsePath, type NodePart, type NodeRef, type Pt, type Subpath } from '../lib/pathdata'

export type ViewMode = 'split' | 'difference' | 'vector'
export type Tool = 'select' | 'mirror'
export type Overlays = { paths: boolean; pathColor: string; nodes: boolean; nodeColor: string }
export type ShownPath = { id: string; d: string; fill: string }

type Props = {
  imageUrl: string
  paths: ShownPath[]
  width: number
  height: number
  mode: ViewMode
  zoom: number
  tool: Tool
  overlays: Overlays
  selectedId: string | null
  selectedNode: NodeRef | null
  axis: Axis | null
  onSelect: (id: string | null) => void
  onSelectNode: (ref: NodeRef | null) => void
  /** Called on every pointer move while dragging a node or handle; `end` on release. */
  onDragNode: (ref: NodeRef, part: NodePart, to: Pt, phase: 'move' | 'end') => void
  onAxis: (position: number) => void
}

// On-screen sizes, constant at every zoom: divided by the sheet's scale to get
// SVG units, so a node is always a 7 px square and a handle a 3 px dot.
const NODE_PX = 7
const HANDLE_PX = 3
const HIT_PX = 10

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
  const [split, setSplit] = useState(50)
  const drag = useRef<null | { kind: 'split' } | { kind: 'node'; ref: NodeRef; part: NodePart } | { kind: 'axis' }>(null)

  useLayoutEffect(() => {
    const mat = matRef.current
    if (!mat) return
    const measure = () => {
      const pad = 32
      const availW = Math.max(0, mat.clientWidth - pad * 2)
      const availH = Math.max(0, mat.clientHeight - pad * 2)
      const scale = Math.min(availW / width, availH / height)
      setFit({ w: Math.floor(width * scale), h: Math.floor(height * scale) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(mat)
    return () => ro.disconnect()
  }, [width, height])

  const w = fit.w * zoom
  const h = fit.h * zoom
  // SVG units per screen pixel.
  const unit = w > 0 ? width / w : 1

  /** Screen → SVG coordinates, through the overlay's own transform, so zoom and scroll never matter. */
  const toSvg = useCallback((e: { clientX: number; clientY: number }): Pt | null => {
    const svg = overlayRef.current
    const m = svg?.getScreenCTM()
    if (!svg || !m) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return { x: p.x, y: p.y }
  }, [])

  const selected = useMemo(() => props.paths.find((p) => p.id === props.selectedId) ?? null, [props.paths, props.selectedId])
  const selectedSubs = useMemo<Subpath[]>(() => (selected ? parsePath(selected.d) : []), [selected])
  const allNodes = useMemo(
    () => (overlays.nodes ? props.paths.flatMap((p) => parsePath(p.d).flatMap((s) => s.nodes)) : []),
    [overlays.nodes, props.paths],
  )

  // ---- Pointer handling ----------------------------------------------------
  const onMove = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'split') {
      const rect = e.currentTarget.getBoundingClientRect()
      setSplit(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)))
      return
    }
    const p = toSvg(e)
    if (!p) return
    if (d.kind === 'node') props.onDragNode(d.ref, d.part, p, 'move')
    else props.onAxis(clampAxis(props.axis!, p, width, height))
  }
  const onUp = (e: RPointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'node') {
      const p = toSvg(e)
      if (p) props.onDragNode(d.ref, d.part, p, 'end')
    }
  }
  const startDrag = (e: RPointerEvent, next: NonNullable<typeof drag.current>) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = next
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
  }

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
    <div ref={matRef} className="mat absolute inset-0 overflow-auto">
      <div className="grid min-h-full min-w-full place-items-center p-8" style={{ width: zoom > 1 ? w + 64 : undefined }}>
        <div
          className="checker relative shadow-[0_0_0_1px_var(--c-rule)] select-none"
          style={{ width: w, height: h, touchAction: 'none' }}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {mode !== 'vector' && (
            <img
              src={props.imageUrl}
              alt="Original image"
              draggable={false}
              className="absolute inset-0 h-full w-full"
              style={{ imageRendering: zoom >= 3 ? 'pixelated' : undefined }}
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
            {props.paths.map((p) => (
              <path key={p.id} d={p.d} fill={p.fill} />
            ))}
          </svg>

          {/* Everything interactive or editorial. Never exported. */}
          <svg
            ref={overlayRef}
            className="absolute inset-0 h-full w-full"
            viewBox={vectorBox}
            preserveAspectRatio="none"
            onPointerDown={(e) => {
              // A click on empty canvas clears the selection.
              if (tool === 'select' && e.target === e.currentTarget) props.onSelect(null)
            }}
          >
            {tool === 'select' &&
              props.paths.map((p) => (
                <path
                  key={p.id}
                  d={p.d}
                  fill="transparent"
                  pointerEvents="fill"
                  data-path-id={p.id}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    props.onSelect(p.id)
                  }}
                />
              ))}

            {overlays.paths && (
              <g fill="none" stroke={overlays.pathColor} strokeWidth={1} pointerEvents="none">
                {props.paths.map((p) => (
                  <path key={p.id} d={p.d} vectorEffect="non-scaling-stroke" />
                ))}
              </g>
            )}

            {overlays.nodes && (
              <g fill={overlays.nodeColor} pointerEvents="none" data-overlay="nodes">
                {allNodes.map((n, i) => (
                  <rect key={i} x={n.x - (NODE_PX * unit) / 2} y={n.y - (NODE_PX * unit) / 2} width={NODE_PX * unit} height={NODE_PX * unit} opacity={0.9} />
                ))}
              </g>
            )}

            {selected && (
              <g data-selected={selected.id}>
                <path d={selected.d} fill="none" stroke="var(--c-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {selectedSubs.map((s, si) =>
                  s.nodes.map((n, ni) => {
                    const ref = { sub: si, index: ni }
                    const isSel = props.selectedNode?.sub === si && props.selectedNode.index === ni
                    return (
                      <g key={`${si}-${ni}`}>
                        {(['in', 'out'] as const).map((part) => {
                          const hnd = n[part]
                          if (!hnd) return null
                          return (
                            <g key={part}>
                              <line x1={n.x} y1={n.y} x2={hnd.x} y2={hnd.y} stroke="var(--c-accent)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                              <circle
                                cx={hnd.x}
                                cy={hnd.y}
                                r={HANDLE_PX * unit}
                                fill="var(--c-paper)"
                                stroke="var(--c-accent)"
                                strokeWidth={1}
                                vectorEffect="non-scaling-stroke"
                                data-handle={`${si}:${ni}:${part}`}
                                style={{ cursor: 'grab' }}
                                onPointerDown={(e) => {
                                  props.onSelectNode(ref)
                                  startDrag(e, { kind: 'node', ref, part })
                                }}
                              />
                              {/* A larger invisible target, so a 3 px dot is easy to grab. */}
                              <circle cx={hnd.x} cy={hnd.y} r={HIT_PX * unit} fill="transparent" onPointerDown={(e) => { props.onSelectNode(ref); startDrag(e, { kind: 'node', ref, part }) }} style={{ cursor: 'grab' }} />
                            </g>
                          )
                        })}
                        <rect
                          x={n.x - (NODE_PX * unit) / 2}
                          y={n.y - (NODE_PX * unit) / 2}
                          width={NODE_PX * unit}
                          height={NODE_PX * unit}
                          fill={isSel ? 'var(--c-accent)' : 'var(--c-paper)'}
                          stroke="var(--c-accent)"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          data-node={`${si}:${ni}`}
                          style={{ cursor: 'move' }}
                          onPointerDown={(e) => {
                            props.onSelectNode(ref)
                            startDrag(e, { kind: 'node', ref, part: 'anchor' })
                          }}
                        />
                      </g>
                    )
                  }),
                )}
              </g>
            )}

            {tool === 'mirror' && props.axis && <AxisOverlay axis={props.axis} width={width} height={height} unit={unit} onGrab={(e) => startDrag(e, { kind: 'axis' })} />}
          </svg>

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
              style={{ left: `${split}%` }}
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
