import { useCallback, useState } from 'react'

type Theme = 'light' | 'dark'

/** public/theme.js sets the initial theme before paint; this keeps it in sync after. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark'
      if (next === 'dark') document.documentElement.dataset.theme = 'dark'
      else delete document.documentElement.dataset.theme
      try {
        localStorage.setItem('theme', next)
      } catch {
        /* private mode: the toggle still works for this visit */
      }
      return next
    })
  }, [])
  return { theme, toggle }
}
