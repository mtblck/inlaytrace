/**
 * HD's models, kept in the project's private Vercel Blob store by the HD models
 * workflow (scripts/hd-models, .github/workflows/hd-models.yml). Each is fetched
 * once per function instance into /tmp, checked against its hash, and kept as
 * an ONNX Runtime session while the instance stays warm.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export type ModelEnv = { BLOB_READ_WRITE_TOKEN?: string }

/** From models/manifest.json on the hd-models-report branch. Paths carry the hash, so a new model never replaces one in use. */
export const MODELS = {
  upscale: {
    pathname: 'hd-models/8028747b4d8d/realesrgan-x4plus.onnx',
    sha256: '8028747b4d8d97a7d590e6f04762bb2e8fde87f734a70e1f7febf8201aeb30be',
    licence: 'BSD-3-Clause (Real-ESRGAN x4plus)',
  },
} as const

export type ModelName = keyof typeof MODELS

/** The parts of an ONNX Runtime session HD uses. */
export type Session = {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>
}
export type Runtime = {
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
  create(path: string): Promise<Session>
}

const sessions = new Map<ModelName, Promise<{ session: Session; runtime: Runtime }>>()

export function loadModel(name: ModelName, env: ModelEnv): Promise<{ session: Session; runtime: Runtime }> {
  let s = sessions.get(name)
  if (!s) {
    s = open(name, env)
    s.catch(() => sessions.delete(name))
    sessions.set(name, s)
  }
  return s
}

async function open(name: ModelName, env: ModelEnv) {
  const m = MODELS[name]
  const path = join(tmpdir(), `${m.sha256}.onnx`)
  if (!existsSync(path)) {
    if (!env.BLOB_READ_WRITE_TOKEN) throw new Error('HD models need BLOB_READ_WRITE_TOKEN.')
    const { get } = await import('@vercel/blob')
    const blob = await get(m.pathname, { access: 'private', token: env.BLOB_READ_WRITE_TOKEN })
    if (!blob?.stream) throw new Error(`Model ${m.pathname} isn't in the Blob store.`)
    const bytes = new Uint8Array(await new Response(blob.stream).arrayBuffer())
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== m.sha256) throw new Error(`Model ${m.pathname} has the wrong hash (${hash}).`)
    writeFileSync(path, bytes)
  } else if (createHash('sha256').update(readFileSync(path)).digest('hex') !== m.sha256) throw new Error(`Cached model ${path} is corrupt.`)
  const ort = await import('onnxruntime-node')
  const runtime: Runtime = { Tensor: ort.Tensor as unknown as Runtime['Tensor'], create: (p) => ort.InferenceSession.create(p, { executionProviders: ['cpu'] }) as unknown as Promise<Session> }
  return { session: await runtime.create(path), runtime }
}
