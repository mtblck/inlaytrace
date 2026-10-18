/**
 * Who sells Inlay's HD credits, for the terms, the refund policy and the privacy
 * notice. Paddle's review needs the seller's real legal name in the terms and
 * privacy notice, and a postal address in the privacy notice.
 */
export const SELLER = 'Matt Black'
export const SELLER_KIND = 'a sole proprietor'
/** A postal address Matt is happy to publish. Empty until he gives it; the pages show a visible gap meanwhile. */
export const ADDRESS = ''
export const CONTACT = 'hello@inlaytrace.com'
/** Paddle requires 14 to 90 days. */
export const REFUND_DAYS = 30
export const UPDATED = '18 October 2026'

/** The packs, as sold (server/paddle.ts has the price ids). */
export const PACKS = [
  { credits: 20, price: 5 },
  { credits: 60, price: 12 },
  { credits: 200, price: 30 },
]
/** What an HD run costs, by the image's size. */
export const COST = [
  { size: 'Up to 4 megapixels (about 2000 × 2000)', credits: 1 },
  { size: 'Up to 16 megapixels (about 4000 × 4000)', credits: 2 },
  { size: 'Larger', credits: 4 },
]
