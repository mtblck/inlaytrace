import { decode, encode } from 'fast-png'
import { describe, expect, it, vi } from 'vitest'

// A stand-in for Real-ESRGAN: nearest-neighbour 4×, in the model's planar 0–1 format.
vi.mock('./models', () => {
  class Tensor {
    constructor(
      readonly type: string,
      readonly data: Float32Array,
      readonly dims: number[],
    ) {}
  }
  const session = {
    inputNames: ['input'],
    outputNames: ['output'],
    async run(feeds: Record<string, Tensor>) {
      const { data, dims } = feeds.input
      const [, , h, w] = dims
      const out = new Float32Array(3 * h * 4 * w * 4)
      for (let c = 0; c < 3; c++) for (let y = 0; y < h * 4; y++) for (let x = 0; x < w * 4; x++) out[c * h * w * 16 + y * w * 4 + x] = data[c * h * w + Math.floor(y / 4) * w + Math.floor(x / 4)]
      return { output: { data: out } }
    },
  }
  return { loadModel: vi.fn(async () => ({ session, runtime: { Tensor } })) }
})
import { cleanSettings, cleanup, PART_BYTES, resultPart, runJob, scaleSettings, startRun, uploadPart } from './hd'
import type { HdRun, Supabase, User } from './supabase'

const ADA: User = { id: '11111111-1111-1111-1111-111111111111', email: 'ada@example.com' }
const BOB: User = { id: '22222222-2222-2222-2222-222222222222', email: 'bob@example.com' }
const SETTINGS = { preset: 'logo', colors: 8, threshold: null, lightInk: false, speckle: 8, smoothing: 1.5, corners: 45, shapes: 'cutout', exact: true, strokeWidth: 0, merge: {} }

/** An in-memory stand-in for the Supabase client: runs, files, a ledger. */
function fakeDb(balance = 10) {
  const runs = new Map<string, HdRun>()
  const files = new Map<string, Uint8Array>()
  const ledger: { id: number; user: string; delta: number; reason: string }[] = []
  let n = 0
  const bal = (user: string) => balance + ledger.filter((l) => l.user === user).reduce((s, l) => s + l.delta, 0)
  const db = {
    balance: async (user: string) => bal(user),
    spendCredits: async (user: string, credits: number) => (bal(user) < credits ? null : (ledger.push({ id: ++n, user, delta: -credits, reason: 'use' }), n)),
    refundUse: async (id: number) => {
      const use = ledger.find((l) => l.id === id)!
      if (!ledger.some((l) => l.reason === `refund ${id}`)) ledger.push({ id: ++n, user: use.user, delta: -use.delta, reason: `refund ${id}` })
      return bal(use.user)
    },
    createRun: async (r: Partial<HdRun>) => {
      const run = { id: `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`, status: 'uploading', use_id: null, parts_out: null, result_type: null, error: null, created_at: new Date().toISOString(), finished_at: null, cleaned_at: null, ...r } as HdRun
      runs.set(run.id, run)
      return run
    },
    run: async (id: string) => runs.get(id) ?? null,
    updateRun: async (id: string, patch: Partial<HdRun>, from?: string) => {
      const r = runs.get(id)
      if (!r || (from && r.status !== from)) return false
      Object.assign(r, patch)
      return true
    },
    countRuns: async (_since: string, user?: string, statuses?: string[]) => [...runs.values()].filter((r) => (!user || r.user_id === user) && (!statuses || statuses.includes(r.status))).length,
    staleRuns: async () => [...runs.values()].filter((r) => !r.cleaned_at),
    putFile: async (path: string, bytes: Uint8Array) => void files.set(path, bytes.slice()),
    getFile: async (path: string) => files.get(path) ?? null,
    deleteFiles: async (paths: string[]) => paths.forEach((p) => files.delete(p)),
  }
  return { db: db as unknown as Supabase, runs, files, ledger, bal }
}

