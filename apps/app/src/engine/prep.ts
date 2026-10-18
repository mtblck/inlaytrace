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
 * U²-Net's saliency map as an alpha mask, at the image's size. Preprocessing
 * follows rembg's: 320 × 320, scaled by the brightest value, then ImageNet's
 * mean and deviation; the first output, stretched to 0–1, is the mask.
 */
async function removeBackground(rgba: Uint8ClampedArray, width: number, height: number, id: number) {
  const s = await session('u2netp.onnx', 'background', id)
  post({ type: 'progress', id, stage: 'background', done: 0, total: 0 })
  const small = await resize(rgba, width, height, U2, U2)
  let max = 1
  for (let i = 0; i < U2 * U2; i++) for (let c = 0; c < 3; c++) max = Math.max(max, small[i * 4 + c])
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const input = new Float32Array(3 * U2 * U2)
  for (let c = 0; c < 3; c++) for (let i = 0; i < U2 * U2; i++) input[c * U2 * U2 + i] = (small[i * 4 + c] / max - mean[c]) / std[c]
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, U2, U2]) })
  const pred = out[s.outputNames[0]].data as Float32Array
  let lo = Infinity
  let hi = -Infinity
  for (const v of pred) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const data = new Uint8ClampedArray(U2 * U2)
  for (let i = 0; i < data.length; i++) data[i] = Math.round(((pred[i] - lo) / (hi - lo || 1)) * 255)
  return { data, width: U2, height: U2 }
}

// ---- Upscaling --------------------------------------------------------------------

const TILE = 96
const PAD = 8

/**
 * Real-ESRGAN ×4, in tiles (each with a margin, so seams don't show), RGB in
 * 0–1. Alpha is scaled smoothly on its own; the network only sees colour.
 */
async function upscale(rgba: Uint8ClampedArray, width: number, height: number, id: number) {
  const s = await session('realesr-general-x4v3.onnx', 'upscale', id)
  const W = width * 4
  const H = height * 4
  const out = new Uint8ClampedArray(W * H * 4)
  const tiles: [number, number][] = []
  for (let ty = 0; ty < height; ty += TILE) for (let tx = 0; tx < width; tx += TILE) tiles.push([tx, ty])
  let done = 0
  post({ type: 'progress', id, stage: 'upscale', done, total: tiles.length })
  for (const [tx, ty] of tiles) {
    const x0 = Math.max(0, tx - PAD)
    const y0 = Math.max(0, ty - PAD)
    const x1 = Math.min(width, tx + TILE + PAD)
    const y1 = Math.min(height, ty + TILE + PAD)
    const tw = x1 - x0
    const th = y1 - y0
    const input = new Float32Array(3 * tw * th)
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        const o = ((y0 + y) * width + x0 + x) * 4
        for (let c = 0; c < 3; c++) input[c * tw * th + y * tw + x] = rgba[o + c] / 255
      }
    const res = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, th, tw]) })
    const pred = res[s.outputNames[0]].data as Float32Array
    const pw = tw * 4
    const ph = th * 4
    // Copy only the tile's own area, not its margin.
    for (let y = (ty - y0) * 4; y < (Math.min(height, ty + TILE) - y0) * 4; y++)
      for (let x = (tx - x0) * 4; x < (Math.min(width, tx + TILE) - x0) * 4; x++) {
        const o = ((y0 * 4 + y) * W + x0 * 4 + x) * 4
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(1, Math.max(0, pred[c * pw * ph + y * pw + x])) * 255)
      }
    post({ type: 'progress', id, stage: 'upscale', done: ++done, total: tiles.length })
  }
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
