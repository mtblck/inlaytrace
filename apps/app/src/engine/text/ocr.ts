/**
 * Finding and reading text, in the AI worker: Tesseract's own WebAssembly
 * build (tesseract.js-core, Apache 2.0) with its English LSTM model
 * (tessdata_best, integer version, Apache 2.0), called directly rather than
 * through tesseract.js, which would start a worker of its own and fetch from
 * a CDN. Both files come from this site the first time the step is used.
 */
import TesseractCore, { type TessModule } from 'tesseract.js-core/tesseract-core-simd-lstm.js'
import wasmUrl from 'tesseract.js-core/tesseract-core-simd-lstm.wasm?url'
import { linesFromTsv, type OcrLine } from './match'

/** Below this long edge, the image is read at twice its size: Tesseract misses small text. */
const UPSCALE_BELOW = 1600
/** Tesseract's fully automatic page segmentation (PSM_AUTO). */
const PSM_AUTO = '3'
/** Tesseract's LSTM engine only (OEM_LSTM_ONLY): the build has no other. */
const OEM_LSTM = 1

/** Tesseract's own chatter ("Estimating resolution as …") goes nowhere, not to the console. */
const quiet = () => {}

let ready: Promise<{ m: TessModule; api: InstanceType<TessModule['TessBaseAPI']> }> | undefined

/** The engine and model, set up once; `model` is the traineddata file (gzipped or not). */
export function initOcr(model: () => Promise<Uint8Array>) {
  ready ??= (async () => {
    const [m, bytes] = await Promise.all([TesseractCore({ locateFile: () => wasmUrl, print: quiet, printErr: quiet }), model()])
    m.FS.writeFile('/eng.traineddata', await gunzipped(bytes))
    const api = new m.TessBaseAPI()
    if (api.Init('/', 'eng', OEM_LSTM) !== 0) throw new Error("Couldn't start text recognition.")
    api.SetVariable('tessedit_pageseg_mode', PSM_AUTO)
    return { m, api }
  })()
  ready.catch(() => (ready = undefined))
  return ready
}

async function gunzipped(bytes: Uint8Array) {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes // already unpacked on the way
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The words Tesseract reads in an image, line by line, with boxes in the image's pixels. */
export async function readText(rgba: Uint8ClampedArray, width: number, height: number): Promise<OcrLine[]> {
  if (!ready) throw new Error('Text recognition is not set up.')
  const { m, api } = await ready
  const scale = Math.max(width, height) < UPSCALE_BELOW ? 2 : 1
  m.FS.writeFile('/input', await png(rgba, width, height, scale))
  if (api.SetImageFile(1, 0) !== 0) throw new Error("Couldn't read the image for text.")
  api.Recognize(null)
  const tsv: string = api.GetTSVText(0)
  api.Clear()
  return linesFromTsv(tsv, scale)
}

/** The image as PNG for Tesseract, over white (it reads transparency as black), optionally enlarged. */
async function png(rgba: Uint8ClampedArray, width: number, height: number, scale: number) {
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), width, height))
  const c = new OffscreenCanvas(width * scale, height * scale)
  const x = c.getContext('2d')!
  x.fillStyle = '#fff'
  x.fillRect(0, 0, c.width, c.height)
  x.imageSmoothingQuality = 'high'
  x.drawImage(bitmap, 0, 0, c.width, c.height)
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
}
