import type { Tool } from './Canvas'
import type { Axis } from '../lib/mirror'
import { Section } from './Controls'

type Props = {
  tool: Tool
  onTool: (t: Tool) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  detached: boolean
  selection: { id: string; nodes: number; node: boolean } | null
  onDeleteSelection: () => void
  axis: Axis
  width: number
  height: number
  onAxis: (axis: Axis) => void
  mirroring: boolean
  mirrorError: string | null
  onMirror: () => void
}

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

/**
 * Editing on top of the trace. Select reshapes paths node by node; Mirror
 * keeps one half and reflects it. The first shape edit detaches the drawing
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
      <div role="radiogroup" aria-label="Tool" className="mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule">
        {(
          [
            ['select', 'Select'],
            ['mirror', 'Mirror'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            role="radio"
            aria-checked={p.tool === t}
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
                Drag a square to move a node, a dot to bend its curve. {p.selection.nodes} nodes.
              </p>
              <button className="btn w-full" onClick={p.onDeleteSelection}>
                {p.selection.node ? 'Delete node' : 'Delete shape'}
              </button>
            </>
          ) : (
            <p className="field-hint">Click a shape to select it and show its nodes. Esc to deselect.</p>
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
