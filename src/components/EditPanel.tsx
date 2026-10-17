import { useState } from 'react'
import type { Tool } from './Canvas'
import type { Axis } from '../lib/mirror'
import type { Box } from '../lib/transform'
import { Section } from './Controls'
import { MOD } from './Shortcuts'

type Props = {
  tool: Tool
  onTool: (t: Tool) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  detached: boolean
  /** `nodes` counts the edited shape's nodes; `selectedNodes` those picked with the Nodes tool. */
  selection: { key: string; shapes: number; nodes: number; selectedNodes: number; box: Box | null } | null
  onDeleteSelection: () => void
  /** One typed field of the bounds; `lock` keeps W and H in proportion. Changes in one field undo together. */
  onBox: (field: keyof Box, value: number, lock: boolean) => void
  onBoxDone: () => void
  axis: Axis
  width: number
  height: number
  onAxis: (axis: Axis) => void
  mirroring: boolean
  mirrorError: string | null
  onMirror: () => void
}

const mod = MOD === '⌘' ? '⌘' : 'Ctrl+'

/**
 * Editing on top of the trace. Select moves and scales whole shapes; Nodes
 * reshapes one shape node by node; Mirror keeps one half and reflects it. The first shape edit detaches the drawing
 * from the trace, which the note at the bottom says plainly, because it changes
 * what a trace setting does next.
 */
