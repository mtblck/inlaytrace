/**
 * The workspace shell (#198): one canvas, a mode switcher above it, a tool
 * rail beside it and a properties panel in the sidebar, filled per mode.
 * Clean up fixes the image before tracing (#199); Trace sets up the trace;
 * Edit fixes its shapes. See docs/adr/0005-editor-scope.md.
 *
 * The modes are tabs: each controls its panel in the sidebar
 * (`panel-<mode>`), so the panel is announced with the mode it belongs to.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import type { Tool } from './Canvas'
import { REDO_KEYS, UNDO_KEYS } from './Shortcuts'

export type WorkMode = 'clean' | 'trace' | 'edit'

export const MODE_LABEL: Record<WorkMode, string> = { clean: 'Clean up', trace: 'Trace', edit: 'Edit' }

/** The mode tabs, above the canvas. `edited` marks Edit when the drawing has shape edits. */
export function ModeSwitch({ modes, mode, onMode, edited }: { modes: WorkMode[]; mode: WorkMode; onMode: (m: WorkMode) => void; edited: boolean }) {
  return (
    <div role="tablist" aria-label="Mode" className="flex shrink-0 items-center gap-px overflow-hidden rounded-md border border-rule bg-rule" data-modes={modes.join(' ')}>
      {modes.map((m) => (
        <button
          key={m}
          role="tab"
          id={`tab-${m}`}
          aria-selected={mode === m}
          aria-controls={`panel-${m}`}
          onClick={() => onMode(m)}
          className={`flex items-center px-2.5 py-1 text-[13px] sm:px-3.5 ${mode === m ? 'bg-paper font-medium text-accent' : 'bg-paper-sunk text-ink hover:bg-paper'}`}
        >
          {MODE_LABEL[m]}
          {m === 'edit' && edited && (
            <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent" data-edited="">
              <span className="sr-only">(edited)</span>
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export type RailTool<T extends string> = { id: T; label: string; key: string; icon: ReactNode; disabled?: string }

const icon = (d: string) => (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
    <path d={d} />
  </svg>
)

/** Edit mode's tools by name: the rail's buttons and the panel's heading. */
export const TOOL_LABEL: Record<Tool, string> = { select: 'Select', nodes: 'Nodes', mirror: 'Mirror', fill: 'Fill' }

/** Edit mode's tools, as the rail shows them. */
export const EDIT_TOOLS = (strokes: boolean): RailTool<Tool>[] => [
  { id: 'select', label: TOOL_LABEL.select, key: 'V', icon: icon('M4 2.5l10 6-4.5 1.2L7.2 14z') },
  { id: 'nodes', label: TOOL_LABEL.nodes, key: 'A', icon: icon('M3 13C5 5 13 13 15 5M2 12h2v2H2zM14 4h2v2h-2z') },
  {
    id: 'mirror',
    label: TOOL_LABEL.mirror,
    key: 'M',
    icon: icon('M9 2v14M7 4L3 14h4zM11 4l4 10h-4z'),
    ...(strokes ? { disabled: 'Mirror works on filled shapes, and this trace has lines' } : {}),
  },
  {
    id: 'fill',
    label: TOOL_LABEL.fill,
    key: 'K',
    icon: icon('M3.5 9.5L9 4l5.5 5.5L9 15zM9 4L7 2M14.5 9.5c.8 1.4 1.5 2.4 1.5 3.2a1.5 1.5 0 01-3 0c0-.8.7-1.8 1.5-3.2z'),
    ...(strokes ? { disabled: 'Fill needs filled outlines, and this trace has lines (try Line art)' } : {}),
  },
]

/** Clean up's tools by name (#199, #200, #202). */
export const CLEAN_TOOL_LABEL = { crop: 'Crop', straighten: 'Straighten', brush: 'Brush', eraser: 'Eraser' } as const
export const CLEAN_TOOLS: RailTool<keyof typeof CLEAN_TOOL_LABEL>[] = [
  { id: 'crop', label: CLEAN_TOOL_LABEL.crop, key: 'C', icon: icon('M5 1.5V13h11.5M1.5 5H13v11.5') },
  { id: 'straighten', label: CLEAN_TOOL_LABEL.straighten, key: 'L', icon: icon('M2 12.5L16 5.5M2 15.5h14') },
  { id: 'brush', label: CLEAN_TOOL_LABEL.brush, key: 'B', icon: icon('M15.5 2.5L8 10M8 10c-2-.5-4 .5-4.5 3S2 16 2 16s2.5.5 5-.5 3-3 1-5.5') },
  { id: 'eraser', label: CLEAN_TOOL_LABEL.eraser, key: 'E', icon: icon('M10.5 3l4.5 4.5-7 7H4.5L2 12zM6 7.5L10.5 12M8 14.5h8') },
]

/**
 * The tool rail: the mode's tools, then Undo and Redo. A column beside the
 * canvas on a wide screen, a row in the mode bar on a phone.
 */
export function ToolRail<T extends string>(p: { tools: RailTool<T>[]; tool: T; onTool: (t: T) => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void }) {
  const btn = 'grid size-8 place-items-center lg:size-9 rounded-md disabled:cursor-not-allowed disabled:text-ink-faint'
  return (
    <div className="flex shrink-0 items-center gap-1 lg:h-full lg:flex-col lg:border-r lg:border-rule lg:px-1.5 lg:py-2" data-rail="">
      <div role="radiogroup" aria-label="Tool" className="flex gap-1 lg:flex-col">
        {p.tools.map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={p.tool === t.id}
            aria-keyshortcuts={t.key}
            title={t.disabled ?? `${t.label} (${t.key})`}
            disabled={!!t.disabled}
            onClick={() => p.onTool(t.id)}
            className={`${btn} ${p.tool === t.id ? 'bg-accent-dim text-accent' : 'text-ink-muted hover:bg-paper-sunk hover:text-ink'}`}
          >
            {t.icon}
            {/* Named by text, not aria-label, so it stays apart from the canvas's "Nodes" overlay checkbox for label lookups. */}
            <span className="sr-only">{t.label}</span>
          </button>
        ))}
      </div>
      <div role="group" aria-label="History" className="ml-auto flex gap-1 lg:mt-auto lg:ml-0 lg:flex-col">
        <button className={`${btn} text-ink-muted hover:bg-paper-sunk hover:text-ink`} disabled={!p.canUndo} onClick={p.onUndo} aria-label="Undo" title={`Undo (${UNDO_KEYS})`}>
          {icon('M6 4L3 7l3 3M3 7h7.5a4 4 0 010 8H8')}
        </button>
        <button className={`${btn} text-ink-muted hover:bg-paper-sunk hover:text-ink`} disabled={!p.canRedo} onClick={p.onRedo} aria-label="Redo" title={`Redo (${REDO_KEYS})`}>
          {icon('M12 4l3 3-3 3M15 7H7.5a4 4 0 000 8H10')}
        </button>
      </div>
    </div>
  )
}

const WIDE = '(min-width: 1024px)'
let wideQuery: MediaQueryList | null = null
const wideQ = () => (wideQuery ??= window.matchMedia(WIDE))
/** Whether the screen is wide enough for the desktop layout (Tailwind's lg), following resizes. */
export function useWide(): boolean {
  return useSyncExternalStore(
    (on) => {
      wideQ().addEventListener('change', on)
      return () => wideQ().removeEventListener('change', on)
    },
    () => wideQ().matches,
    () => true,
  )
}
