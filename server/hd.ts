/**
 * HD mode: paid jobs run on the server for images the browser can't do as well.
 * Two kinds: `trace` (the app traces at most 2048 px on the long edge, 4096 for
 * pixel art; HD traces the same image at its full size) and `upscale`
 * (Real-ESRGAN x4plus, 4×, for images up to half a megapixel; server/upscale.ts).
 *
 * A run, in four requests (all under /api/hd/, each body and response under
 * Vercel's 4.5 MB limit, so the image and the result travel in parts):
 *   POST start   { kind, width, height, parts, contentType, settings }
 *                checks sign-in, balance and caps; nothing is charged yet
 *   POST upload  ?run=…&part=n   one part of the image (raw bytes, ≤ 4 MB)
 *   POST run     { run }   charges the credits, runs the job, stores the
 *                result in parts, deletes the image; refunds on failure
 *   GET  result  ?run=…&part=n   one part of the result; the last part's
 *                fetch deletes the result
 * A daily cron (keepalive) deletes anything left over after an hour.
 *
 * Privacy: the image exists on the server only between upload and the end of
 * its run; it isn't logged or kept. The run's row keeps its size, kind, cost
 * and outcome (the account page's history).
 */
import { maxTraceEdge, PRESETS, toTraceOptions, type PresetId, type Settings } from '../apps/app/src/engine/presets.js'
import { runTrace } from '../apps/app/src/engine/run.js'
import { decodeImage, MAX_PIXELS } from './image.js'
import { loadModel, type ModelEnv } from './models.js'
import { costFor, UPSCALE } from './pricing.js'
import { toPng, upscale4 } from './upscale.js'
import type { HdRun, Supabase, User } from './supabase.js'

/** Bytes per part, both ways: under Vercel's 4.5 MB body limit with room for headers. */
export const PART_BYTES = 4 * 1024 * 1024
const MAX_PARTS = 32
/** Runs per day across everyone (a spend cap on server time); HD_DAILY_RUNS overrides. */
const DAILY_RUNS = 500
/** How long a run's files may stay in storage at most. */
const KEEP_MS = 60 * 60 * 1000
const KINDS = ['trace', 'upscale'] as const
type Kind = (typeof KINDS)[number]

export type HdEnv = { HD_DAILY_RUNS?: string } & ModelEnv
/** A run gives up (and refunds) this long after it starts, inside the function's 300 s. */
const RUN_MS = 270_000
type Reply = { status: number; body?: unknown; bytes?: Uint8Array; contentType?: string }
const err = (status: number, error: string, code?: string): Reply => ({ status, body: { error, ...(code ? { code } : {}) } })

// ---- start ------------------------------------------------------------------------

export async function startRun(db: Supabase, user: User, body: Record<string, unknown>, env: HdEnv): Promise<Reply> {
  const kind = body.kind as Kind
  if (!KINDS.includes(kind)) return err(400, 'Unknown HD job.')
  const width = Math.floor(Number(body.width))
  const height = Math.floor(Number(body.height))
  if (!(width > 0 && height > 0) || width * height > MAX_PIXELS) return err(400, `HD takes images up to ${MAX_PIXELS / 1e6} megapixels.`)
  if (kind === 'upscale' && width * height > UPSCALE.maxPixels) return err(400, `HD upscaling takes images up to ${UPSCALE.maxPixels / 1e6} megapixels (about 700 × 700).`)
  const parts = Math.floor(Number(body.parts))
  if (!(parts >= 1 && parts <= MAX_PARTS)) return err(400, `The image must arrive in 1 to ${MAX_PARTS} parts of 4 MB.`)
  const contentType = body.contentType === 'image/jpeg' ? 'image/jpeg' : body.contentType === 'image/png' ? 'image/png' : null
  if (!contentType) return err(400, 'Send the image as PNG or JPEG.')
  const settings = kind === 'trace' ? cleanSettings(body.settings) : null
  if (kind === 'trace' && !settings) return err(400, 'Those trace settings aren’t valid.')
  const credits = costFor(width, height, kind)

  // Caps: one run at a time per person, and a daily ceiling across everyone.
  const since = new Date(Date.now() - KEEP_MS).toISOString()
  if (await db.countRuns(since, user.id, ['uploading', 'running'])) return err(409, 'You already have an HD run going. Wait for it to finish.', 'busy')
  const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  if ((await db.countRuns(day)) >= Number(env.HD_DAILY_RUNS || DAILY_RUNS)) return err(503, 'HD is at its limit for today. Try again tomorrow.', 'limit')
  const balance = await db.balance(user.id)
  if (balance < credits) return err(402, `This needs ${credits} credit${credits === 1 ? '' : 's'}; you have ${balance}.`, 'credits')

  const run = await db.createRun({ user_id: user.id, kind, width, height, credits, parts_in: parts, content_type: contentType, options: settings ? { settings } : {} })
  return { status: 200, body: { run: run.id, credits, partBytes: PART_BYTES } }
}

