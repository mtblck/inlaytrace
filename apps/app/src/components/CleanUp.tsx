/**
 * Clean up mode (#199): the canvas and panel for editing the image before it
 * is traced. Loaded only when the mode is first opened (App lazy-loads this
 * module), with the replay it uses.
 *
 * The canvas shows the cleaned image, replayed from the list on every change,
 * with the current trace as a faint outline while its geometry still matches.
 * Crop draws a box (handles to adjust, Enter or the panel to apply);
 * Straighten draws a line along something that should be level or upright.
 * The panel holds the rest: quarter turns, an angle, flips, levels, threshold,
 * before and after, and the cleaned PNG.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { addOp, adjustmentOf, LEVELS_DEFAULT, MIN_CROP_PX, sameGeometry, setAdjustment, straightenAngle, THRESHOLD_DEFAULT, type CleanupOp, type Img } from '../lib/cleanup'
import { cleanedPixels, originalPixels, pngOf } from '../lib/cleanupRun'
import type { ShownPath } from '../lib/doc'
import type { Source } from '../lib/image'
import { Section, Slider } from './Controls'

export type CleanTool = 'crop' | 'straighten'
/** A crop box being drawn, in fractions of the cleaned image. */
export type CropDraft = { x: number; y: number; width: number; height: number }

type Pt = { x: number; y: number }
const HANDLE_PX = 9
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

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

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    c.width = img.width
    c.height = img.height
    c.getContext('2d')!.putImageData(new ImageData(img.rgba as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0)
  }, [img])

  const scale = room.w && room.h ? Math.min(room.w / img.width, room.h / img.height) : 0
  const w = img.width * scale
  const h = img.height * scale

  /** Pointer position in fractions of the image. */
  const at = (e: { clientX: number; clientY: number }): Pt => {
    const r = overlayRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  const drag = useRef<null | { kind: 'new' | 'move' | 'resize' | 'line'; start: Pt; from: CropDraft | null; hx: number; hy: number }>(null)
  const [line, setLine] = useState<{ a: Pt; b: Pt } | null>(null)
  const minW = MIN_CROP_PX / img.width
  const minH = MIN_CROP_PX / img.height

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (p.showOriginal || e.button !== 0) return
    const pt = at(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (p.tool === 'straighten') {
      drag.current = { kind: 'line', start: pt, from: null, hx: 0, hy: 0 }
      setLine({ a: pt, b: pt })
      return
    }
    const d = p.draft
    if (d) {
      // A handle: which edges it moves, -1 for left/top, 1 for right/bottom, 0 for neither.
      const tolX = HANDLE_PX / w
      const tolY = HANDLE_PX / h
      const hx = Math.abs(pt.x - d.x) < tolX ? -1 : Math.abs(pt.x - (d.x + d.width)) < tolX ? 1 : 0
      const hy = Math.abs(pt.y - d.y) < tolY ? -1 : Math.abs(pt.y - (d.y + d.height)) < tolY ? 1 : 0
      const within = pt.x > d.x - tolX && pt.x < d.x + d.width + tolX && pt.y > d.y - tolY && pt.y < d.y + d.height + tolY
      if (within && (hx || hy)) return void (drag.current = { kind: 'resize', start: pt, from: d, hx, hy })
      if (within) return void (drag.current = { kind: 'move', start: pt, from: d, hx: 0, hy: 0 })
    }
    drag.current = { kind: 'new', start: pt, from: null, hx: 0, hy: 0 }
  }
  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const g = drag.current
    if (!g) return
    const pt = at(e)
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
  const onUp = () => {
    const g = drag.current
    drag.current = null
    if (g?.kind !== 'line' || !line) return
    setLine(null)
    // In image pixels, so the angle is the image's, not the fitted box's.
    const a = { x: line.a.x * img.width, y: line.a.y * img.height }
    const b = { x: line.b.x * img.width, y: line.b.y * img.height }
    if (Math.hypot((line.b.x - line.a.x) * w, (line.b.y - line.a.y) * h) < 8) return
    const degrees = straightenAngle(a, b)
    if (Math.abs(degrees) >= 0.05) p.onStraighten(degrees)
  }

  const showOutline = !!p.outline && !p.showOriginal && sameGeometry(p.ops, p.traced)
  const d = p.tool === 'crop' ? p.draft : null
  const handles = d
    ? [-1, 0, 1].flatMap((hx) => [-1, 0, 1].filter((hy) => hx || hy).map((hy) => ({ x: d.x + ((hx + 1) / 2) * d.width, y: d.y + ((hy + 1) / 2) * d.height })))
    : []
  return (
    <div ref={boxRef} className="mat absolute inset-0 z-[5] grid place-items-center overflow-hidden" data-clean-canvas={`${img.width}x${img.height}`} data-original={p.showOriginal ? '' : undefined}>
      <div className="relative" style={{ width: w, height: h }}>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label={p.showOriginal ? 'The original image' : 'The cleaned image'} role="img" />
        {showOutline && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${p.outline!.width} ${p.outline!.height}`} preserveAspectRatio="none" aria-hidden="true">
            {p.outline!.paths.map((s) => (
              <path key={s.id} d={s.d} fill="none" stroke="var(--color-accent, #c2410c)" strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
        )}
        <svg
          ref={overlayRef}
          className={`absolute inset-0 h-full w-full touch-none ${p.showOriginal ? '' : 'cursor-crosshair'}`}
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          data-clean-overlay={p.tool}
        >
          {d && (
            <g data-crop-draft="">
              <path d={`M0 0H1V1H0Z M${d.x} ${d.y}V${d.y + d.height}H${d.x + d.width}V${d.y}Z`} fill="rgb(0 0 0 / 0.45)" fillRule="evenodd" />
              <rect x={d.x} y={d.y} width={d.width} height={d.height} fill="none" stroke="white" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              {handles.map((hp, i) => (
                <rect key={i} x={hp.x - HANDLE_PX / 2 / w} y={hp.y - HANDLE_PX / 2 / h} width={HANDLE_PX / w} height={HANDLE_PX / h} fill="white" stroke="black" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          {line && <line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />}
        </svg>
      </div>
    </div>
  )
}

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
      <Section title={p.tool === 'crop' ? 'Crop' : 'Straighten'}>
        {p.tool === 'crop' ? (
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
              onClick={async () => {
                const blob = await pngOf(cleanedPixels(p.source, p.ops))
                const a = document.createElement('a')
                a.href = URL.createObjectURL(blob)
                a.download = `${p.source.name}-cleaned.png`
                a.click()
                setTimeout(() => URL.revokeObjectURL(a.href), 1000)
              }}
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
