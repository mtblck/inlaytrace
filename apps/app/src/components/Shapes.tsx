/**
 * Shapes and their style (#209), in Edit mode's panel.
 *
 * The Shapes list finds shapes too small to click: every shape, by colour (as
 * the Colours list groups them) or by group, in paint order or by size. A row
 * selects its shape; its eye hides it and its padlock locks it while you work.
 * Hidden and locked are editing state only (`Edits.hidden`, `Edits.locked`),
 * so both export as usual.
 *
 * A trace can have thousands of shapes, so a section lists its rows only once
 * opened, a page at a time, and sizes are measured only for open sections
 * (and kept per path data).
 *
 * Fill and stroke sets the selection's own fill, outline and opacity. A fill
 * of its own takes a shape out of its ink, into one of that colour.
 */
import { memo, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { ShownPath } from '../lib/doc'
import { pathBounds, type Box } from '../lib/transform'
import type { SelectMode } from './Canvas'
import { Section, Slider } from './Controls'

export type ShapeFlag = 'hidden' | 'locked'
export type StylePatch = { fill?: string; stroke?: number | null; opacity?: number }

/** Shapes listed at a time in one section; more on request. */
const PAGE = 100

// Bounds by path data, so a re-render (every edit makes new path objects) doesn't measure again.
const boundsCache = new Map<string, Box | null>()
function boundsOf(d: string) {
  let b = boundsCache.get(d)
  if (b === undefined) {
    if (boundsCache.size > 50000) boundsCache.clear()
    b = pathBounds(d)
    boundsCache.set(d, b)
  }
  return b
}
const areaOf = (d: string) => {
  const b = boundsOf(d)
  return b ? b.w * b.h : 0
}

type Group = { key: string; label: string; swatch: string | null; ids: string[] }

export function ShapesList(p: {
  /** Every shape, hidden ones too, in paint order (back to front). */
  paths: ShownPath[]
  hidden: ReadonlySet<string>
  locked: ReadonlySet<string>
  selected: ReadonlySet<string>
  onSelect: (id: string, how: SelectMode) => void
  onFlag: (flag: ShapeFlag, ids: string[], on: boolean) => void
}) {
  const [by, setBy] = useState<'colour' | 'group'>('colour')
  const [sort, setSort] = useState<'order' | 'size'>('order')
  const [open, setOpen] = useState<Record<string, number>>({})
  // A section's order by size, worked out once per list of shapes, not every render.
  const sizeOrder = useMemo(() => new Map<string, string[]>(), [p.paths, by])
  const byId = useMemo(() => new Map(p.paths.map((s, i) => [s.id, { s, n: i + 1 }])), [p.paths])

  const groups = useMemo(() => {
    const out = new Map<string, Group>()
    for (const s of p.paths) {
      const key = by === 'colour' ? s.fill : (s.group ?? '')
      let g = out.get(key)
      if (!g) {
        g = by === 'colour' ? { key, label: s.fill, swatch: s.fill, ids: [] } : { key, label: key ? `Group ${key.slice(1)}` : 'Not grouped', swatch: null, ids: [] }
        out.set(key, g)
      }
      g.ids.push(s.id)
    }
    // Biggest first, as the Colours list; "Not grouped" last.
    return [...out.values()].sort((a, b) => (by === 'group' && (!a.key || !b.key) ? (a.key ? -1 : 1) : b.ids.length - a.ids.length))
  }, [p.paths, by])

  const anyHidden = p.hidden.size > 0
  const anyLocked = p.locked.size > 0
  return (
    <Section title={`Shapes (${p.paths.length})`}>
      <div className="space-y-3" data-shapes="">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12.5px]">
          <Toggle label="List by" value={by} options={[['colour', 'Colour'], ['group', 'Group']]} onChange={setBy} />
          <Toggle label="Order" value={sort} options={[['order', 'Paint order'], ['size', 'Size']]} onChange={setSort} />
        </div>
        <ul className="divide-y divide-rule-soft rounded-md border border-rule">
          {groups.map((g) => {
            const shown = open[g.key] ?? 0
            let ids = g.ids
            if (shown && sort === 'size') {
              let sorted = sizeOrder.get(g.key)
              if (!sorted) sizeOrder.set(g.key, (sorted = [...g.ids].sort((a, b) => areaOf(byId.get(b)!.s.d) - areaOf(byId.get(a)!.s.d))))
              ids = sorted
            }
            const allHidden = g.ids.every((id) => p.hidden.has(id))
            const allLocked = g.ids.every((id) => p.locked.has(id))
            return (
              <li key={`${by}-${g.key}`} data-shape-group={g.label}>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px]"
                    aria-expanded={shown > 0}
                    onClick={() => setOpen((o) => ({ ...o, [g.key]: shown ? 0 : PAGE }))}
                  >
                    <span aria-hidden="true" className={`text-ink-muted transition-transform ${shown ? 'rotate-90' : ''}`}>
                      ›
                    </span>
                    {g.swatch && <span aria-hidden="true" className="size-3.5 shrink-0 rounded-sm border border-rule" style={{ background: g.swatch }} />}
                    <span className={`truncate ${g.swatch ? 'num' : ''}`}>{g.label}</span>
                    <span className="num shrink-0 text-ink-muted">{g.ids.length}</span>
                  </button>
                  <FlagButton flag="hidden" on={allHidden} what={`all ${g.ids.length} in ${g.label}`} onClick={() => p.onFlag('hidden', g.ids, !allHidden)} />
                  <FlagButton flag="locked" on={allLocked} what={`all ${g.ids.length} in ${g.label}`} onClick={() => p.onFlag('locked', g.ids, !allLocked)} />
                </div>
                {shown > 0 && (
                  <ul className="border-t border-rule-soft bg-paper-sunk/50 pb-1">
                    {ids.slice(0, shown).map((id) => {
                      const { s, n } = byId.get(id)!
                      return <ShapeRow key={id} id={id} n={n} d={s.d} fill={s.fill} hidden={p.hidden.has(id)} locked={p.locked.has(id)} selected={p.selected.has(id)} onSelect={p.onSelect} onFlag={p.onFlag} />
                    })}
                    {ids.length > shown && (
                      <li className="px-2 pt-1">
                        <button className="text-[12.5px] text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setOpen((o) => ({ ...o, [g.key]: shown + PAGE * 2 }))}>
                          Show {Math.min(PAGE * 2, ids.length - shown)} more of {ids.length - shown}
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
        {(anyHidden || anyLocked) && (
          <div className="flex gap-2">
            {anyHidden && (
              <button className="btn grow" onClick={() => p.onFlag('hidden', [...p.hidden], false)}>
                Show all
              </button>
            )}
            {anyLocked && (
              <button className="btn grow" onClick={() => p.onFlag('locked', [...p.locked], false)}>
                Unlock all
              </button>
            )}
          </div>
        )}
        <p className="field-hint">Click a shape to select it, ⇧ or {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}-click to add it. Hidden and locked shapes still export.</p>
      </div>
    </Section>
  )
}

// One row a shape; memoised, since an edit elsewhere re-renders the list.
const ShapeRow = memo(function ShapeRow(p: {
  id: string
  n: number
  d: string
  fill: string
  hidden: boolean
  locked: boolean
  selected: boolean
  onSelect: (id: string, how: SelectMode) => void
  onFlag: (flag: ShapeFlag, ids: string[], on: boolean) => void
}) {
  const b = boundsOf(p.d)
  const off = p.hidden || p.locked
  return (
    <li className={`flex items-center gap-2 pr-2 pl-6 ${p.selected ? 'bg-accent-dim' : ''}`} data-shape-row={p.id}>
      <button
        className={`flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[12.5px] ${off ? 'text-ink-muted' : ''}`}
        aria-pressed={p.selected}
        disabled={off}
        title={off ? `${p.hidden ? 'Hidden' : 'Locked'}: ${p.hidden ? 'show' : 'unlock'} it to select it` : undefined}
        onClick={(e: MouseEvent) => p.onSelect(p.id, e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'set')}
      >
        <span aria-hidden="true" className="size-3 shrink-0 rounded-sm border border-rule" style={{ background: p.fill }} />
        <span>Shape {p.n}</span>
        {b && (
          <span className="num ml-auto text-ink-muted">
            {Math.max(1, Math.round(b.w))}×{Math.max(1, Math.round(b.h))}
          </span>
        )}
      </button>
      <FlagButton flag="hidden" on={p.hidden} what={`shape ${p.n}`} onClick={() => p.onFlag('hidden', [p.id], !p.hidden)} />
      <FlagButton flag="locked" on={p.locked} what={`shape ${p.n}`} onClick={() => p.onFlag('locked', [p.id], !p.locked)} />
    </li>
  )
})

const EYE = 'M1.5 9s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5zM9 11a2 2 0 100-4 2 2 0 000 4z'
const EYE_OFF = 'M2.5 2.5l13 13M7.2 4.3A7.7 7.7 0 019 4c4.8 0 7.5 5 7.5 5a12 12 0 01-2 2.6M11 13.6A7 7 0 019 14c-4.8 0-7.5-5-7.5-5a12 12 0 012.9-3.3'
const LOCK = 'M4.5 8h9v7.5h-9zM6.5 8V5.5a2.5 2.5 0 015 0V8'
const UNLOCK = 'M4.5 8h9v7.5h-9zM6.5 8V5.5a2.5 2.5 0 014.9-.7'

/** The label says what a click does ("Show shape 3"), so it isn't also a pressed toggle, which would read as the opposite. */
function FlagButton(p: { flag: ShapeFlag; on: boolean; what: string; onClick: () => void }) {
  const label = p.flag === 'hidden' ? (p.on ? `Show ${p.what}` : `Hide ${p.what}`) : p.on ? `Unlock ${p.what}` : `Lock ${p.what}`
  const d = p.flag === 'hidden' ? (p.on ? EYE_OFF : EYE) : p.on ? LOCK : UNLOCK
  return (
    <button className={`grid size-6 shrink-0 place-items-center rounded hover:bg-paper-sunk ${p.on ? 'text-ink' : 'text-ink-faint hover:text-ink'}`} aria-label={label} title={label} onClick={p.onClick} data-flag={p.flag} data-on={p.on ? '' : undefined}>
      <svg aria-hidden="true" width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  )
}

function Toggle<T extends string>(p: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-ink-muted">{p.label}</span>
      <div role="radiogroup" aria-label={p.label} className="flex gap-px overflow-hidden rounded-md border border-rule bg-rule">
        {p.options.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={p.value === v} className={`px-2 py-0.5 ${p.value === v ? 'bg-ink text-paper' : 'bg-paper hover:bg-paper-sunk'}`} onClick={() => p.onChange(v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The selection's fill, outline and opacity. Shared values show; mixed ones say so. */
export function StyleFields(p: { paths: ShownPath[]; defaultStroke: number; onStyle: (patch: StylePatch, key: string) => void }) {
  const seq = useRef(0)
  const key = (k: string) => `style-${k}-${seq.current}`
  const done = () => seq.current++
  const same = <T,>(f: (s: ShownPath) => T) => {
    const v = f(p.paths[0])
    return p.paths.every((s) => f(s) === v) ? v : undefined
  }
  const fill = same((s) => s.fill)
  const stroke = same((s) => s.stroke ?? 0)
  const opacity = same((s) => s.opacity ?? 1)
  const n = p.paths.length
  return (
    <Section title="Fill and stroke">
      <div className="space-y-3" data-style-fields="" onPointerUp={done} onKeyUp={done} onBlur={done}>
        <div className="flex items-center gap-2">
          <input type="color" className="size-8 shrink-0 cursor-pointer rounded border border-rule" value={fill ?? '#000000'} onChange={(e) => p.onStyle({ fill: e.target.value }, key('fill'))} aria-label="Fill colour" />
          <span className="num grow text-[13px]" data-style-fill="">
            {fill ?? 'Mixed'}
          </span>
        </div>
        <p className="field-hint">A colour of its own takes {n === 1 ? 'the shape' : 'the shapes'} out of {n === 1 ? 'its' : 'their'} colour in the list below, so recolouring that won’t change {n === 1 ? 'it' : 'them'}.</p>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={stroke !== undefined && stroke > 0}
            ref={(el) => {
              if (el) el.indeterminate = stroke === undefined
            }}
            onChange={(e) => {
              p.onStyle({ stroke: e.target.checked ? p.defaultStroke : null }, key('stroke-on'))
              done()
            }}
          />
          Outline only (a stroke, not filled)
        </label>
        {!!stroke && <StrokeWidth width={stroke} onWidth={(v) => p.onStyle({ stroke: v }, key('stroke'))} />}
        <Slider
          label="Opacity"
          value={Math.round((opacity ?? 1) * 100)}
          min={0}
          max={100}
          step={1}
          hint={opacity === undefined ? 'Mixed: a change sets them all.' : 'See-through shapes show what’s behind them, in the SVG and PNG too (PDF, EPS and DXF draw them solid).'}
          format={(v) => (opacity === undefined ? 'Mixed' : `${v}%`)}
          onChange={(v) => p.onStyle({ opacity: v / 100 }, key('opacity'))}
        />
      </div>
    </Section>
  )
}

/** The width as typed: a half-typed "0." stays on screen, and only a width above 0 is applied. */
function StrokeWidth(p: { width: number; onWidth: (v: number) => void }) {
  const shown = String(Math.round(p.width * 100) / 100)
  const [text, setText] = useState(shown)
  const applied = useRef(p.width)
  // The width changed elsewhere (undo): show it.
  if (applied.current !== p.width) {
    applied.current = p.width
    if (Number(text) !== p.width) setText(shown)
  }
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <span className="field-label">Stroke width</span>
      <input
        type="number"
        min={0.1}
        step={0.5}
        className="w-20 rounded-md border border-rule bg-paper px-2 py-1 font-mono text-[13px]"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() && Number.isFinite(v) && v > 0) {
            applied.current = v
            p.onWidth(v)
          }
        }}
        onBlur={() => setText(String(Math.round(p.width * 100) / 100))}
        aria-label="Stroke width"
      />
      <span className="text-ink-muted">px</span>
    </label>
  )
}

/** The Fill tool's panel: what a click does, the colour, and why the last click did nothing. */
export function BucketFields(p: { colour: string; onColour: (hex: string) => void; inks: string[]; busy: boolean; error: string | null }) {
  const swatches = [...new Set(p.inks.map((h) => h.toLowerCase()))].slice(0, 16)
  return (
    <div className="space-y-3" data-bucket-fields="">
      <p className="field-hint">
        Click a shape to fill it with this colour, or click between shapes (inside an outline traced as Line art, say) to fill the area they enclose, behind the lines. A
        break in a hand-drawn line lets the fill run into the next area.
      </p>
      <div className="flex items-center gap-2">
        <input type="color" className="size-8 shrink-0 cursor-pointer rounded border border-rule" value={p.colour} onChange={(e) => p.onColour(e.target.value)} aria-label="Fill tool colour" />
        <span className="num grow text-[13px]">{p.colour}</span>
        <span className="text-[12.5px] text-ink-muted" role="status">{p.busy ? 'Filling…' : ''}</span>
      </div>
      {swatches.length > 0 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Fill with a colour from the drawing">
          {swatches.map((hex) => (
            <button
              key={hex}
              className={`size-6 rounded border ${hex === p.colour.toLowerCase() ? 'border-ink ring-1 ring-ink' : 'border-rule'}`}
              style={{ background: hex }}
              title={hex}
              aria-label={`Fill with ${hex}`}
              aria-pressed={hex === p.colour.toLowerCase()}
              onClick={() => p.onColour(hex)}
            />
          ))}
        </div>
      )}
      {p.error && (
        <p role="alert" className="text-[12.5px] text-accent" data-bucket-error="">
          {p.error}
        </p>
      )}
    </div>
  )
}