/** The trace settings, checked field by field and clamped, so no option can make a run unreasonably expensive. */
export function cleanSettings(raw: unknown): Settings | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (!PRESETS.some((p) => p.id === s.preset)) return null
  const num = (v: unknown, lo: number, hi: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback)
  const merge: Record<string, string> = {}
  if (s.merge && typeof s.merge === 'object')
    for (const [a, b] of Object.entries(s.merge as Record<string, unknown>).slice(0, 64))
      if (/^#[0-9a-f]{6}$/i.test(a) && typeof b === 'string' && /^#[0-9a-f]{6}$/i.test(b)) merge[a.toLowerCase()] = b.toLowerCase()
  return {
    preset: s.preset as PresetId,
    colors: Math.round(num(s.colors, 2, 64, 8)),
    threshold: s.threshold === null || s.threshold === 'auto' ? s.threshold : Math.round(num(s.threshold, 0, 255, 128)),
    lightInk: s.lightInk === true,
    speckle: num(s.speckle, 0, 256, 4),
    smoothing: num(s.smoothing, 0, 3, 1),
    corners: num(s.corners, 0, 180, 45),
    shapes: s.shapes === 'stacked' ? 'stacked' : 'cutout',
    exact: s.exact === true,
    strokeWidth: num(s.strokeWidth, 0, 64, 0),
    lines: s.lines === true,
    merge,
    removeBackground: false,
    aiUpscale: false,
  }
}

// ---- upload -------------------------------------------------------------------------

export async function uploadPart(db: Supabase, user: User, runId: string, partRaw: string | null, bytes: Uint8Array): Promise<Reply> {
  const run = await mine(db, user, runId)
  if (!run) return err(404, 'No such HD run.')
  if (run.status !== 'uploading') return err(409, 'This run has already started.')
  const part = Number(partRaw)
  if (!Number.isInteger(part) || part < 0 || part >= run.parts_in) return err(400, 'No such part.')
  if (!bytes.length || bytes.length > PART_BYTES) return err(413, 'Each part must be at most 4 MB.')
  await db.putFile(`${run.id}/in-${part}`, bytes, 'application/octet-stream')
  return { status: 204 }
}

// ---- run ----------------------------------------------------------------------------

export async function runJob(db: Supabase, user: User, runId: string, env: HdEnv = {}): Promise<Reply> {
  const deadline = Date.now() + RUN_MS
  const run = await mine(db, user, runId)
  if (!run) return err(404, 'No such HD run.')
  if (run.status !== 'uploading') return err(409, 'This run has already started.')

  // Every part must be there before anything is charged.
  const parts: Uint8Array[] = []
  for (let i = 0; i < run.parts_in; i++) {
    const p = await db.getFile(`${run.id}/in-${i}`)
    if (!p) return err(400, `Part ${i + 1} of ${run.parts_in} hasn't arrived. Send it, then start the run again.`)
    parts.push(p)
  }
  // Only one request gets to move it from uploading to running.
  if (!(await db.updateRun(run.id, { status: 'running' }, 'uploading'))) return err(409, 'This run has already started.')
  const useId = await db.spendCredits(user.id, run.credits, { what: describeKind(run.kind), run: run.id, width: run.width, height: run.height })
  if (useId === null) {
    await finish(db, run, { status: 'failed', error: 'not enough credits' })
    return err(402, `This needs ${run.credits} credit${run.credits === 1 ? '' : 's'}, and your balance is lower now.`, 'credits')
  }
  await db.updateRun(run.id, { use_id: useId })

  try {
    const image = decodeImage(concat(parts), run.content_type)
    if (image.width !== run.width || image.height !== run.height) throw new UserError(`The image is ${image.width} × ${image.height}, not the ${run.width} × ${run.height} that was priced.`)
    const result = await process(run, image, env, deadline)
    const out = result.bytes
    const count = Math.max(1, Math.ceil(out.length / PART_BYTES))
    for (let i = 0; i < count; i++) await db.putFile(`${run.id}/out-${i}`, out.subarray(i * PART_BYTES, (i + 1) * PART_BYTES), 'application/octet-stream')
    await finish(db, run, { status: 'done', parts_out: count, result_type: result.type })
    return { status: 200, body: { parts: count, contentType: result.type, bytes: out.length, credits: run.credits } }
  } catch (e) {
    // Anything that goes wrong after charging gives the credits back.
    await db.refundUse(useId)
    const message = e instanceof UserError ? e.message : 'The HD run failed on the server. Your credits are back on your account.'
    if (!(e instanceof UserError)) console.error(`HD run ${run.id} failed:`, e)
    await finish(db, run, { status: 'failed', error: message })
    return err(e instanceof UserError ? 400 : 500, message, 'failed')
  }
}

