import { useEffect, useState } from 'react'

/**
 * useState that remembers its value in localStorage, for per-viewer
 * conveniences only (overlay colours). Storage can be missing or throw
 * (private mode, blocked site data), so every access is guarded and the
 * default always works.
 */
export function usePersisted<T extends object>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* unavailable: the setting just lasts for this visit */
    }
  }, [key, value])
  return [value, setValue] as const
}
