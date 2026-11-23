/**
 * The phone's dock (below lg): a bar along the foot of the screen with the
 * yellow Mode button at its centre and two tools either side,
 * which follow the mode (Trace: Image, Type, Tune, Export; Edit: Select,
 * Nodes, Combine, Draw; Clean up: Crop, Brush, Erase, Levels). On a wide
 * screen the mode tabs, the tool rail and the sidebar do this instead.
 *
 * A slot may hold a few tools: tapping it picks its tool, and tapping it again
 * while it is picked lists the others just above it.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { MODE_LABEL, type WorkMode } from './Workspace'

/** Arrow keys, Home and End move focus between a menu's enabled items (the menu pattern's roving focus). */
function menuKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
  if (step === undefined && e.key !== 'Home' && e.key !== 'End') return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')]
  if (!items.length) return
  e.preventDefault()
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (at + step! + items.length) % items.length
  items[next].focus({ preventScroll: true })
}

/** One tool or view in a slot's list. */
export type DockItem = { id: string; label: string; icon: ReactNode; disabled?: string }

/** A slot either side of the Mode button. */
export type DockSlot = {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  /** Picks the slot's tool or view. */
  onSelect: () => void
  /** More tools under this slot, listed when it is tapped while active. */
  items?: DockItem[]
  /** The item in `items` that is in use. */
  current?: string
  onItem?: (id: string) => void
}

const svg = (children: ReactNode, size = 24) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
)

/** The dock's icons, drawn on a 24 px grid. */
export const DOCK_ICON = {
  image: svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 16l5-5 4 4 3-3 6 6" />
    </>,
  ),
  type: svg(
    <>
      <path className="f" d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 13l9 5 9-5" />
    </>,
  ),
  tune: svg(
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle className="f" cx="16" cy="6" r="2" />
      <circle className="f" cx="10" cy="12" r="2" />
      <circle className="f" cx="18" cy="18" r="2" />
    </>,
  ),
  export: svg(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />),
  select: svg(<path className="f" d="M5 3l14 8-6 2-3 6z" />),
  nodes: svg(
    <>
      <path d="M4 18C7 7 17 17 20 6" />
      <rect className="f" x="2.5" y="16.5" width="3" height="3" />
      <rect className="f" x="18.5" y="4.5" width="3" height="3" />
    </>,
  ),
  combine: svg(
    <>
      <circle className="f" cx="9" cy="12" r="6" fillOpacity="0.35" />
      <circle className="f" cx="15" cy="12" r="6" fillOpacity="0.35" />
    </>,
  ),
  draw: svg(
    <>
      <path className="f" d="M4 20h4L19 9l-4-4L4 16z" />
    </>,
  ),
  crop: svg(<path d="M6 2v16h16M2 6h16v16" />),
  brush: svg(
    <>
      <path className="f" d="M18 3l3 3-9 9-3-3z" />
      <path d="M9 12c-3 0-5 2-5 5 0 2-1 3-2 3 4 1 9 0 9-5" />
    </>,
  ),
  erase: svg(
    <>
      <path className="f" d="M14 4l6 6-9 9H7l-4-4z" />
      <path d="M11 20h10" />
    </>,
  ),
  levels: svg(<path d="M4 20V11M10 20V4M16 20v-8M22 20H2" />),
}

/** The Mode button's icon for each mode. */
const MODE_ICON: Record<WorkMode, ReactNode> = {
  trace: svg(
    <>
      <path d="M4 18c3-9 6-12 8-12s3 3 2 6-1 6 6 6" />
      <circle cx="4" cy="18" r="1.6" fill="currentColor" />
      <circle cx="20" cy="18" r="1.6" fill="currentColor" />
      <circle cx="12" cy="6" r="1.6" fill="currentColor" />
    </>,
    28,
  ),
  clean: svg(
    <>
      <path d="M14 4l6 6-8 8H6v-6z" />
      <path d="M4 21h16" />
    </>,
    28,
  ),
  edit: svg(
    <>
      <path d="M12 3l8 8-8 8-8-8z" />
      <circle cx="12" cy="3" r="1.4" fill="currentColor" />
      <circle cx="20" cy="11" r="1.4" fill="currentColor" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
      <circle cx="4" cy="11" r="1.4" fill="currentColor" />
    </>,
    28,
  ),
}

