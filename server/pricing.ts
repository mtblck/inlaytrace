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
 * What an HD run costs by the image's size, smallest first. Provisional until
 * HD ships: the server will charge with costFor(), so changing a tier here
 * changes the page and the charge together.
 */
export const COST = [
  { maxMegapixels: 4, credits: 1, label: 'Up to 4 megapixels (about 2000 × 2000)' },
  { maxMegapixels: 16, credits: 2, label: 'Up to 16 megapixels (about 4000 × 4000)' },
  { maxMegapixels: Infinity, credits: 4, label: 'Larger' },
] as const

/** Credits for an HD run on a width × height image. */
export function costFor(width: number, height: number): number {
  const mp = (width * height) / 1_000_000
  return COST.find((c) => mp <= c.maxMegapixels)!.credits
}

/** "$5", "$0.25": how the site shows a price. */
export const usd = (n: number) => `$${n.toFixed(Number.isInteger(n) ? 0 : 2)}`
