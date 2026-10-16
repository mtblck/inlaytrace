import { type Ink, type InkEdits } from '../lib/svg'
import { Section } from './Controls'

type Props = {
  inks: Ink[]
  edits: InkEdits
  onChange: (next: InkEdits) => void
}

/**
 * The trace's colours as a list of inks, like screen-print separations. Each
 * can be recoloured or hidden; the trace itself is untouched, so edits survive
 * re-tracing as long as the colour still comes out of the tracer.
 */
export function Inks({ inks, edits, onChange }: Props) {
  const hidden = new Set(edits.hidden)
  const edited = edits.hidden.length > 0 || Object.keys(edits.recolor).length > 0

  const recolor = (hex: string, to: string) => {
    const recolorMap = { ...edits.recolor }
    if (to.toLowerCase() === hex) delete recolorMap[hex]
    else recolorMap[hex] = to.toLowerCase()
    onChange({ ...edits, recolor: recolorMap })
  }
  const toggle = (hex: string) =>
    onChange({ ...edits, hidden: hidden.has(hex) ? edits.hidden.filter((h) => h !== hex) : [...edits.hidden, hex] })

  return (
    <Section
      title={`Inks (${inks.length})`}
      action={
        edited && (
          <button
            className="text-[12.5px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
            onClick={() => onChange({ recolor: {}, hidden: [] })}
          >
            Restore all
          </button>
        )
      }
    >
      <p className="field-hint -mt-1 mb-3">Click a swatch to change its colour. Hide an ink to drop it from the export.</p>
      <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {inks.map((ink) => {
          const shown = edits.recolor[ink.hex] ?? ink.hex
          const isHidden = hidden.has(ink.hex)
          const inputId = `ink-${ink.hex.slice(1)}`
          return (
            <li key={ink.hex} className={`flex items-center gap-3 rounded-md py-1 ${isHidden ? 'opacity-45' : ''}`}>
              <label
                htmlFor={inputId}
                className="relative h-7 w-10 shrink-0 overflow-hidden rounded border border-rule"
                style={{ background: shown }}
                title="Change colour"
              >
                {shown !== ink.hex && (
                  <span className="absolute inset-y-0 left-0 w-2" style={{ background: ink.hex }} aria-hidden="true" />
                )}
                <input
                  id={inputId}
                  type="color"
                  value={shown}
                  onChange={(e) => recolor(ink.hex, e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label={`Colour for ink ${shown}`}
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12.5px] text-ink">{shown}</div>
                <div className="text-[12px] text-ink-faint">
                  {ink.count} {ink.count === 1 ? 'shape' : 'shapes'}
                  {shown !== ink.hex && <> · was {ink.hex}</>}
                </div>
              </div>
              <button
                onClick={() => toggle(ink.hex)}
                aria-pressed={isHidden}
                aria-label={isHidden ? `Show ink ${shown}` : `Hide ink ${shown}`}
                className="rounded p-1.5 text-ink-muted hover:text-ink"
              >
                <EyeIcon off={isHidden} />
              </button>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2.5 13.5 13.5 2.5" />}
    </svg>
  )
}
