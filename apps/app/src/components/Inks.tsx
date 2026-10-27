import { useState } from 'react'
import type { Ink, InkEdits } from '../lib/doc'
import { Section } from './Controls'
import { PipetteIcon } from './IconButton'

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
  /** What the eyedropper is armed for (an ink's traced hex, or 'background'), if anything. */
  picking: string | null
  onPick: (target: string) => void
  /** Colours merged away (traced hex → traced hex), or null where the preset can't merge. */
  merged: Record<string, string> | null
  onMerge: (from: string, into: string) => void
  onUnmerge: (from: string) => void
}

function Dropper({ target, label, picking, onPick }: { target: string; label: string; picking: string | null; onPick: (t: string) => void }) {
  const on = picking === target
  return (
    <button
      type="button"
      onClick={() => onPick(target)}
      aria-pressed={on}
      aria-label={label}
      title={on ? 'Click the image to pick a colour (Esc to cancel)' : 'Pick a colour from the image'}
      className={`grid size-7 shrink-0 place-items-center rounded ${on ? 'bg-accent text-accent-ink' : 'text-ink-muted hover:bg-paper-sunk hover:text-ink'}`}
    >
      <PipetteIcon />
    </button>
  )
}

/**
 * The trace's colours as inks, like screen-print separations. Two edits, both
 * undoable: Replace swaps an ink's colour everywhere, Remove deletes its shapes
 * so those areas export as transparent (the way to drop a background). Edits are
 * keyed by the traced colour, so they survive re-tracing as long as the tracer
 * still produces that colour.
 */
export function Inks({ inks, edits, selectedInk, onReplace, onReplaceDone, onRemove, onRestore, onRestoreAll, background, onBackground, onBackgroundDone, picking, onPick, merged, onMerge, onUnmerge }: Props) {
  const removed = new Set(edits.removed)
  /** The ink whose "merge into" chooser is open. */
  const [merging, setMerging] = useState<string | null>(null)
  // A merge is listed while its colour is merged into one this trace still has
  // (the colour count can drop the target, and then the tracer ignores it).
  const present = new Set(inks.map((i) => i.hex))
  const finalOf = (hex: string) => {
    let to = hex
    let last: string | null = null
    const seen = new Set<string>()
    while (merged?.[to] && !seen.has(to)) {
      seen.add(to)
      to = merged[to]
      if (present.has(to)) last = to
    }
    return last
  }
  const mergedAway = Object.entries(merged ?? {})
    .filter(([from]) => !present.has(from))
    .map(([from]) => [from, finalOf(from)] as const)
    .filter((e): e is readonly [string, string] => e[1] !== null)
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
        Click a swatch to replace a colour, or the pipette to pick one from the image. Remove deletes its shapes, so that area is transparent, or shows the
        background if you add one below.{merged && ' Merge folds a colour into another and re-traces, so the edge between them goes.'}
      </p>
      <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
        {inks.map((ink) => {
          const isRemoved = removed.has(ink.hex)
          const shown = edits.recolor[ink.hex] ?? ink.hex
          const changed = shown !== ink.hex
          const inputId = `ink-${ink.hex.slice(1)}`
          const isSelected = selectedInk === ink.hex
          return (
            <li key={ink.hex} data-ink={ink.hex} aria-current={isSelected || undefined} className={`rounded-md px-1.5 py-1 ${isSelected ? 'bg-accent-dim' : ''}`}>
             <div className="flex items-center gap-2">
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
              {!isRemoved && <Dropper target={ink.hex} label={`Pick a colour for ${ink.hex} from the image`} picking={picking} onPick={onPick} />}
              <div className="ml-1 min-w-0 flex-1">
                <div className={`font-mono text-[12.5px] ${isRemoved ? 'text-ink-faint line-through' : 'text-ink'}`}>{isRemoved ? ink.hex : shown}</div>
                <div className="text-[12px] text-ink-faint">
                  {isRemoved ? 'Removed, now transparent' : `${ink.count} ${ink.count === 1 ? 'shape' : 'shapes'}`}
                  {changed && !isRemoved && (
                    <>
                      {' '}· was {ink.hex} ·{' '}
                      <button className="text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => onRestore(ink.hex)} aria-label={`Reset ${ink.hex} to its traced colour`}>
                        Reset
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isRemoved ? (
                <button className="text-[12.5px] text-ink-muted hover:text-ink" onClick={() => onRestore(ink.hex)} aria-label={`Restore ${ink.hex}`}>
                  Restore
                </button>
              ) : (
                <div className="flex gap-2">
                  {merged && !ink.shaded && inks.filter((o) => !o.shaded).length > 1 && (
                    <button
                      className="text-[12.5px] text-ink-muted hover:text-ink"
                      onClick={() => setMerging((m) => (m === ink.hex ? null : ink.hex))}
                      aria-expanded={merging === ink.hex}
                      aria-label={`Merge ${ink.hex} into another colour`}
                    >
                      Merge
                    </button>
                  )}
                  <button className="text-[12.5px] text-ink-muted hover:text-accent" onClick={() => onRemove(ink.hex)} aria-label={`Remove ${ink.hex}`}>
                    Remove
                  </button>
                </div>
              )}
             </div>
              {merging === ink.hex && (
                <div className="mt-1.5 mb-1 flex flex-wrap items-center gap-1.5 pl-1" role="group" aria-label={`Merge ${ink.hex} into`}>
                  <span className="text-[12px] text-ink-muted">Into:</span>
                  {inks
                    .filter((o) => o.hex !== ink.hex && !removed.has(o.hex) && !o.shaded)
                    .map((o) => (
                      <button
                        key={o.hex}
                        className="h-6 w-8 rounded border border-rule"
                        style={{ background: edits.recolor[o.hex] ?? o.hex }}
                        onClick={() => {
                          setMerging(null)
                          onMerge(ink.hex, o.hex)
                        }}
                        aria-label={`Merge into ${o.hex}`}
                        title={`Merge into ${edits.recolor[o.hex] ?? o.hex}: re-traces with one colour, so the edge between them goes`}
                      />
                    ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {mergedAway.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-rule-soft px-1.5 pt-2" aria-label="Merged colours">
          {mergedAway.map(([from, into]) => (
            <li key={from} data-merged={from} className="flex items-center gap-2 text-[12.5px]">
              <span className="h-4 w-5 rounded-sm border border-rule" style={{ background: from }} aria-hidden="true" />
              <span className="font-mono text-ink-faint">{from}</span>
              <span className="text-ink-faint">merged into</span>
              <span className="h-4 w-5 rounded-sm border border-rule" style={{ background: edits.recolor[into] ?? into }} aria-hidden="true" />
              <button className="ml-auto text-ink-muted hover:text-ink" onClick={() => onUnmerge(from)} aria-label={`Unmerge ${from}`}>
                Unmerge
              </button>
            </li>
          ))}
        </ul>
      )}
      <Background color={background} onChange={onBackground} onDone={onBackgroundDone} picking={picking} onPick={onPick} />
    </Section>
  )
}

/**
 * The background: a layer behind every shape, transparent until added. It
 * only shows where shapes are removed or a colour is deleted, and it exports
 * as the SVG's first element.
 */
function Background({ color, onChange, onDone, picking, onPick }: { color: string | null; onChange: (c: string | null) => void; onDone: () => void; picking: string | null; onPick: (t: string) => void }) {
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
      <Dropper target="background" label="Eyedropper: pick the background from the image" picking={picking} onPick={onPick} />
      <div className="ml-1 min-w-0 flex-1">
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
