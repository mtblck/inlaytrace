import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

export type ViewMode = 'split' | 'difference' | 'outlines'

type Props = {
  imageUrl: string
  svg: string
  width: number
  height: number
  mode: ViewMode
  zoom: number
}

/**
 * The before/after surface. Both layers are drawn at exactly the same box, so
 * the split, the difference blend and the outline view all line up to the
 * pixel. At zoom 1 the sheet fits the available space; above that it grows and
 * the mat scrolls.
 */
export function Canvas({ imageUrl, svg, width, height, mode, zoom }: Props) {
  const matRef = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  const [split, setSplit] = useState(50)
  const dragging = useRef(false)
  const sheetRef = useRef<HTMLDivElement>(null)

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

  const moveTo = useCallback((clientX: number) => {
    const rect = sheetRef.current?.getBoundingClientRect()
    if (!rect) return
    setSplit(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }, [])

  const onPointerDown = (e: PointerEvent) => {
    if (mode !== 'split') return
    dragging.current = true
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    moveTo(e.clientX)
  }
  const onPointerMove = (e: PointerEvent) => dragging.current && moveTo(e.clientX)
  const onPointerUp = () => (dragging.current = false)

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2
    if (e.key === 'ArrowLeft') setSplit((s) => Math.max(0, s - step))
    else if (e.key === 'ArrowRight') setSplit((s) => Math.min(100, s + step))
    else if (e.key === 'Home') setSplit(0)
    else if (e.key === 'End') setSplit(100)
    else return
    e.preventDefault()
  }

  const w = fit.w * zoom
  const h = fit.h * zoom

  return (
    <div ref={matRef} className="mat absolute inset-0 overflow-auto">
      <div className="grid min-h-full min-w-full place-items-center p-8" style={{ width: zoom > 1 ? w + 64 : undefined }}>
        <div
          ref={sheetRef}
          className="checker relative shadow-[0_0_0_1px_var(--c-rule)] select-none"
          style={{ width: w, height: h, touchAction: mode === 'split' ? 'none' : undefined }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            src={imageUrl}
            alt="Original image"
            draggable={false}
            className="absolute inset-0 h-full w-full"
            style={{
              imageRendering: zoom >= 3 ? 'pixelated' : undefined,
              opacity: mode === 'outlines' ? 0.35 : 1,
            }}
          />
          <div
            className={`vector absolute inset-0 ${mode === 'outlines' ? 'outlines' : ''}`}
            style={{
              clipPath: mode === 'split' ? `inset(0 0 0 ${split}%)` : undefined,
              mixBlendMode: mode === 'difference' ? 'difference' : undefined,
            }}
            role="img"
            aria-label="Traced SVG"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {mode === 'split' && (
            <div
              role="slider"
              tabIndex={0}
              aria-label="Comparison split. Left is the original, right is the SVG."
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(split)}
              onKeyDown={onKeyDown}
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
