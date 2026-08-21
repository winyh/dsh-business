import { describe, expect, it } from 'vitest'
import {
  buildBusinessModelReview,
  buildBusinessPlan,
  buildBusinessPricingReview,
  buildBusinessProfitabilityReview,
  buildElevatorPitch,
} from '../src/business.js'
import { resultEnvelope } from '../src/output.js'

describe('business model review', () => {
  it('uses the shared result envelope lineage field', () => {
    const result = resultEnvelope({ data: { source: 'business-plan.md' }, lineage: [{ source: 'business-plan.md' }] })
    expect(result.lineage[0]?.source).toBe('business-plan.md')
    expect(result.nextActions).toEqual([])
  })

  it('holds when the monetization loop is incomplete', () => {
    const review = buildBusinessModelReview({
      businessName: 'Example',
      targetCustomer: '独立商户',
      valueProposition: '减少人工对账',
      revenueStreams: ['订阅'],
      pricingModel: '',
      channels: ['销售'],
      costDrivers: ['交付人力'],
      evidence: [{ id: 'customer', label: '客户需求', status: 'fact', evidence: '5 次访谈' }],
    })

    expect(review.decision).toBe('hold')
    expect(review.missing).toContain('定价/收费模式')
  })

  it('rejects a model only when fit is explicitly disproved', () => {
    const review = buildBusinessModelReview({
      businessName: 'Example',
      targetCustomer: '独立商户',
      valueProposition: '减少人工对账',
      revenueStreams: ['订阅'],
      pricingModel: '月费',
      channels: ['销售'],
      costDrivers: ['交付人力'],
      evidence: [],
      fitStatus: 'disproved',
    })

    expect(review.decision).toBe('reject')
    expect(review.status).toBe('blocked')
  })
})

describe('pricing and profitability review', () => {
  it('detects a negative contribution and a cross-channel price conflict', () => {
    const review = buildBusinessPricingReview({
      productName: 'Example SKU',
      currency: 'CNY',
      offers: [
        { sku: 'A', channel: '电商', listPrice: 100, transactionPrice: 100, unitCost: 40, commissionRate: 10 },
        { sku: 'A', channel: '折扣渠道', listPrice: 100, transactionPrice: 60, unitCost: 65, commissionRate: 5 },
      ],
    })

    expect(review.status).toBe('blocked')
    expect(review.decision).toBe('hold')
    expect(review.priceConflicts.length).toBe(1)
    expect(review.offers[1]?.contributionPerUnit).toBeLessThan(0)
  })

  it('computes portfolio profit and margin', () => {
    const review = buildBusinessProfitabilityReview({
      businessName: 'Example',
      currency: 'CNY',
      lines: [{ name: '主产品', units: 10, revenuePerUnit: 100, variableCostPerUnit: 40, fixedCost: 200 }],
    })

    expect(review.status).toBe('profitable')
    expect(review.totals.revenue).toBe(1000)
    expect(review.totals.profit).toBe(400)
    expect(review.totals.profitMarginPct).toBe(40)
  })
})

describe('pitch and business plan', () => {
  it('creates three pitch lengths and flags missing proof', () => {
    const pitch = buildElevatorPitch({
      businessName: 'Example',
      targetCustomer: '新手父母',
      problem: '购买信息分散',
      solution: '提供可信的选购清单',
    })

    expect(pitch.pitches.thirtySecond).toContain('Example')
    expect(pitch.pitches.twoMinute).toContain('新手父母')
    expect(pitch.warnings).toContain('缺少证据或结果，当前表达仍是价值假设。')
  })

  it('marks a plan partial when commercial proof points are missing', () => {
    const plan = buildBusinessPlan({
      businessName: 'Example',
      customer: '新手父母',
      problem: '购买信息分散',
      valueProposition: '降低选择成本',
      market: '母婴消费',
      businessModel: '订阅',
      pricing: '',
      channels: ['内容'],
      goToMarket: ['试点'],
      operations: [],
      metrics: ['激活率'],
      milestones: [],
      risks: [],
    })

    expect(plan.status).toBe('partial')
    expect(plan.warnings[0]).toContain('定价')
  })
})
