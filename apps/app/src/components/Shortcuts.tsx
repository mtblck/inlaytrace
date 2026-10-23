import { useEffect, useRef } from 'react'

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
/** The platform's command key, for labels: ⌘ on a Mac, Ctrl elsewhere. */
export const MOD = MAC ? '⌘' : 'Ctrl'
const ALT = MAC ? '⌥' : 'Alt'
const SHIFT = MAC ? '⇧' : 'Shift'

type Row = { keys: string[]; does: string }

/**
 * Every shortcut, grouped as the panel shows them. The handlers live in
 * App.tsx (editing) and Canvas.tsx (zoom, drag modifiers); keep this list in
 * step with them and with docs/features/keyboard-shortcuts.md.
 */
export const SHORTCUTS: { title: string; rows: Row[] }[] = [
  {
    title: 'Tools',
    rows: [
      { keys: ['V'], does: 'Select: pick, move and scale shapes' },
      { keys: ['A'], does: 'Nodes: edit one shape’s nodes and curves' },
      { keys: ['M'], does: 'Mirror' },
      { keys: ['Double-click'], does: 'Edit a shape’s nodes (Select); add a node on the outline (Nodes)' },
    ],
  },
  {
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
      { keys: [`${MOD} Z`], does: 'Undo' },
      { keys: [MAC ? '⇧⌘ Z' : 'Ctrl Shift Z', MAC ? '' : 'Ctrl Y'].filter(Boolean), does: 'Redo' },
    ],
  },
  {
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
      <div className="grid gap-x-8 gap-y-5 px-5 py-4 sm:grid-cols-2">
        {SHORTCUTS.map((g) => (
          <section key={g.title}>
            <h3 className="field-label mb-2">{g.title}</h3>
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
      <p className="field-hint border-t border-rule px-5 py-3">Shortcuts don’t fire while you’re typing in a field. Nudges are in pixels of the trace.</p>
    </dialog>
  )
}
