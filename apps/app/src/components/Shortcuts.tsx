import { useEffect, useRef } from 'react'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
/** The platform's command key, for labels: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD = MAC ? '⌘' : 'Ctrl'
const ALT = MAC ? '⌥' : 'Alt'
const SHIFT = MAC ? '⇧' : 'Shift'
/** Undo and Redo's keys, for the panel and for tooltips. */
export const UNDO_KEYS = `${MOD} Z`
export const REDO_KEYS = MAC ? '⇧⌘ Z' : 'Ctrl Shift Z'

type Row = { keys: string[]; does: string }

/** The shortcuts panel's headings, in order: each workspace mode with shortcuts of its own, then those that work in all. */
const MODES = ['Clean up mode', 'Edit mode', 'Every mode'] as const

/**
 * Every shortcut, grouped as the panel shows them. The handlers live in
 * App.tsx (editing) and Canvas.tsx (zoom, drag modifiers); keep this list in
 * step with them and with docs/features/keyboard-shortcuts.md.
 */
export const SHORTCUTS: { mode: (typeof MODES)[number]; title: string; rows: Row[] }[] = [
  {
    mode: 'Clean up mode',
    title: 'Clean up',
    rows: [
      { keys: ['C'], does: 'Crop: drag a box on the image' },
      { keys: ['Enter'], does: 'Crop to the box' },
      { keys: ['Esc'], does: 'Cancel the box' },
      { keys: ['L'], does: 'Straighten: drag along a line that should be level or upright' },
      { keys: ['B'], does: 'Brush: paint over gaps, holes and blotches' },
      { keys: ['E'], does: 'Eraser: paint the background colour over stray marks' },
      { keys: ['[', ']'], does: 'Brush smaller, bigger' },
      { keys: [`${SHIFT} [`, `${SHIFT} ]`], does: 'Brush softer, harder' },
      { keys: [`${ALT} click`], does: 'Pick the brush colour from the image' },
      { keys: ['Space drag'], does: 'Pan when zoomed in (or drag with the middle button)' },
      { keys: [`${MOD} +`, `${MOD} −`, `${MOD} 0`], does: 'Zoom the image in, out, back to fit' },
    ],
  },
  {
    mode: 'Edit mode',
    title: 'Tools',
    rows: [
      { keys: ['V'], does: 'Select: pick, move and scale shapes' },
      { keys: ['A'], does: 'Nodes: edit one shape’s nodes and curves' },
      { keys: ['M'], does: 'Mirror' },
      { keys: ['K'], does: 'Fill: fill a shape, or the area between shapes, with a colour' },
      { keys: ['Double-click'], does: 'Edit a shape’s nodes (Select); add a node on the outline (Nodes)' },
    ],
  },
  {
    mode: 'Edit mode',
    title: 'Selection',
    rows: [
      { keys: [`${MOD} A`], does: 'Select all shapes, or all nodes with Nodes' },
      { keys: [`${SHIFT} click`], does: 'Add to or remove from the selection' },
      { keys: ['Drag on empty canvas'], does: 'Select shapes wholly inside (or nodes, with Nodes)' },
      { keys: [`${SHIFT} drag`, `${ALT} drag`], does: 'Add to / remove from the selection' },
      { keys: ['Esc'], does: 'Put the eyedropper away; deselect nodes, then shapes; back to Select' },
    ],
  },
  {
    mode: 'Edit mode',
    title: 'Editing',
    rows: [
      { keys: ['← ↑ → ↓'], does: 'Nudge the selection 1 px' },
      { keys: [`${SHIFT} arrows`], does: 'Nudge 10 px' },
      { keys: [`${SHIFT} drag`], does: 'Move along one axis; scale in proportion; rotate in 15° steps' },
      { keys: [`${ALT} drag`], does: 'Scale from the centre; bend one handle on its own' },
      { keys: ['Delete', 'Backspace'], does: 'Delete the selected nodes or shapes' },
      { keys: [`${MOD} G`, `${SHIFT} ${MOD} G`], does: 'Group / ungroup the selected shapes' },
      { keys: [`${MOD} ]`, `${MOD} [`], does: 'Bring forward / send backward' },
      { keys: [`${SHIFT} ${MOD} ]`, `${SHIFT} ${MOD} [`], does: 'Bring to front / send to back' },
    ],
  },
  {
    mode: 'Every mode',
    title: 'History',
    rows: [
      { keys: [UNDO_KEYS], does: 'Undo' },
      { keys: [REDO_KEYS, MAC ? '' : 'Ctrl Y'].filter(Boolean), does: 'Redo' },
    ],
  },
  {
    mode: 'Every mode',
    title: 'View',
    rows: [
      { keys: [`${MOD} =`, `${MOD} −`], does: 'Zoom in / out around the pointer' },
      { keys: [`${MOD} 0`], does: 'Fit to window' },
      { keys: [`${MOD} 1`], does: '100%' },
      { keys: [`${MOD} scroll`, 'Pinch'], does: 'Zoom around the pointer' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
]

/**
 * The shortcuts panel. A native modal <dialog>: the browser traps focus,
 * closes it on Esc and makes the page behind it inert, with no script of ours.
 */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby="shortcuts-title"
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto max-h-[85vh] w-[min(720px,calc(100vw-32px))] overflow-y-auto rounded-lg border border-rule bg-paper p-0 text-ink shadow-xl backdrop:bg-ink/30"
    >
      <div className="flex items-center justify-between border-b border-rule px-5 py-3">
        <h2 id="shortcuts-title" className="font-display text-[24px] leading-none">
          Keyboard shortcuts
        </h2>
        <button className="btn h-7 px-2 text-[12.5px]" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
      {MODES.map((mode) => (
        <div key={mode} className="border-b border-rule-soft px-5 py-4 last:border-b-0" data-shortcuts-mode={mode}>
          <h3 className="mb-3 text-[13px] font-semibold text-ink">{mode}</h3>
          <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
            {SHORTCUTS.filter((g) => g.mode === mode).map((g) => (
              <section key={g.title}>
                <h4 className="field-label mb-2">{g.title}</h4>
                <dl className="space-y-1.5">
                  {g.rows.map((r) => (
                    <div key={r.does} className="flex items-baseline justify-between gap-3 text-[13px]">
                      <dt className="text-ink-muted">{r.does}</dt>
                      <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                        {r.keys.map((k) => (
                          <kbd key={k} className="rounded border border-rule bg-paper-sunk px-1.5 py-px font-mono text-[12px] whitespace-nowrap text-ink">
                            {k}
                          </kbd>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      ))}
      <p className="field-hint border-t border-rule px-5 py-3">Shortcuts don’t fire while you’re typing in a field. Nudges are in pixels of the trace.</p>
    </dialog>
  )
}
