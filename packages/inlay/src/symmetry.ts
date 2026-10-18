/**
 * Symmetry: find a likely mirror axis or rotational order in a raster.
 *
 * Works on the image, not the trace, so the answer doesn't depend on the trace
 * settings. The foreground is every opaque pixel that differs from the
 * background (the most common colour around the border, or transparency). A
 * symmetric drawing's foreground centroid lies on its mirror axis or at its
 * centre of rotation, so only candidates near the centroid are scored, each by
 * the share of pixels (foreground on either side) whose reflection or rotation
 * has the same colour. A coarse pass over a sample of pixels picks the
 * candidates; a finer one settles them.
 */

export type MirrorSymmetry = {
  kind: 'mirror'
  /** A vertical axis splits left from right; a horizontal one top from bottom. */
  orientation: 'vertical' | 'horizontal'
  /** x of a vertical axis or y of a horizontal one, in pixels, to the nearest 0.5. */
  position: number
  /** The share of the drawing that matches its reflection, 0–1. */
  score: number
}

export type RotationalSymmetry = {
  kind: 'rotation'
  /** How many times the drawing repeats in a full turn (2 is a half turn). */
  order: number
  /** The centre of rotation, in pixels. */
  cx: number
  cy: number
  /** The share of the drawing that matches itself turned by 1/order, 0–1. */
  score: number
}

export type Symmetry = MirrorSymmetry | RotationalSymmetry

export type SymmetryOptions = {
  /** RGB distance (0–441) under which two pixels count as the same colour. Default 60. */
  tolerance?: number
  /** Rotational orders to try. Default 2–8. */
  orders?: number[]
}

/**
 * Score every candidate symmetry: the best vertical and horizontal mirror axes
 * and the best centre for each rotational order, highest score first. A clean
 * symmetric drawing scores close to 1; around 0.95 is a reasonable bar for
 * "likely", since JPEG noise and anti-aliasing never match exactly. A round
 * drawing scores well for every order. Returns `[]` for an image with almost
 * no foreground.
 */