/** A small two-colour PNG: a dark square on white. */
function png(w = 64, h = 48) {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x > 16 && x < 48 && y > 12 && y < 36
      data.set(inside ? [30, 60, 140, 255] : [250, 250, 250, 255], (y * w + x) * 4)
    }
  return encode({ width: w, height: h, data, channels: 4, depth: 8 })
}

const start = (db: Supabase, user = ADA, over: Record<string, unknown> = {}) =>
  startRun(db, user, { kind: 'trace', width: 64, height: 48, parts: 1, contentType: 'image/png', settings: SETTINGS, ...over }, {})

describe('starting an HD run', () => {
  it('prices it by size and charges nothing yet', async () => {
    const f = fakeDb()
    const r = await start(f.db)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ credits: 1, partBytes: PART_BYTES })
    expect(f.bal(ADA.id)).toBe(10)
    const big = await start(fakeDb().db, ADA, { width: 5000, height: 4000, parts: 8 })
    expect((big.body as { credits: number }).credits).toBe(4)
  })

  it('refuses what it cannot or should not run', async () => {
    const f = fakeDb(0)
    expect((await start(f.db)).status).toBe(402) // no credits
    const g = fakeDb()
    expect((await start(g.db, ADA, { kind: 'paint' })).status).toBe(400)
    expect((await start(g.db, ADA, { width: 10000, height: 10000 })).status).toBe(400) // over 50 MP
    expect((await start(g.db, ADA, { parts: 40 })).status).toBe(400)
    expect((await start(g.db, ADA, { contentType: 'image/gif' })).status).toBe(400)
    expect((await start(g.db, ADA, { settings: { preset: 'nope' } })).status).toBe(400)
  })

  it('allows one run at a time per person, and stops at the daily cap', async () => {
    const f = fakeDb()
    expect((await start(f.db)).status).toBe(200)
    expect((await start(f.db)).status).toBe(409)
    expect((await start(f.db, BOB)).status).toBe(200)
    expect((await startRun(f.db, { ...ADA, id: '33333333-3333-3333-3333-333333333333' }, { kind: 'trace', width: 64, height: 48, parts: 1, contentType: 'image/png', settings: SETTINGS }, { HD_DAILY_RUNS: '2' })).status).toBe(503)
  })
})

describe('trace settings', () => {
  it('are clamped field by field', () => {
    const s = cleanSettings({ ...SETTINGS, colors: 9999, speckle: -5, smoothing: 99, merge: { '#ABCDEF': '#000000', bad: 'x' }, removeBackground: true })!
    expect(s.colors).toBe(64)
    expect(s.speckle).toBe(0)
    expect(s.smoothing).toBe(3)
    expect(s.merge).toEqual({ '#abcdef': '#000000' })
    expect(s.removeBackground).toBe(false)
  })

  it('scale the speckle filter (an area) and stroke width to the full-size image', () => {
    const s = scaleSettings({ ...cleanSettings(SETTINGS)!, strokeWidth: 2 }, 4096, 2048) // twice the app's 2048
    expect(s.speckle).toBe(32)
    expect(s.strokeWidth).toBe(4)
    expect(scaleSettings(cleanSettings(SETTINGS)!, 1000, 800).speckle).toBe(8) // never scaled down
  })
})