const MODE_HINT: Record<WorkMode, string> = { clean: 'Fix the pixels', trace: 'Pixels to shapes', edit: 'Change the shapes' }

export function Dock(p: { modes: WorkMode[]; mode: WorkMode; onMode: (m: WorkMode) => void; edited: boolean; slots: [DockSlot, DockSlot, DockSlot, DockSlot] }) {
  const [picking, setPicking] = useState(false)
  /** The slot whose list is open, by id. */
  const [list, setList] = useState<string | null>(null)
  const fab = useRef<HTMLButtonElement>(null)
  const nav = useRef<HTMLElement>(null)
  // Closing a menu by choosing from it hands focus back to the button that opened it (WCAG 2.4.3).
  const focusSlot = (id: string) => nav.current?.querySelector<HTMLElement>(`[data-dock-slot="${id}"]`)?.focus({ preventScroll: true })

  // Escape closes whichever is open; a new mode closes a list that belonged to the old one.
  useEffect(() => {
    if (!picking && !list) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setPicking(false)
      setList(null)
      fab.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [picking, list])
  useEffect(() => setList(null), [p.mode])
  // Opening a menu moves focus into it, onto the item in use, so a keyboard or screen reader lands there.
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const m = menu.current
    if (picking || list) (m?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ?? m?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)'))?.focus({ preventScroll: true })
  }, [picking, list])

  const open = p.slots.find((s) => s.id === list)
  const others = p.modes.filter((m) => m !== p.mode)

  const slot = (s: DockSlot) => (
    <button
      key={s.id}
      type="button"
      aria-pressed={s.active}
      aria-haspopup={s.items && s.items.length > 1 ? 'true' : undefined}
      aria-expanded={s.items && s.items.length > 1 ? list === s.id : undefined}
      onClick={() => {
        setPicking(false)
        if (s.active && s.items && s.items.length > 1) setList((l) => (l === s.id ? null : s.id))
        else {
          setList(null)
          s.onSelect()
        }
      }}
      className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 pt-2.5 text-[11.5px] ${s.active ? 'dock-on font-semibold text-ink' : 'font-medium text-ink-faint'}`}
      data-dock-slot={s.id}
    >
      {s.icon}
      <span className="flex items-center gap-0.5 truncate">
        {s.label}
        {s.items && s.items.length > 1 && (
          <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" className="opacity-60">
            <path d="M1.5 5.5L4 3l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        )}
      </span>
    </button>
  )

  return (
    <>
      {(picking || open) && (
        <div
          className={`fixed inset-0 z-40 lg:hidden ${picking ? 'bg-[#0d1613]/90' : ''}`}
          aria-hidden="true"
          onClick={() => {
            setPicking(false)
            setList(null)
          }}
        />
      )}

      {open?.items && (
        <div ref={menu} role="menu" aria-label={open.label} onKeyDown={menuKeys} className="fixed inset-x-3 bottom-[calc(var(--dock-h)+10px)] z-50 grid grid-cols-2 gap-1 rounded-xl border border-rule bg-paper p-1.5 shadow-lg lg:hidden" data-dock-list={open.id}>
          {open.items.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitemradio"
              aria-checked={open.current === it.id}
              disabled={!!it.disabled}
              title={it.disabled}
              onClick={() => {
                focusSlot(open.id)
                setList(null)
                open.onItem?.(it.id)
              }}
              className={`flex h-11 items-center gap-2.5 rounded-lg px-3 text-left text-[14px] disabled:cursor-not-allowed disabled:text-ink-faint ${open.current === it.id ? 'bg-accent-dim font-semibold text-accent' : 'text-ink hover:bg-paper-sunk'}`}
            >
              <span className="shrink-0">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}

      {picking && (
        <div ref={menu} role="menu" aria-label="Mode" onKeyDown={menuKeys} className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-h)+18px)] z-50 flex items-end justify-center gap-6 lg:hidden" data-mode-picker="">
          {p.modes.map((m) => (
            <button
              key={m}
              type="button"
              role="menuitemradio"
              aria-checked={m === p.mode}
              onClick={() => {
                fab.current?.focus({ preventScroll: true })
                setPicking(false)
                if (m !== p.mode) p.onMode(m)
              }}
              className={`pointer-events-auto flex w-24 flex-col items-center gap-1.5 text-center ${p.modes.length === 3 && m === p.mode ? 'mb-12' : ''}`}
            >
              <span className={`grid size-16 place-items-center rounded-full text-[#16201c] shadow-lg ${m === p.mode ? 'bg-mark ring-4 ring-white' : 'bg-[#f5f6f2]'}`}>{MODE_ICON[m]}</span>
              <span className="text-[14px] font-semibold text-white">
                {MODE_LABEL[m]}
                {m === 'edit' && p.edited && <span className="sr-only"> (edited)</span>}
              </span>
              <span className="text-[11.5px] leading-tight text-[#b3c0b8]">{MODE_HINT[m]}</span>
            </button>
          ))}
        </div>
      )}

      <nav ref={nav} aria-label="Tools" className="dock fixed inset-x-0 bottom-0 z-40 flex lg:hidden" data-dock={p.mode}>
        {slot(p.slots[0])}
        {slot(p.slots[1])}
        <div className="relative w-[84px] shrink-0">
          <button
            ref={fab}
            type="button"
            aria-haspopup="menu"
            aria-expanded={picking}
            aria-label={`Mode: ${MODE_LABEL[p.mode]}`}
            title={others.length ? `Switch to ${others.map((m) => MODE_LABEL[m]).join(' or ')}` : undefined}
            onClick={() => {
              setList(null)
              setPicking((v) => !v)
            }}
            className={`dock-fab absolute top-[14px] left-1/2 grid size-[62px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full ${picking ? 'bg-ink text-paper' : 'bg-mark text-[#16201c]'}`}
            data-mode-button=""
          >
            {picking
              ? svg(<path d="M6 6l12 12M18 6L6 18" />, 26)
              : MODE_ICON[p.mode]}
          </button>
        </div>
        {slot(p.slots[2])}
        {slot(p.slots[3])}
      </nav>
    </>
  )
}

