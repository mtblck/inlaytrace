/**
 * What HD credits cost and what an HD run costs: the one source for the
 * server (Paddle prices, charging a run) and the site's pricing page, so the
 * page Paddle reviewed can't drift from what customers are charged.
 * Plain data and arithmetic only: the site imports this at build time.
 */

/** The credit packs, in US dollars. Paddle's price ids for each are in paddle.ts. */
export const PACKS = [
  { credits: 20, usd: 5 },
  { credits: 60, usd: 12 },
  { credits: 200, usd: 30 },
] as const

/**
 * What an HD trace costs by the image's size, smallest first. Provisional until
 * HD ships: the server will charge with costFor(), so changing a tier here
 * changes the page and the charge together.
 */
export const COST = [
  { maxMegapixels: 4, credits: 1, label: 'Up to 4 megapixels (about 2000 × 2000)' },
  { maxMegapixels: 16, credits: 2, label: 'Up to 16 megapixels (about 4000 × 4000)' },
  { maxMegapixels: Infinity, credits: 4, label: 'Larger' },
] as const

/**
 * HD upscaling (Real-ESRGAN x4plus, 4×): one price, for inputs up to half a
 * megapixel. Through server/upscale.ts on a GitHub runner's CPU it took 88 s per
 * megapixel of input (320 × 240 in 6.8 s), so half a megapixel is about 45 s:
 * room to spare in the function's 300 s on slower CPUs. Raise it with care.
 */
export const UPSCALE = { credits: 2, maxPixels: 500_000, factor: 4, label: 'Upscaling 4×, images up to 0.5 megapixels (about 700 × 700)' } as const

/** Credits for an HD run of `kind` on a width × height image. */
export function costFor(width: number, height: number, kind: 'trace' | 'upscale' = 'trace'): number {
  if (kind === 'upscale') return UPSCALE.credits
  const mp = (width * height) / 1_000_000
  return COST.find((c) => mp <= c.maxMegapixels)!.credits
}

/** "$5", "$0.25": how the site shows a price. */
export const usd = (n: number) => `$${n.toFixed(Number.isInteger(n) ? 0 : 2)}`
