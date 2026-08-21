import type { BusinessCommercialHandoff, BusinessPricingReview, BusinessProfitabilityReview, CommercialOfferSummary } from './types.js'
import { createArtifactId } from './artifacts.js'

function money(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '缺失'
}

function markdownList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- 无'
}

export function buildCommercialHandoff(input: {
  productName: string
  handoffTo: 'dsh-sales' | 'dsh-product'
  pricing: BusinessPricingReview
  profitability?: BusinessProfitabilityReview
  source?: string
}): BusinessCommercialHandoff {
  const offers: CommercialOfferSummary[] = input.pricing.offers.map((offer) => ({
    sku: offer.sku,
    channel: offer.channel,
    effectivePrice: offer.effectivePrice,
    ...(offer.minimumTransactionPrice !== undefined ? { minimumTransactionPrice: offer.minimumTransactionPrice } : {}),
    unitCost: offer.unitCost,
    contributionPerUnit: offer.contributionPerUnit,
    contributionMarginPct: offer.contributionMarginPct,
    status: offer.status,
  }))
  const warnings = [...input.pricing.warnings]
  const risks = [...input.pricing.priceConflicts]
  if (offers.length === 0) warnings.push('没有报价行；不能形成可审查的商业交接。')
  for (const offer of offers) {
    if (offer.minimumTransactionPrice === undefined) warnings.push(`${offer.sku}/${offer.channel} 缺少明确的最低成交价；不得把有效成交价当作授权底线。`)
    if (offer.contributionPerUnit < 0) risks.push(`${offer.sku}/${offer.channel} 单位贡献为负：${money(offer.contributionPerUnit)}。`)
    if (offer.status === 'blocked') risks.push(`${offer.sku}/${offer.channel} 当前报价状态为 blocked。`)
  }
  if (!input.profitability) warnings.push('未提供盈利复盘；商业交接不能代表整体盈利能力。')
  if (input.profitability?.status === 'loss-making') risks.push('盈利复盘显示整体为 loss-making，销售推进前需要明确止损或调整方案。')
  const requiredApprovals = [
    '由有权限的负责人确认最低成交价、成本基础、付款条款和折扣授权。',
    input.handoffTo === 'dsh-sales' ? 'dsh-sales 只能在上述边界确认后进入报价与谈判。' : 'dsh-product 将商业约束作为范围和包装输入，不把它当作市场需求证据。',
  ]
  const status: BusinessCommercialHandoff['status'] = input.pricing.status === 'blocked' || risks.length > 0
    ? 'blocked'
    : warnings.length > 0
      ? 'partial'
      : 'ready-for-review'
  const decision: BusinessCommercialHandoff['decision'] = status === 'blocked' ? 'hold' : 'review'
  const nextActions = status === 'ready-for-review'
    ? ['由业务负责人或财务/销售授权人完成审批，不由本插件代替授权。', input.handoffTo === 'dsh-sales' ? '将本交接交给 dsh-sales 运行 sales_commercial_handoff_review。' : '将商业约束带回 dsh-product 的范围、包装和决策门。']
    : ['补齐价格底线、成本、盈利证据或风险处置，再进入正式报价、产品范围或渠道决策。']
  const profitabilitySummary = input.profitability ? {
    status: input.profitability.status,
    revenue: input.profitability.totals.revenue,
    contribution: input.profitability.totals.contribution,
    profit: input.profitability.totals.profit,
    profitMarginPct: input.profitability.totals.profitMarginPct,
  } : undefined
  const generatedAt = new Date().toISOString()
  const artifactId = createArtifactId({ artifactType: 'commercial-handoff', productName: input.productName, handoffTo: input.handoffTo, currency: input.pricing.currency, offers, profitabilitySummary, status, decision })
  const handoff: BusinessCommercialHandoff = {
    schemaVersion: '1.0',
    artifactId,
    handoffVersion: '1.0',
    artifactType: 'commercial-handoff',
    handoffFrom: 'dsh-business',
    handoffTo: input.handoffTo,
    generatedAt,
    status,
    decision,
    productName: input.productName,
    currency: input.pricing.currency,
    offers,
    ...(profitabilitySummary ? { profitabilitySummary } : {}),
    risks,
    requiredApprovals,
    source: input.source,
    warnings,
    nextActions,
    markdown: '',
  }
  handoff.markdown = [
    '---',
    'schemaVersion: "1.0"',
    `artifactId: ${JSON.stringify(artifactId)}`,
    'handoffVersion: "1.0"',
    'artifactType: commercial-handoff',
    'handoffFrom: dsh-business',
    `handoffTo: ${input.handoffTo}`,
    `status: ${status}`,
    `decision: ${decision}`,
    `productName: ${JSON.stringify(input.productName)}`,
    `currency: ${JSON.stringify(input.pricing.currency)}`,
    ...(input.source ? [`source: ${JSON.stringify(input.source)}`] : []),
    '---',
    `# ${input.productName} 商业交接`,
    '',
    '> 本材料是计算事实和待审批项，不是价格批准、折扣授权或收入承诺。',
    '',
    '## 报价事实',
    '',
    '| SKU | 渠道 | 有效成交价 | 最低成交价 | 单位成本 | 单位贡献 | 贡献毛利率 | 状态 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...offers.map((offer) => `| ${offer.sku} | ${offer.channel} | ${money(offer.effectivePrice)} | ${offer.minimumTransactionPrice === undefined ? '缺失' : money(offer.minimumTransactionPrice)} | ${money(offer.unitCost)} | ${money(offer.contributionPerUnit)} | ${money(offer.contributionMarginPct)}% | ${offer.status} |`),
    '',
    '## 盈利摘要',
    handoff.profitabilitySummary ? `- 状态：${handoff.profitabilitySummary.status}\n- 收入：${money(handoff.profitabilitySummary.revenue)}\n- 贡献：${money(handoff.profitabilitySummary.contribution)}\n- 利润：${money(handoff.profitabilitySummary.profit)}\n- 利润率：${money(handoff.profitabilitySummary.profitMarginPct)}%` : '- 未提供盈利复盘。',
    '',
    '## 风险',
    markdownList(risks),
    '',
    '## 必须由负责人确认',
    markdownList(requiredApprovals),
    '',
    '## 警告与下一步',
    markdownList(warnings),
    markdownList(nextActions),
    '',
  ].join('\n')
  return handoff
}
