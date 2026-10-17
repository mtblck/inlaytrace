/**
 * The current session, kept in this browser's IndexedDB so a reload or a
 * closed tab doesn't lose work: the original image file, the trace settings
 * and the edits. It never leaves the device, and "Start over" deletes it.
 *
 * Every call is best-effort. IndexedDB can be missing or refuse (private
 * windows, storage full, blocked site data); the app then simply works as
 * before, without saving.
 */
import type { Settings } from '../engine/presets'
import type { Edits } from './doc'

export type Saved = { file: Blob; name: string; settings: Settings; edits: Edits; savedAt: number }

const DB = 'img-to-svg'
const STORE = 'session'
const KEY = 'current'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('blocked'))
  })
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open()
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = f(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
}

export const loadSession = () => run<Saved | undefined>('readonly', (s) => s.get(KEY) as IDBRequest<Saved | undefined>)
export const saveSession = (saved: Saved) => run('readwrite', (s) => s.put(saved, KEY))
export const clearSession = () => run('readwrite', (s) => s.delete(KEY))

/** A restored session is only used if it has the shape this version writes. */
export function isSaved(x: unknown): x is Saved {
  const s = x as Saved
  return !!s && s.file instanceof Blob && typeof s.name === 'string' && !!s.settings && typeof s.settings.preset === 'string' && !!s.edits && !!s.edits.inks
}
