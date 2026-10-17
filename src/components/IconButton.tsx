import type { ReactNode } from 'react'

const base = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true } as const

// The same sun and moon as Boards and the portfolio, so the three read as one site.
export const MoonIcon = () => (
  <svg {...base}>
    <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z" strokeLinejoin="round" />
  </svg>
)
export const SunIcon = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" strokeLinecap="round" />
  </svg>
)
export const KeyboardIcon = () => (
  <svg {...base}>
    <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" />
    <path d="M4 6.75h.01M6.5 6.75h.01M9 6.75h.01M11.5 6.75h.01M5 10h6" strokeLinecap="round" />
  </svg>
)

/**
 * A quiet square icon button with a tooltip that shows on hover and on
 * keyboard focus (a native `title` only shows on hover, after a delay). The
 * accessible name comes from `label`; the tooltip is the same text for sight.
 */
export function IconButton({ label, hint, onClick, children, ...rest }: { label: string; hint?: string; onClick: () => void; children: ReactNode; 'aria-keyshortcuts'?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="group relative grid size-9 place-items-center rounded-md text-ink-muted hover:bg-paper-sunk hover:text-ink" {...rest}>
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 rounded bg-ink px-2 py-1 text-[12px] whitespace-nowrap text-paper opacity-0 shadow-sm transition-opacity delay-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {hint ?? label}
      </span>
    </button>
  )
}
