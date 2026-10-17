/**
 * The current session, kept in this browser's IndexedDB so a reload or a
 * closed tab doesn't lose work: the original image file, the trace settings
 * and the edits. It never leaves the device, and "Start over" deletes it.
 *
 * Two records: the image (written once per opened image, and only after it
 * has traced, so an image that can't be traced is never brought back) and
 * the state (settings and edits, rewritten as you work). They share an id, so
 * a state is only restored onto the image it belongs to.
 *
 * Every call is best-effort. IndexedDB can be missing or refuse (private
 * windows, storage full, blocked site data); the app then works as before.
 */
import { PRESETS, settingsFor, type Settings } from '../engine/presets'
import { normalizeHex } from './svg'
import type { Doc, Edits } from './doc'

const VERSION = 1
export type SavedImage = { v: number; id: string; file: Blob; name: string }
export type SavedState = { v: number; id: string; settings: Settings; edits: Edits }

const DB = 'img-to-svg'
const STORE = 'session'

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

/** Run one request; undefined if storage refused. `ok` is true when the transaction committed. */
async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<{ ok: boolean; result?: T }> {
  try {
    const db = await open()
    try {
      const result = await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = f(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req.result)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
      return { ok: true, result }
    } finally {
      db.close()
    }
  } catch {
    return { ok: false }
  }
}

export const newSessionId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
export const saveImage = async (image: Omit<SavedImage, 'v'>) => (await run('readwrite', (s) => s.put({ v: VERSION, ...image }, 'image'))).ok
export const saveState = async (state: Omit<SavedState, 'v'>) => (await run('readwrite', (s) => s.put({ v: VERSION, ...state }, 'state'))).ok
export const clearSession = async () => {
  await run('readwrite', (s) => s.delete('image'))
  await run('readwrite', (s) => s.delete('state'))
}

/** The saved image and its state, checked and filled in; null if there's nothing usable. */
export async function loadSession(): Promise<{ image: SavedImage; settings: Settings; edits: Edits } | null> {
  const img = (await run('readonly', (s) => s.get('image') as IDBRequest<unknown>)).result as SavedImage | undefined
  if (!img || img.v !== VERSION || !(img.file instanceof Blob) || typeof img.name !== 'string' || typeof img.id !== 'string') return null
  const st = (await run('readonly', (s) => s.get('state') as IDBRequest<unknown>)).result as SavedState | undefined
  const usable = st && st.v === VERSION && st.id === img.id
  return { image: img, settings: checkSettings(usable ? st.settings : null), edits: checkEdits(usable ? st.edits : null) }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/** A saved preset's defaults, overlaid with whatever saved fields have the right type. */
export function checkSettings(x: unknown): Settings {
  const preset = isObj(x) && PRESETS.some((p) => p.id === x.preset) ? (x.preset as Settings['preset']) : 'logo'
  const out = settingsFor(preset)
  if (!isObj(x)) return out
  for (const k of ['colors', 'speckle', 'smoothing', 'corners'] as const) if (typeof x[k] === 'number' && Number.isFinite(x[k])) out[k] = x[k] as number
  if (x.threshold === null || typeof x.threshold === 'number') out.threshold = x.threshold as number | null
  if (typeof x.lightInk === 'boolean') out.lightInk = x.lightInk
  if (x.shapes === 'stacked' || x.shapes === 'cutout') out.shapes = x.shapes
  if (isObj(x.merge)) out.merge = Object.fromEntries(Object.entries(x.merge).filter(([a, b]) => normalizeHex(a) && typeof b === 'string' && normalizeHex(b)) as [string, string][])
  return out
}

/** Saved edits with anything malformed dropped (it would become markup or file contents). */
export function checkEdits(x: unknown): Edits {
  const empty: Edits = { inks: { recolor: {}, removed: [] }, doc: null, background: null }
  if (!isObj(x)) return empty
  const inks = isObj(x.inks) ? x.inks : {}
  const recolor = isObj(inks.recolor) ? Object.fromEntries(Object.entries(inks.recolor).filter(([a, b]) => normalizeHex(a) && typeof b === 'string' && normalizeHex(b)) as [string, string][]) : {}
  const removed = Array.isArray(inks.removed) ? inks.removed.filter((h): h is string => typeof h === 'string' && !!normalizeHex(h)) : []
  const background = typeof x.background === 'string' ? normalizeHex(x.background) : null
  let doc: Doc | null = null
  const d = x.doc
  if (isObj(d) && typeof d.width === 'number' && typeof d.height === 'number' && Array.isArray(d.paths)) {
    const paths = d.paths.filter((p): p is Doc['paths'][number] => isObj(p) && typeof p.id === 'string' && typeof p.d === 'string' && typeof p.fill === 'string')
    doc = { width: d.width, height: d.height, paths }
  }
  return { inks: { recolor, removed }, doc, background }
}
