/// <reference lib="webworker" />
/**
 * Optional AI steps before tracing, in a worker of their own: background
 * removal (U²-Net small) and 4× upscaling (Real-ESRGAN general v3). Both run
 * here, in the browser, with ONNX Runtime's WebAssembly backend; the image
 * never leaves the device. The runtime (about 3.7 MB compressed) and each
 * model (about 4.5 MB) are fetched from this site the first time a step is
 * used, then cached by the browser.
 *
 * Licences: ONNX Runtime MIT; U²-Net Apache 2.0; Real-ESRGAN BSD 3-Clause
 * (public/models/NOTICE.txt).
 */
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { maskFrom, u2Input, upscaleTiles } from './prepCore'

export type PrepRequest = { type: 'prep'; id: number; rgba: ArrayBuffer; width: number; height: number; background: boolean; upscale: boolean }
export type PrepStage = 'runtime' | 'background' | 'upscale'
export type PrepResponse =
  | { type: 'progress'; id: number; stage: PrepStage; done: number; total: number }
  | { type: 'prepared'; id: number; rgba: ArrayBuffer; width: number; height: number }
  | { type: 'error'; id: number; message: string }

declare const self: DedicatedWorkerGlobalScope

// One thread: more would need cross-origin isolation (SharedArrayBuffer).
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false
ort.env.wasm.wasmPaths = { wasm: wasmUrl }

const MODELS = `${import.meta.env.BASE_URL}models/`
const sessions = new Map<string, Promise<ort.InferenceSession>>()

/** A model's session, fetched (with progress) and built once. */
function session(file: string, stage: PrepStage, id: number) {
  let s = sessions.get(file)
  if (!s) {
    s = fetchBytes(MODELS + file, (done, total) => post({ type: 'progress', id, stage, done, total })).then((bytes) => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
    s.catch(() => sessions.delete(file))
    sessions.set(file, s)
  }
  return s
}

async function fetchBytes(url: string, progress: (done: number, total: number) => void) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Couldn't load ${url.split('/').pop()} (${res.status}).`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const parts: Uint8Array[] = []
  let done = 0
  for (;;) {
    const r = await reader.read()
    if (r.done) break
    parts.push(r.value)
    done += r.value.length
    progress(done, total)
  }
  const out = new Uint8Array(done)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

self.onmessage = async (event: MessageEvent<PrepRequest>) => {
  const req = event.data
  try {
    let rgba = new Uint8ClampedArray(req.rgba)
    let { width, height } = req
    // The mask comes from the image as given; upscaling then scales it too.
    const mask = req.background ? await removeBackground(rgba, width, height, req.id) : null
    if (req.upscale) {
      const up = await upscale(rgba, width, height, req.id)
      rgba = up.rgba
      width = up.width
      height = up.height
    }
    if (mask) {
      const alpha = await resizeGray(mask.data, mask.width, mask.height, width, height)
      for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = Math.min(rgba[i * 4 + 3], alpha[i])
    }
    post({ type: 'prepared', id: req.id, rgba: rgba.buffer as ArrayBuffer, width, height }, [rgba.buffer as ArrayBuffer])
  } catch (error) {
    post({ type: 'error', id: req.id, message: error instanceof Error ? error.message : String(error) })
  }
}

const post = (message: PrepResponse, transfer: Transferable[] = []) => self.postMessage(message, transfer)

// ---- Background removal ---------------------------------------------------------

const U2 = 320

/**
 * U²-Net's saliency map as an alpha mask, 320 × 320 (the caller scales it).
 * Preprocessing follows rembg's (u2Input); the first output, stretched to
 * 0–1, is the mask. The model sees the colours under any existing
 * transparency, as rembg does, not black.
 */
async function removeBackground(rgba: Uint8ClampedArray, width: number, height: number, id: number) {
  const s = await session('u2netp.onnx', 'background', id)
  post({ type: 'progress', id, stage: 'background', done: 0, total: 0 })
  const opaque = new Uint8ClampedArray(rgba)
  for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255
  const small = await resize(opaque, width, height, U2, U2)
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', u2Input(small, U2), [1, 3, U2, U2]) })
  return { data: maskFrom(out[s.outputNames[0]].data as Float32Array), width: U2, height: U2 }
}

// ---- Upscaling --------------------------------------------------------------------

/**
 * Real-ESRGAN ×4, in tiles with a margin (prepCore.ts), so seams don't show.
 * Alpha is scaled smoothly on its own; the network only sees colour.
 */
async function upscale(rgba: Uint8ClampedArray, width: number, height: number, id: number) {
  const s = await session('realesr-general-x4v3.onnx', 'upscale', id)
  const run = async (input: Float32Array, tw: number, th: number) => (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, th, tw]) }))[s.outputNames[0]].data as Float32Array
  post({ type: 'progress', id, stage: 'upscale', done: 0, total: 1 })
  const out = await upscaleTiles(rgba, width, height, run, (done, total) => post({ type: 'progress', id, stage: 'upscale', done, total }))
  const W = width * 4
  const H = height * 4
  const alpha = new Uint8ClampedArray(width * height)
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3]
  const big = await resizeGray(alpha, width, height, W, H)
  for (let i = 0; i < W * H; i++) out[i * 4 + 3] = big[i]
  return { rgba: out, width: W, height: H }
}

// ---- Resizing ---------------------------------------------------------------------

async function resize(rgba: Uint8ClampedArray, w: number, h: number, W: number, H: number) {
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), w, h))
  const c = new OffscreenCanvas(W, H)
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.imageSmoothingQuality = 'high'
  x.drawImage(bitmap, 0, 0, W, H)
  return x.getImageData(0, 0, W, H).data
}

async function resizeGray(v: Uint8ClampedArray, w: number, h: number, W: number, H: number) {
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) rgba.set([v[i], v[i], v[i], 255], i * 4)
  const big = await resize(rgba, w, h, W, H)
  const out = new Uint8ClampedArray(W * H)
  for (let i = 0; i < out.length; i++) out[i] = big[i * 4]
  return out
}