export function detectSymmetry(rgba: ArrayLike<number>, w: number, h: number, options: SymmetryOptions = {}): Symmetry[] {
  const tol2 = (options.tolerance ?? 60) ** 2
  const orders = options.orders ?? [2, 3, 4, 5, 6, 7, 8]
  const n = w * h
  if (!n) return []

  // Background: the most common border colour (5-bit bins), or transparency.
  const counts = new Map<number, number>()
  const border = (i: number) => {
    const o = i * 4
    const key = rgba[o + 3] < 128 ? -1 : ((rgba[o] >> 3) << 10) | ((rgba[o + 1] >> 3) << 5) | (rgba[o + 2] >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (let x = 0; x < w; x++) {
    border(x)
    border((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    border(y * w)
    border(y * w + w - 1)
  }
  let bgKey = -1
  let most = -1
  for (const [k, c] of counts)
    if (c > most) {
      most = c
      bgKey = k
    }
  const bg = bgKey < 0 ? null : [((bgKey >> 10) & 31) * 8 + 4, ((bgKey >> 5) & 31) * 8 + 4, (bgKey & 31) * 8 + 4]

  const fg = new Uint8Array(n)
  let sx = 0
  let sy = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (rgba[o + 3] < 128) continue
    if (bg) {
      const dr = rgba[o] - bg[0]
      const dg = rgba[o + 1] - bg[1]
      const db = rgba[o + 2] - bg[2]
      if (dr * dr + dg * dg + db * db < tol2) continue
    }
    fg[i] = 1
    sx += i % w
    sy += (i / w) | 0
    count++
  }
  if (count < 16) return []
  // The centroid in pixel-centre coordinates (pixel x covers x to x + 1).
  const cx = sx / count + 0.5
  const cy = sy / count + 0.5

  const same = (i: number, j: number) => {
    if (fg[i] !== fg[j]) return false
    if (!fg[i]) return true
    const a = i * 4
    const b = j * 4
    const dr = rgba[a] - rgba[b]
    const dg = rgba[a + 1] - rgba[b + 1]
    const db = rgba[a + 2] - rgba[b + 2]
    return dr * dr + dg * dg + db * db < tol2
  }

  /** The share of sampled pixels that match their image under `map` (-1: off the picture). */
  const score = (map: (x: number, y: number) => number, step: number) => {
    let match = 0
    let total = 0
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        const i = y * w + x
        const j = map(x, y)
        if (j < 0) {
          if (fg[i]) total++
          continue
        }
        if (!fg[i] && !fg[j]) continue
        total++
        if (same(i, j)) match++
      }
    return total ? match / total : 0
  }
  const coarse = Math.max(1, Math.round(Math.sqrt(n / 40_000)))
  const fine = Math.max(1, Math.round(Math.sqrt(n / 100_000)))

  const mirror = (orientation: MirrorSymmetry['orientation'], a: number) =>
    orientation === 'vertical'
      ? (x: number, y: number) => {
          const m = 2 * a - x - 1
          return m >= 0 && m < w ? y * w + m : -1
        }
      : (x: number, y: number) => {
          const m = 2 * a - y - 1
          return m >= 0 && m < h ? m * w + x : -1
        }
  const rotation = (order: number, ox: number, oy: number) => {
    const t = (2 * Math.PI) / order
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    return (x: number, y: number) => {
      const px = x + 0.5 - ox
      const py = y + 0.5 - oy
      const rx = Math.floor(ox + px * cos - py * sin)
      const ry = Math.floor(oy + px * sin + py * cos)
      return rx >= 0 && rx < w && ry >= 0 && ry < h ? ry * w + rx : -1
    }
  }

  /** Coarse-score the candidates, then re-score the best few finely. */
  const best = <T extends { score: number }>(candidates: T[], map: (c: T) => (x: number, y: number) => number) => {
    for (const c of candidates) c.score = score(map(c), coarse)
    const top = [...candidates].sort((a, b) => b.score - a.score).slice(0, 3)
    if (fine !== coarse) for (const c of top) c.score = score(map(c), fine)
    return top.sort((a, b) => b.score - a.score)[0]
  }

  const out: Symmetry[] = []
  const reach = Math.max(4, Math.round(Math.min(w, h) / 100))
  for (const orientation of ['vertical', 'horizontal'] as const) {
    const centre = Math.round((orientation === 'vertical' ? cx : cy) * 2) / 2
    const candidates: MirrorSymmetry[] = []
    for (let d = -reach; d <= reach; d += 0.5) candidates.push({ kind: 'mirror', orientation, position: centre + d, score: 0 })
    out.push(best(candidates, (c) => mirror(c.orientation, c.position)))
  }
  const near = Math.max(2, Math.round(reach / 2))
  // Each order's best whole-pixel centre, coarsely; then half-pixel refinement
  // for the two leading orders only (the rest keep their coarse score).
  const rotations = orders.map((order) => {
    let top: RotationalSymmetry = { kind: 'rotation', order, cx, cy, score: -1 }
    for (let dy = -near; dy <= near; dy++)
      for (let dx = -near; dx <= near; dx++) {
        const s = score(rotation(order, cx + dx, cy + dy), coarse)
        if (s > top.score) top = { kind: 'rotation', order, cx: cx + dx, cy: cy + dy, score: s }
      }
    return top
  })
  rotations.sort((a, b) => b.score - a.score)
  rotations.forEach((g, k) => {
    if (k > 1) return out.push(g)
    let top = g
    for (const dy of [-0.5, 0, 0.5])
      for (const dx of [-0.5, 0, 0.5]) {
        const c: RotationalSymmetry = { ...g, cx: g.cx + dx, cy: g.cy + dy }
        c.score = score(rotation(c.order, c.cx, c.cy), fine)
        if (c.score > top.score || top === g) top = c
      }
    out.push(top)
  })
  return out.sort((a, b) => b.score - a.score)
}