describe('running it', () => {
  async function uploaded(f: ReturnType<typeof fakeDb>, bytes = png()) {
    const r = await start(f.db)
    const run = (r.body as { run: string }).run
    expect((await uploadPart(f.db, ADA, run, '0', bytes)).status).toBe(204)
    return run
  }

  it('traces at full size, charges once, keeps the result in parts and deletes the image', async () => {
    const f = fakeDb()
    const run = await uploaded(f)
    const r = await runJob(f.db, ADA, run)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ parts: 1, contentType: 'image/svg+xml', credits: 1 })
    expect(f.bal(ADA.id)).toBe(9)
    expect(f.files.has(`${run}/in-0`)).toBe(false)
    const svg = new TextDecoder().decode((await resultPart(f.db, ADA, run, '0')).bytes)
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 64 48"/)
    expect(svg).toContain('#1e3c8c')
    // The last part's fetch deletes the result.
    expect(f.files.has(`${run}/out-0`)).toBe(false)
    expect((await resultPart(f.db, ADA, run, '0')).status).toBe(410)
    // And a run can't be started twice.
    expect((await runJob(f.db, ADA, run)).status).toBe(409)
  })

  it('charges nothing until every part has arrived', async () => {
    const f = fakeDb()
    const run = (await start(f.db, ADA, { parts: 2 })).body as { run: string }
    await uploadPart(f.db, ADA, run.run, '0', png())
    expect((await runJob(f.db, ADA, run.run)).status).toBe(400)
    expect(f.bal(ADA.id)).toBe(10)
    expect(f.runs.get(run.run)!.status).toBe('uploading')
  })

  it('gives the credits back when the run fails, and still deletes the image', async () => {
    const f = fakeDb()
    const run = await uploaded(f, new Uint8Array([1, 2, 3, 4]))
    const r = await runJob(f.db, ADA, run)
    expect(r.status).toBe(500)
    expect((r.body as { error: string }).error).toMatch(/credits are back/)
    expect(f.bal(ADA.id)).toBe(10)
    expect(f.runs.get(run)!.status).toBe('failed')
    expect(f.files.size).toBe(0)
  })

  it('refuses an image that is not the size that was priced (and refunds)', async () => {
    const f = fakeDb()
    const run = await uploaded(f, png(200, 100))
    const r = await runJob(f.db, ADA, run)
    expect(r.status).toBe(400)
    expect(f.bal(ADA.id)).toBe(10)
  })

  it("keeps people out of each other's runs, and parts to their size", async () => {
    const f = fakeDb()
    const run = await uploaded(f)
    expect((await uploadPart(f.db, BOB, run, '0', png())).status).toBe(404)
    expect((await runJob(f.db, BOB, run)).status).toBe(404)
    expect((await uploadPart(f.db, ADA, run, '3', png())).status).toBe(400)
    expect((await uploadPart(f.db, ADA, run, '0', new Uint8Array(PART_BYTES + 1))).status).toBe(413)
  })
})

describe('upscaling', () => {
  it('costs 2 credits, takes images up to half a megapixel, and returns a 4× PNG', async () => {
    const f = fakeDb()
    expect((await startRun(f.db, ADA, { kind: 'upscale', width: 800, height: 700, parts: 1, contentType: 'image/png' }, {})).status).toBe(400) // 0.56 MP
    const r = await startRun(f.db, ADA, { kind: 'upscale', width: 64, height: 48, parts: 1, contentType: 'image/png' }, {})
    expect(r.body).toMatchObject({ credits: 2 })
    const run = (r.body as { run: string }).run
    await uploadPart(f.db, ADA, run, '0', png())
    const done = await runJob(f.db, ADA, run)
    expect(done.status).toBe(200)
    expect(done.body).toMatchObject({ contentType: 'image/png', credits: 2 })
    expect(f.bal(ADA.id)).toBe(8)
    const out = decode((await resultPart(f.db, ADA, run, '0')).bytes!)
    expect([out.width, out.height]).toEqual([256, 192])
    // The square's colour, 4× further in; the background stays; alpha stays opaque.
    const at = (x: number, y: number) => Array.from(out.data.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 4))
    expect(at(128, 96)).toEqual([30, 60, 140, 255])
    expect(at(8, 8)).toEqual([250, 250, 250, 255])
  })
})

describe('cleanup', () => {
  it('deletes what is left and refunds runs that never finished', async () => {
    const f = fakeDb()
    const r = await start(f.db)
    const run = (r.body as { run: string }).run
    await uploadPart(f.db, ADA, run, '0', png())
    // Simulate a run that died mid-way: charged, still marked running.
    await f.db.updateRun(run, { status: 'running', use_id: (await f.db.spendCredits(ADA.id, 1, {}))! })
    expect(f.bal(ADA.id)).toBe(9)
    expect(await cleanup(f.db)).toBe(1)
    expect(f.files.size).toBe(0)
    expect(f.bal(ADA.id)).toBe(10)
    expect(f.runs.get(run)!.status).toBe('failed')
  })
})
