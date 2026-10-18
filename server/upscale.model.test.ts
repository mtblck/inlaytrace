/**
 * The real upscaler, end to end, with the real model in ONNX Runtime for Node.
 * Skipped unless HD_MODEL_PATH points at realesrgan-x4plus.onnx: the HD models
 * workflow sets it on a runner (the dev sandbox can't fetch the weights).
 * Appends its timing to HD_SMOKE_OUT when set, for the report.
 */
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { upscale4, toPng } from './upscale'

const path = process.env.HD_MODEL_PATH

describe.skipIf(!path)('Real-ESRGAN x4plus in onnxruntime-node', () => {
  it('upscales a 320 × 240 image 4× and times it', async () => {
    const ort = await import('onnxruntime-node')
    const session = await ort.InferenceSession.create(path!, { executionProviders: ['cpu'] })
    const W = 320
    const H = 240
    const data = new Uint8Array(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([(x * 255) / W, (y * 255) / H, Math.hypot(x - 160, y - 120) < 80 ? 220 : 40, 255], (y * W + x) * 4)
    const t = performance.now()
    const out = await upscale4({ data, width: W, height: H }, { session: session as never, runtime: { Tensor: ort.Tensor as never, create: async () => session as never } })
    const secs = (performance.now() - t) / 1000
    expect([out.width, out.height]).toEqual([1280, 960])
    // Colour carries through: the disc's blue stays high in the middle, low in the corner.
    expect(out.data[(480 * 1280 + 640) * 4 + 2]).toBeGreaterThan(180)
    expect(out.data[(20 * 1280 + 20) * 4 + 2]).toBeLessThan(90)
    const png = toPng(out)
    const line = `server upscale4 (onnxruntime-node, ${W} × ${H} → ${out.width} × ${out.height}): ${secs.toFixed(1)} s, ${(secs / ((W * H) / 1e6)).toFixed(0)} s per megapixel of input, PNG ${(png.length / 1e6).toFixed(1)} MB\n`
    process.stderr.write(line)
    if (process.env.HD_SMOKE_OUT) appendFileSync(process.env.HD_SMOKE_OUT, line)
  }, 600_000)
})
