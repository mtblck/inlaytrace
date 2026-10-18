/**
 * HD runs from the app (server/hd.ts): send the image in parts, run, fetch the
 * result in parts. Only called when someone chooses HD for an image; the free
 * app never talks to the server otherwise. Everything goes to this site's own
 * /api, so the app's CSP stays connect-src 'self'.
 */
import type { Settings } from '../engine/presets'

export type HdProgress = { stage: 'encoding' | 'uploading' | 'running' | 'downloading'; done: number; total: number }

export class HdError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/hd/${path}`, { credentials: 'same-origin', ...init })
  } catch {
    throw new HdError("Couldn't reach Inlay. Check your connection and try again.")
  }
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    const b = await res.json().catch(() => ({}))
    throw new HdError(b.error ?? `HD failed (${res.status}).`, b.code)
  }
  return (res.headers.get('content-type') ?? '').startsWith('application/json') ? res.json() : (new Uint8Array(await res.arrayBuffer()) as T)
}
const post = <T>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** The image exactly as the app traces it, as PNG, at its full size. */
export async function encodeFullSize(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

export type HdKind = 'trace' | 'upscale'

/**
 * Run an HD job on `bitmap` (as the app traces it): `trace` at full size with
 * `settings` (resolves to the SVG), or `upscale` 4× (resolves to a PNG).
 */
export async function hdRun(kind: HdKind, bitmap: ImageBitmap, settings: Settings | null, progress: (p: HdProgress) => void): Promise<Blob> {
  progress({ stage: 'encoding', done: 0, total: 1 })
  const png = await encodeFullSize(bitmap)
  const PART = 4 * 1024 * 1024
  const parts = Math.max(1, Math.ceil(png.size / PART))
  const { run } = await post<{ run: string; credits: number }>('start', { kind, width: bitmap.width, height: bitmap.height, parts, contentType: 'image/png', ...(settings ? { settings } : {}) })
  for (let i = 0; i < parts; i++) {
    progress({ stage: 'uploading', done: i, total: parts })
    await call(`upload?run=${run}&part=${i}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: png.slice(i * PART, (i + 1) * PART) })
  }
  progress({ stage: 'running', done: 0, total: 1 })
  const result = await post<{ parts: number; contentType: string }>('run', { run })
  const chunks: Uint8Array[] = []
  for (let i = 0; i < result.parts; i++) {
    progress({ stage: 'downloading', done: i, total: result.parts })
    chunks.push(await call<Uint8Array>(`result?run=${run}&part=${i}`))
  }
  return new Blob(chunks as BlobPart[], { type: result.contentType })
}
