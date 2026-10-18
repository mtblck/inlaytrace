import { describe, expect, it } from 'vitest'
import { costFor, COST, PACKS, usd } from './pricing'
import { packs } from './paddle'

describe('pricing', () => {
  it('charges by size at the tier boundaries', () => {
    expect(costFor(2000, 2000)).toBe(1) // exactly 4 MP
    expect(costFor(2001, 2000)).toBe(2)
    expect(costFor(4000, 4000)).toBe(2) // exactly 16 MP
    expect(costFor(4001, 4000)).toBe(4)
    expect(costFor(1, 1)).toBe(1)
  })

  it('has tiers in order, ending in a catch-all', () => {
    for (let i = 1; i < COST.length; i++) expect(COST[i].maxMegapixels).toBeGreaterThan(COST[i - 1].maxMegapixels)
    expect(COST[COST.length - 1].maxMegapixels).toBe(Infinity)
  })

  it('sells exactly the packs the pricing page shows, at its prices', () => {
    expect(packs({}).map((p) => [p.credits, p.price])).toEqual(PACKS.map((p) => [p.credits, usd(p.usd)]))
  })

  it('formats prices as the page shows them', () => {
    expect(usd(5)).toBe('$5')
    expect(usd(0.25)).toBe('$0.25')
    expect(usd(30 / 200)).toBe('$0.15')
  })
})