export function EditPanel(p: Props) {
  const v = p.axis.orientation === 'vertical'
  const max = v ? p.width : p.height
  const setAxis = (patch: Partial<Axis>) => p.onAxis({ ...p.axis, ...patch })

  return (
    <Section
      title="Edit"
      action={
        <div className="flex gap-1" role="group" aria-label="History">
          <button className="btn h-7 px-2 text-[12.5px]" disabled={!p.canUndo} onClick={p.onUndo} title={`Undo (${mod}Z)`}>
            Undo
          </button>
          <button className="btn h-7 px-2 text-[12.5px]" disabled={!p.canRedo} onClick={p.onRedo} title={`Redo (${mod === '⌘' ? '⇧⌘' : 'Ctrl+Shift+'}Z)`}>
            Redo
          </button>
        </div>
      }
    >
      <div role="radiogroup" aria-label="Tool" className="mb-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-rule bg-rule">
        {(
          [
            ['select', 'Select', 'V'],
            ['nodes', 'Nodes', 'A'],
            ['mirror', 'Mirror', 'M'],
          ] as const
        ).map(([t, label, key]) => (
          <button
            key={t}
            role="radio"
            aria-checked={p.tool === t}
            aria-keyshortcuts={key}
            title={`${label} (${key})`}
            onClick={() => p.onTool(t)}
            className={`py-1.5 text-[13px] ${p.tool === t ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk text-ink hover:bg-paper'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {p.tool === 'select' && (
        <div className="space-y-2">
          {p.selection ? (
            <>
              <p className="field-hint">
                {p.selection.shapes === 1 ? '1 shape' : `${p.selection.shapes} shapes`} selected. Drag to move, drag a square to scale (⇧ in proportion, ⌥ from the centre). Arrows nudge.
              </p>
              {/* Keyed to the selection, so a half-typed value never carries over to other shapes. */}
              {p.selection.box && <BoxFields key={p.selection.key} box={p.selection.box} onBox={p.onBox} onDone={p.onBoxDone} />}
              <button className="btn w-full" onClick={p.onDeleteSelection}>
                {p.selection.shapes === 1 ? 'Delete shape' : `Delete ${p.selection.shapes} shapes`}
              </button>
            </>
          ) : (
            <p className="field-hint">Click a shape to select it, ⇧-click to add more, or drag round shapes from empty space. Double-click a shape to edit its nodes.</p>
          )}
        </div>
      )}

      {p.tool === 'nodes' && (
        <div className="space-y-2">
          {p.selection ? (
            <>
              <p className="field-hint">
                Drag a square to move a node, a dot to bend its curve; the other handle follows on smooth nodes (hold ⌥ to bend one on its own). Drag round nodes to
                select several. {p.selection.nodes} nodes{p.selection.selectedNodes > 1 ? `, ${p.selection.selectedNodes} selected` : ''}.
              </p>
              <button className="btn w-full" onClick={p.onDeleteSelection}>
                {p.selection.selectedNodes === 0 ? 'Delete shape' : p.selection.selectedNodes === 1 ? 'Delete node' : `Delete ${p.selection.selectedNodes} nodes`}
              </button>
            </>
          ) : (
            <p className="field-hint">Click a shape to show its nodes. Esc to deselect.</p>
          )}
        </div>
      )}

      {p.tool === 'mirror' && (
        <div className="space-y-3">
          <Choice
            label="Axis"
            value={p.axis.orientation}
            options={[
              ['vertical', 'Vertical'],
              ['horizontal', 'Horizontal'],
            ]}
            onChange={(o) => setAxis({ orientation: o, position: (o === 'vertical' ? p.width : p.height) / 2 })}
          />
          <Choice
            label="Keep"
            value={p.axis.keep}
            options={
              v
                ? [
                    ['start', 'Left'],
                    ['end', 'Right'],
                  ]
                : [
                    ['start', 'Top'],
                    ['end', 'Bottom'],
                  ]
            }
            onChange={(k) => setAxis({ keep: k })}
          />
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="axis-pos" className="field-label">
                Position
              </label>
              <button className="text-[12.5px] text-ink-muted hover:text-ink" onClick={() => setAxis({ position: max / 2 })}>
                Centre
              </button>
            </div>
            <input
              id="axis-pos"
              type="number"
              className="mt-1 w-full rounded-md border border-rule bg-paper px-2 py-1.5 font-mono text-[13px]"
              min={0}
              max={max}
              step={0.5}
              value={p.axis.position}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (Number.isFinite(n)) setAxis({ position: Math.min(max, Math.max(0, n)) })
              }}
            />
            <p className="field-hint mt-1">Drag the dashed line on the canvas, or type a position. The faded side gets replaced.</p>
          </div>
          <button className="btn btn-primary w-full" onClick={p.onMirror} disabled={p.mirroring}>
            {p.mirroring ? 'Mirroring…' : `Mirror ${v ? (p.axis.keep === 'start' ? 'left onto right' : 'right onto left') : p.axis.keep === 'start' ? 'top onto bottom' : 'bottom onto top'}`}
          </button>
          {p.mirrorError && (
            <p role="alert" className="text-[12.5px] text-accent">
              {p.mirrorError}
            </p>
          )}
        </div>
      )}

      {p.detached && (
        <p className="field-hint mt-3 border-t border-rule-soft pt-3">
          Shapes edited. Changing a trace setting will ask before replacing them.
        </p>
      )}
    </Section>
  )
}

function Choice<T extends string>(props: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      <span className="field-label">{props.label}</span>
      <div role="radiogroup" aria-label={props.label} className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
        {props.options.map(([v, l]) => (
          <button
            key={v}
            role="radio"
            aria-checked={props.value === v}
            onClick={() => props.onChange(v)}
            className={`py-1.5 text-[13px] ${props.value === v ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk text-ink hover:bg-paper'}`}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * X, Y, W and H of the selection's bounds, in pixels of the trace. Each field
 * keeps what you type while it has focus, so a half-typed number never
 * reshapes the drawing; it applies as you type valid numbers and undoes as one
 * step per field.
 */
function BoxFields({ box, onBox, onDone }: { box: Box; onBox: (k: keyof Box, v: number, lock: boolean) => void; onDone: () => void }) {
  const [lock, setLock] = useState(false)
  const set = (k: keyof Box, v: number) => {
    if (!Number.isFinite(v)) return
    if ((k === 'w' || k === 'h') && v <= 0) return
    onBox(k, v, lock)
  }
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <NumberField key={k} label={k.toUpperCase()} value={round(box[k])} onValue={(v) => set(k, v)} onDone={onDone} />
        ))}
      </div>
      <label className="flex items-center gap-1.5 text-[12.5px] text-ink-muted">
        <input type="checkbox" className="accent-[var(--c-accent)]" checked={lock} onChange={(e) => setLock(e.target.checked)} />
        Keep proportions
      </label>
    </div>
  )
}

function NumberField({ label, value, onValue, onDone }: { label: string; value: number; onValue: (v: number) => void; onDone: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <label className="flex items-center gap-2">
      <span className="field-label w-3 shrink-0">{label}</span>
      <input
        type="number"
        step="any"
        aria-label={{ X: 'X position', Y: 'Y position', W: 'Width', H: 'Height' }[label]}
        className="w-full min-w-0 rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[13px]"
        value={draft ?? String(value)}
        onChange={(e) => {
          setDraft(e.target.value)
          if (e.target.value.trim() !== '') onValue(Number(e.target.value))
        }}
        onBlur={() => {
          setDraft(null)
          onDone()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
    </label>
  )
}
