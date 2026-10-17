import { useState } from 'react'
import { convert, pngPixels, UNITS, type ExportSize, type Unit } from '../lib/vectorExport'

type Props = {
  /** The size every export uses. Proportions always follow the drawing. */
  size: ExportSize
  /** The drawing's own aspect ratio, width / height. */
  aspect: number
  onSize: (size: ExportSize) => void
  onReset: () => void
  isDefault: boolean
  disabled: boolean
  onPng: (scale: number, dpi: number) => void
  onPdf: () => void
  onEps: () => void
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Size and the other formats, folded away under the main buttons. The size
 * applies to every export: the SVG's width and height (in px, mm, in or pt;
 * the viewBox is untouched), the PDF and EPS page, and the PNG.
 */
export function ExportOptions(p: Props) {
  const [scale, setScale] = useState(2)
  const [dpi, setDpi] = useState(300)
  const [draft, setDraft] = useState<{ k: 'width' | 'height'; v: string } | null>(null)
  const physical = p.size.unit !== 'px'
  const px = pngPixels(p.size, scale, dpi)

  const setSide = (k: 'width' | 'height', raw: string) => {
    setDraft({ k, v: raw })
    const v = Number(raw)
    if (!Number.isFinite(v) || v <= 0) return
    p.onSize(k === 'width' ? { ...p.size, width: v, height: v / p.aspect } : { ...p.size, height: v, width: v * p.aspect })
  }
  const field = (k: 'width' | 'height', label: string) => (
    <label className="flex min-w-0 items-center gap-1.5">
      <span className="field-label w-3 shrink-0">{label}</span>
      <input
        type="number"
        step="any"
        min={0}
        aria-label={`Export ${k}`}
        className="w-full min-w-0 rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[13px]"
        value={draft?.k === k ? draft.v : String(round(p.size[k]))}
        onChange={(e) => setSide(k, e.target.value)}
        onBlur={() => setDraft(null)}
      />
    </label>
  )

  return (
    <details className="group mt-2" data-export-options="">
      <summary className="cursor-pointer list-none text-[12.5px] text-ink-muted select-none hover:text-ink">
        <span className="inline-block transition-transform group-open:rotate-90">›</span> Size and other formats
        <span className="num ml-1.5">
          {round(p.size.width)} × {round(p.size.height)} {p.size.unit}
        </span>
      </summary>
      <div className="mt-2 space-y-2.5">
        <div className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
          {field('width', 'W')}
          {field('height', 'H')}
          <select
            aria-label="Export unit"
            className="rounded-md border border-rule bg-paper px-1.5 py-1 text-[13px]"
            value={p.size.unit}
            onChange={(e) => {
              const unit = e.target.value as Unit
              p.onSize({ unit, width: convert(p.size.width, p.size.unit, unit), height: convert(p.size.height, p.size.unit, unit) })
            }}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <p className="field-hint">
          Used by every download: the SVG’s width and height, the PDF and EPS page, and the PNG. Proportions follow the drawing; 96 px to the inch.{' '}
          {!p.isDefault && (
            <button className="underline underline-offset-2 hover:text-ink" onClick={p.onReset}>
              Reset to the traced size
            </button>
          )}
        </p>
        <div className="flex items-center gap-2">
          <button className="btn flex-1" disabled={p.disabled} onClick={() => p.onPng(scale, dpi)} title="A PNG rendered from the vector">
            PNG · {px.width} × {px.height}
          </button>
          {physical ? (
            <select aria-label="PNG resolution" className="rounded-md border border-rule bg-paper px-1.5 py-1 text-[13px]" value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
              {[72, 150, 300, 600].map((d) => (
                <option key={d} value={d}>
                  {d} dpi
                </option>
              ))}
            </select>
          ) : (
            <select aria-label="PNG scale" className="rounded-md border border-rule bg-paper px-1.5 py-1 text-[13px]" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
              {[1, 2, 3, 4].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" disabled={p.disabled} onClick={p.onPdf} title="Vector PDF, one page at the export size">
            PDF
          </button>
          <button className="btn" disabled={p.disabled} onClick={p.onEps} title="Encapsulated PostScript, for print and cutting software">
            EPS
          </button>
        </div>
      </div>
    </details>
  )
}
