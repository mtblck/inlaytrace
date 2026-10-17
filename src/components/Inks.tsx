import type { Ink, InkEdits } from '../lib/doc'
import { Section } from './Controls'

type Props = {
  inks: Ink[]
  edits: InkEdits
  /** The traced colour of the selected shape, highlighted in the list. */
  selectedInk: string | null
  onReplace: (hex: string, to: string) => void
  /** The picker closed: the next replace is a new undo step. */
  onReplaceDone: () => void
  onRemove: (hex: string) => void
  onRestore: (hex: string) => void
  onRestoreAll: () => void
  /** A colour behind every shape, or null for transparent. */
  background: string | null
  onBackground: (color: string | null) => void
  /** The background picker closed: the next change is a new undo step. */
  onBackgroundDone: () => void
}

/**
 * The trace's colours as inks, like screen-print separations. Two edits, both
 * undoable: Replace swaps an ink's colour everywhere, Remove deletes its shapes
 * so those areas export as transparent (the way to drop a background). Edits are
 * keyed by the traced colour, so they survive re-tracing as long as the tracer
 * still produces that colour.
 */
export function Inks({ inks, edits, selectedInk, onReplace, onReplaceDone, onRemove, onRestore, onRestoreAll, background, onBackground, onBackgroundDone }: Props) {
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
        Click a swatch to replace a colour. Remove deletes its shapes, so that area is transparent, or shows the background if you add one below.
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
                  onBlur={onReplaceDone}
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
      <Background color={background} onChange={onBackground} onDone={onBackgroundDone} />
    </Section>
  )
}

/**
 * The background: a layer behind every shape, transparent until added. It
 * only shows where shapes are removed or a colour is deleted, and it exports
 * as the SVG's first element.
 */
function Background({ color, onChange, onDone }: { color: string | null; onChange: (c: string | null) => void; onDone: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-3 border-t border-rule-soft px-1.5 pt-3" data-background={color ?? 'none'}>
      <label
        htmlFor="background-colour"
        className={`relative h-7 w-10 shrink-0 overflow-hidden rounded border border-rule ${color ? '' : 'checker'}`}
        style={color ? { background: color } : undefined}
        title={color ? 'Change background colour' : 'Add a background colour'}
      >
        <input
          id="background-colour"
          type="color"
          value={color ?? '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onDone}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Background colour"
        />
      </label>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-ink">Background</div>
        <div className="font-mono text-[12px] text-ink-faint">{color ?? 'None, transparent'}</div>
      </div>
      {color ? (
        <button className="text-[12.5px] text-ink-muted hover:text-accent" onClick={() => onChange(null)} aria-label="Remove background">
          Remove
        </button>
      ) : (
        <button className="text-[12.5px] text-ink-muted hover:text-ink" onClick={() => onChange('#ffffff')} aria-label="Add background">
          Add
        </button>
      )}
    </div>
  )
}