class UserError extends Error {}

async function process(run: HdRun, image: { data: Uint8Array; width: number; height: number }, env: HdEnv, deadline: number): Promise<{ bytes: Uint8Array; type: string }> {
  if (run.kind === 'trace') {
    const settings = run.options.settings as Settings
    const svg = runTrace(image.data, image.width, image.height, toTraceOptions(scaleSettings(settings, image.width, image.height)))
    return { bytes: new TextEncoder().encode(svg), type: 'image/svg+xml' }
  }
  if (run.kind === 'upscale') {
    const model = await loadModel('upscale', env)
    return { bytes: toPng(await upscale4(image, model, deadline)), type: 'image/png' }
  }
  throw new Error(`No processor for ${run.kind}.`)
}

/**
 * Settings tuned on the app's trace are in its pixels: at full size the same
 * speck is bigger, so the speckle filter (an area) and a set stroke width scale
 * with the image. Smoothing stays in pixels, so finer detail survives: that's
 * what HD is for.
 */
export function scaleSettings(s: Settings, width: number, height: number): Settings {
  const k = Math.max(1, Math.max(width, height) / maxTraceEdge(s.preset))
  return { ...s, speckle: Math.round(s.speckle * k * k), strokeWidth: s.strokeWidth * k }
}

const describeKind = (kind: HdRun['kind']) => ({ trace: 'full-size trace', background: 'background removal', upscale: 'upscaling 4×' })[kind]

/** End a run: record the outcome and delete the image (never kept past its run). */
async function finish(db: Supabase, run: HdRun, patch: Partial<HdRun>) {
  await db.deleteFiles(Array.from({ length: run.parts_in }, (_, i) => `${run.id}/in-${i}`)).catch((e) => console.error(`HD run ${run.id}: deleting the image failed`, e))
  await db.updateRun(run.id, { ...patch, finished_at: new Date().toISOString() })
}

// ---- result ---------------------------------------------------------------------------

export async function resultPart(db: Supabase, user: User, runId: string, partRaw: string | null): Promise<Reply> {
  const run = await mine(db, user, runId)
  if (!run || run.status !== 'done' || !run.parts_out) return err(404, 'No result for that run.')
  const part = Number(partRaw)
  if (!Number.isInteger(part) || part < 0 || part >= run.parts_out) return err(400, 'No such part.')
  const bytes = await db.getFile(`${run.id}/out-${part}`)
  if (!bytes) return err(410, 'That result has expired. Results are kept for an hour.', 'expired')
  // The last part's fetch ends the result's stay on the server.
  if (part === run.parts_out - 1) {
    await db.deleteFiles(Array.from({ length: run.parts_out }, (_, i) => `${run.id}/out-${i}`)).catch((e) => console.error(`HD run ${run.id}: deleting the result failed`, e))
    await db.updateRun(run.id, { cleaned_at: new Date().toISOString() })
  }
  return { status: 200, bytes, contentType: 'application/octet-stream' }
}

// ---- cleanup (daily cron) -----------------------------------------------------------------

/** Delete the files of runs older than an hour, and fail any left half-done (refunding their credits). */
export async function cleanup(db: Supabase, now = Date.now()) {
  let cleaned = 0
  for (const run of await db.staleRuns(new Date(now - KEEP_MS).toISOString())) {
    const files = [...Array.from({ length: run.parts_in }, (_, i) => `${run.id}/in-${i}`), ...Array.from({ length: run.parts_out ?? 0 }, (_, i) => `${run.id}/out-${i}`)]
    await db.deleteFiles(files)
    if (run.status === 'running' && run.use_id) await db.refundUse(run.use_id)
    await db.updateRun(run.id, { ...(run.status === 'uploading' || run.status === 'running' ? { status: 'failed', error: 'abandoned' } : {}), cleaned_at: new Date(now).toISOString() })
    cleaned++
  }
  return cleaned
}

async function mine(db: Supabase, user: User, runId: string) {
  const run = await db.run(runId)
  return run && run.user_id === user.id ? run : null
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
