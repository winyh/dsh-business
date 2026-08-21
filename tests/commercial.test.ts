import { describe, expect, it } from 'vitest'
import { buildBusinessPricingReview } from '../src/business.js'
import { buildCommercialHandoff } from '../src/commercial.js'

describe('commercial handoff', () => {
  it('preserves price facts without calling them approvals', () => {
    const pricing = buildBusinessPricingReview({
      productName: 'Example',
      currency: 'CNY',
      offers: [{ sku: 'A', channel: 'direct', listPrice: 100, transactionPrice: 90, unitCost: 40, minimumTransactionPrice: 80 }],
    })
    const handoff = buildCommercialHandoff({ productName: 'Example', handoffTo: 'dsh-sales', pricing, source: 'pricing-review.md' })
    expect(handoff.status).toBe('partial')
    expect(handoff.offers[0]?.minimumTransactionPrice).toBe(80)
    expect(handoff.markdown).toContain('不是价格批准')
  })

  it('blocks negative contribution before sales review', () => {
    const pricing = buildBusinessPricingReview({
      productName: 'Example',
      currency: 'CNY',
      offers: [{ sku: 'A', channel: 'discount', listPrice: 60, transactionPrice: 50, unitCost: 70, minimumTransactionPrice: 45 }],
    })
    const handoff = buildCommercialHandoff({ productName: 'Example', handoffTo: 'dsh-sales', pricing })
    expect(handoff.status).toBe('blocked')
    expect(handoff.decision).toBe('hold')
  })
})
