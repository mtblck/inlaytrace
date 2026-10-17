/**
 * Undo/redo as a stack of immutable snapshots.
 *
 * Snapshots rather than inverse operations: every edit already produces a new
 * immutable state, unchanged paths are shared between snapshots, and there is
 * no inverse of a boolean union to get wrong.
 *
 * `key` coalesces bursts into one step. A node drag sends dozens of updates
 * and a colour picker one per pixel of mouse travel; each burst passes the same
 * key, so one Undo puts back the state from before it started. Any undo, redo
 * or differently-keyed push ends the burst.
 */
export const HISTORY_LIMIT = 100

export type History<T> = { past: T[]; present: T; future: T[]; key: string | null }

export const startHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], key: null })

export function push<T>(h: History<T>, next: T, key: string | null = null): History<T> {
  if (next === h.present) return h
  if (key !== null && key === h.key) return { ...h, present: next, future: [] }
  const past = [...h.past, h.present]
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT)
  return { past, present: next, future: [], key }
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return { ...h, key: null }
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], key: null }
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return { ...h, key: null }
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), key: null }
}