/**
 * The header's ⋯ menu on a phone: the theme, and the links the sidebar's footer
 * line holds on a wide screen.
 */
export function MoreMenu(p: { theme: 'light' | 'dark'; onTheme: () => void; supportUrl: string }) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      button.current?.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])
  const item = 'flex h-11 w-full items-center px-4 text-left text-[14px] text-ink hover:bg-paper-sunk'
  return (
    <div className="relative lg:hidden">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More"
        onClick={() => setOpen((v) => !v)}
        className="grid size-9 place-items-center rounded-md text-ink-muted hover:bg-paper-sunk hover:text-ink"
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.7" />
          <circle cx="12" cy="12" r="1.7" />
          <circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setOpen(false)} />
          <div ref={list} role="menu" aria-label="More" onKeyDown={menuKeys} className="absolute top-11 right-0 z-50 w-56 overflow-hidden rounded-lg border border-rule bg-paper py-1 shadow-lg">
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false)
                p.onTheme()
              }}
            >
              {p.theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
            </button>
            <a role="menuitem" className={item} href="/docs/overview/">
              Docs
            </a>
            <a role="menuitem" className={item} href="/privacy/">
              Privacy
            </a>
            <a role="menuitem" className={item} href="https://github.com/mtblck/inlaytrace">
              Source
            </a>
            <a role="menuitem" className={item} href={p.supportUrl} target="_blank" rel="noopener">
              Support Inlay
            </a>
          </div>
        </>
      )}
    </div>
  )
}
