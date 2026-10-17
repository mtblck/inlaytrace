import type { Ink, InkEdits } from '../lib/doc'
import { Section } from './Controls'

type Props = {
  inks: Ink[]
  edits: InkEdits
  /** The traced colour of the selected shape, highlighted in the list. */
  selectedInk: string | null
  onReplace: (hex: string, to: string) => void
  onRemove: (hex: string) => void
  onRestore: (hex: string) => void
  onRestoreAll: () => void
}

/**
 * The trace's colours as inks, like screen-print separations. Two edits, both
 * undoable: Replace swaps an ink's colour everywhere, Remove deletes its shapes
 * so those areas export as transparent (the way to drop a background). Edits are
 * keyed by the traced colour, so they survive re-tracing as long as the tracer
 * still produces that colour.
 */
export function Inks({ inks, edits, selectedInk, onReplace, onRemove, onRestore, onRestoreAll }: Props) {
  const removed = new Set(edits.removed)
  const edited = edits.removed.length > 0 || Object.keys(edits.recolor).length > 0

  return (
    <Section
      title={`Colours (${inks.length})`}
      action={
        edited && (
          <button className="text-[12.5px] text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={onRestoreAll}>
            Restore all
          </button>
        )
      }
    >
      <p className="field-hint -mt-1 mb-3">
        Click a swatch to replace a colour. Remove makes its shapes transparent, which is how to drop a background.
      </p>
      <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {inks.map((ink) => {
          const isRemoved = removed.has(ink.hex)
          const shown = edits.recolor[ink.hex] ?? ink.hex
          const changed = shown !== ink.hex
          const inputId = `ink-${ink.hex.slice(1)}`
          const isSelected = selectedInk === ink.hex
          return (
            <li
              key={ink.hex}
              data-ink={ink.hex}
              aria-current={isSelected || undefined}
              className={`flex items-center gap-3 rounded-md px-1.5 py-1 ${isSelected ? 'bg-accent-dim' : ''}`}
            >
              <label
                htmlFor={inputId}
                className={`relative h-7 w-10 shrink-0 overflow-hidden rounded border border-rule ${isRemoved ? 'checker' : ''}`}
                style={isRemoved ? undefined : { background: shown }}
                title="Replace colour"
              >
                {changed && !isRemoved && <span className="absolute inset-y-0 left-0 w-2" style={{ background: ink.hex }} aria-hidden="true" />}
                <input
                  id={inputId}
                  type="color"
                  value={shown}
                  onChange={(e) => onReplace(ink.hex, e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  aria-label={`Replace colour ${ink.hex}`}
                />
              </label>
              <div className="min-w-0 flex-1">
                <div className={`font-mono text-[12.5px] ${isRemoved ? 'text-ink-faint line-through' : 'text-ink'}`}>{isRemoved ? ink.hex : shown}</div>
                <div className="text-[12px] text-ink-faint">
                  {isRemoved ? 'Removed, now transparent' : `${ink.count} ${ink.count === 1 ? 'shape' : 'shapes'}`}
                  {changed && !isRemoved && <> · was {ink.hex}</>}
                </div>
              </div>
              {isRemoved ? (
                <button className="text-[12.5px] text-ink-muted hover:text-ink" onClick={() => onRestore(ink.hex)} aria-label={`Restore ${ink.hex}`}>
                  Restore
                </button>
              ) : (
                <div className="flex gap-2">
                  {changed && (
                    <button className="text-[12.5px] text-ink-muted hover:text-ink" onClick={() => onRestore(ink.hex)} aria-label={`Reset ${ink.hex} to its traced colour`}>
                      Reset
                    </button>
                  )}
                  <button className="text-[12.5px] text-ink-muted hover:text-accent" onClick={() => onRemove(ink.hex)} aria-label={`Remove ${ink.hex}`}>
                    Remove
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
