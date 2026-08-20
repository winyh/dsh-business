import type {
  BusinessDecision,
  BusinessEvidence,
  BusinessModelReview,
  BusinessPlan,
  BusinessPricingReview,
  BusinessProfitabilityReview,
  BusinessReadiness,
  ElevatorPitch,
  PricingDecision,
  PricingOfferInput,
  PricingOfferResult,
  ProfitabilityLineInput,
  ProfitabilityLineResult,
} from './types.js'

function unique(items: string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))]
}

function clean(value: string | undefined): string {
  return value?.trim() ?? ''
}

function finite(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegative(value: number | undefined, fallback = 0): number {
  return Math.max(0, finite(value, fallback))
}

function pct(value: number): number {
  return Number((value * 100).toFixed(2))
}

function money(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function markdownList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- 暂无'
}

function artifactHeader(type: string, title: string, status: string, extra: Record<string, string | undefined> = {}): string {
  const lines = ['---', `type: ${type}`, `title: ${title}`, `status: ${status}`]
  for (const [key, value] of Object.entries(extra)) if (value) lines.push(`${key}: ${value.replace(/\r?\n/g, ' ')}`)
  lines.push('---', '')
  return lines.join('\n')
}

export function buildBusinessModelReview(input: {
  businessName: string
  targetCustomer: string
  valueProposition: string
  revenueStreams: string[]
  pricingModel: string
  channels: string[]
  costDrivers: string[]
  evidence: BusinessEvidence[]
  fitStatus?: 'promising' | 'uncertain' | 'disproved'
}): BusinessModelReview {
  const missing: string[] = []
  if (!clean(input.targetCustomer)) missing.push('目标客户')
  if (!clean(input.valueProposition)) missing.push('价值主张')
  if (input.revenueStreams.length === 0) missing.push('收入来源')
  if (!clean(input.pricingModel)) missing.push('定价/收费模式')
  if (input.channels.length === 0) missing.push('渠道')
  if (input.costDrivers.length === 0) missing.push('成本驱动因素')
  const missingEvidence = input.evidence.filter((item) => item.status === 'missing').map((item) => item.label)
  const assumptions = input.evidence.filter((item) => item.status === 'assumption').map((item) => item.label)
  const warnings: string[] = []
  if (input.evidence.length === 0) warnings.push('没有提供事实、假设或来源；商业模式仍缺少可追溯证据。')
  if (missingEvidence.length > 0) warnings.push(`以下证据仍缺失：${missingEvidence.join('、')}。`)
  if (assumptions.length > 0) warnings.push(`以下判断仍是假设：${assumptions.join('、')}。`)

  let decision: BusinessDecision
  if (input.fitStatus === 'disproved') decision = 'reject'
  else if (missing.some((item) => ['目标客户', '价值主张', '收入来源'].includes(item))) decision = 'hold'
  else if (missing.length > 0 || missingEvidence.length > 0) decision = 'hold'
  else if (assumptions.length > 0 || input.fitStatus === 'uncertain') decision = 'revise'
  else decision = 'proceed'
  const status = decision === 'reject' ? 'blocked' : decision === 'proceed' ? 'ready' : 'partial'
  const nextActions = decision === 'reject'
    ? ['记录被证伪的客户、价值或收入假设。', '关闭当前商业模式，或回到 dsh-idea 重新定义机会。']
    : decision === 'hold'
      ? [`补齐：${unique([...missing, ...missingEvidence]).join('、') || '关键商业证据'}。`, '在作出投入或放弃决定前，明确验证方法、阈值和日期。']
      : decision === 'revise'
        ? ['将关键假设转成最小验证或付费测试。', '补充实际价格、渠道成本和客户行为证据，再复核商业模式。']
        : ['进入定价、渠道经济和盈利能力复核。', '设定商业模式复盘周期，避免把一次性成交当成可重复模型。']
  const review: BusinessModelReview = {
    generatedAt: new Date().toISOString(),
    artifactType: 'business-model-review',
    businessName: input.businessName,
    targetCustomer: input.targetCustomer,
    valueProposition: input.valueProposition,
    revenueStreams: input.revenueStreams,
    pricingModel: input.pricingModel,
    channels: input.channels,
    costDrivers: input.costDrivers,
    evidence: input.evidence,
    status,
    decision,
    missing: unique([...missing, ...missingEvidence]),
    warnings,
    assumptions,
    nextActions,
    markdown: '',
  }
  review.markdown = [
    artifactHeader('business-model-review', `${input.businessName} 商业模式`, status),
    `# ${input.businessName} 商业模式复盘`,
    '',
    `- 状态：${status}`,
    `- 决策：${decision}`,
    `- 目标客户：${input.targetCustomer || '待补充'}`,
    `- 价值主张：${input.valueProposition || '待补充'}`,
    '',
    '## 收入来源',
    markdownList(input.revenueStreams),
    '',
    '## 定价模式',
    input.pricingModel || '待补充',
    '',
    '## 渠道',
    markdownList(input.channels),
    '',
    '## 成本驱动',
    markdownList(input.costDrivers),
    '',
    '## 缺口与假设',
    markdownList(unique([...review.missing, ...review.assumptions])),
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return review
}

function offerResult(input: PricingOfferInput): PricingOfferResult {
  const listPrice = nonNegative(input.listPrice)
  const discountRate = nonNegative(input.discountRate)
  const effectivePrice = input.transactionPrice !== undefined
    ? finite(input.transactionPrice)
    : input.supplyPrice !== undefined
      ? finite(input.supplyPrice)
      : listPrice * (1 - discountRate / 100)
  const unitCost = nonNegative(input.unitCost)
  const commissionRate = nonNegative(input.commissionRate)
  const logisticsPerUnit = nonNegative(input.logisticsPerUnit)
  const otherVariableCostPerUnit = nonNegative(input.otherVariableCostPerUnit)
  const channelCostPerUnit = effectivePrice * commissionRate / 100 + logisticsPerUnit + otherVariableCostPerUnit
  const grossProfitPerUnit = effectivePrice - unitCost
  const contributionPerUnit = grossProfitPerUnit - channelCostPerUnit
  const grossMarginPct = effectivePrice > 0 ? pct(grossProfitPerUnit / effectivePrice) : 0
  const contributionMarginPct = effectivePrice > 0 ? pct(contributionPerUnit / effectivePrice) : 0
  const reasons: string[] = []
  if (listPrice <= 0 || effectivePrice <= 0) reasons.push('价格必须大于 0。')
  if (input.minimumTransactionPrice !== undefined && effectivePrice < input.minimumTransactionPrice) reasons.push(`成交价低于最低交易价 ${money(input.minimumTransactionPrice)}。`)
  if (effectivePrice > listPrice && listPrice > 0) reasons.push('成交价高于标价，请确认价格口径。')
  if (contributionPerUnit < 0) reasons.push('扣除产品成本和渠道成本后为负贡献。')
  if (input.targetContributionMargin !== undefined && contributionMarginPct < input.targetContributionMargin) reasons.push(`贡献毛利率 ${contributionMarginPct}% 低于目标 ${input.targetContributionMargin}%。`)
  if (input.targetContributionMargin === undefined && contributionMarginPct >= 0 && contributionMarginPct < 10) reasons.push('贡献毛利率低于 10%，建议补充目标利润率和护栏。')
  const blocked = reasons.some((reason) => reason.includes('低于最低交易价') || reason.includes('负贡献') || reason.includes('必须大于'))
  const warning = reasons.length > 0
  const status = blocked ? 'blocked' : warning ? 'warning' : 'healthy'
  return {
    ...input,
    effectivePrice,
    grossProfitPerUnit,
    grossMarginPct,
    channelCostPerUnit,
    contributionPerUnit,
    contributionMarginPct,
    estimatedContribution: input.volume === undefined ? undefined : contributionPerUnit * nonNegative(input.volume),
    status,
    reasons,
  }
}

export function buildBusinessPricingReview(input: {
  productName: string
  currency: string
  offers: PricingOfferInput[]
  priceGapWarningPct?: number
}): BusinessPricingReview {
  const offers = input.offers.map(offerResult)
  const priceGapWarningPct = input.priceGapWarningPct ?? 15
  const priceConflicts: string[] = []
  const skus = unique(offers.map((offer) => offer.sku))
  for (const sku of skus) {
    const sameSku = offers.filter((offer) => offer.sku === sku)
    if (sameSku.length < 2) continue
    const prices = sameSku.map((offer) => offer.effectivePrice)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const spreadPct = min > 0 ? pct((max - min) / min) : 0
    if (spreadPct > priceGapWarningPct) priceConflicts.push(`${sku} 在渠道间有效成交价差异 ${spreadPct}%，超过 ${priceGapWarningPct}%：${sameSku.map((offer) => `${offer.channel}=${money(offer.effectivePrice)}`).join('，')}。`)
  }
  const blocked = offers.some((offer) => offer.status === 'blocked')
  const warning = offers.some((offer) => offer.status === 'warning') || priceConflicts.length > 0
  const status = blocked ? 'blocked' : warning ? 'partial' : offers.length > 0 ? 'ready' : 'blocked'
  const decision: PricingDecision = status === 'blocked' ? 'hold' : status === 'partial' ? 'revise' : 'proceed'
  const warnings = [...priceConflicts, ...offers.flatMap((offer) => offer.reasons.map((reason) => `${offer.sku}/${offer.channel}：${reason}`))]
  const nextActions = status === 'blocked'
    ? ['暂停扩大低于最低交易价或产生负贡献的渠道。', '重新核对产品成本、渠道费率、促销折扣和最低交易边界。']
    : status === 'partial'
      ? ['建立统一的标价、供货价、成交价和最低交易价口径。', '为渠道冲突和目标贡献毛利率设置审批与复盘规则。']
      : ['记录各渠道价格和贡献毛利率基线。', '设置价格、促销和渠道利润的定期复盘周期。']
  const review: BusinessPricingReview = {
    generatedAt: new Date().toISOString(),
    artifactType: 'business-pricing-review',
    productName: input.productName,
    currency: input.currency,
    offers,
    priceConflicts,
    status,
    decision,
    warnings,
    assumptions: ['commissionRate、discountRate 和 targetContributionMargin 使用百分比输入，例如 15 表示 15%。', '未提供 transactionPrice 时，优先使用 supplyPrice，否则按 listPrice × (1 - discountRate) 估算。', '渠道价差是风险提示，不是统一价格的自动结论；不同渠道需要结合服务、流量和履约成本判断。'],
    nextActions,
    markdown: '',
  }
  review.markdown = [
    artifactHeader('business-pricing-review', `${input.productName} 定价复盘`, status, { currency: input.currency }),
    `# ${input.productName} 定价与渠道经济复盘`,
    '',
    `- 状态：${status}`,
    `- 决策：${decision}`,
    `- 币种：${input.currency}`,
    '',
    '## 渠道价格与利润',
    '| SKU | 渠道 | 有效成交价 | 单位贡献 | 贡献毛利率 | 状态 |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    offers.length > 0 ? offers.map((offer) => `| ${offer.sku} | ${offer.channel} | ${money(offer.effectivePrice)} | ${money(offer.contributionPerUnit)} | ${offer.contributionMarginPct}% | ${offer.status} |`).join('\n') : '| 暂无 | — | — | — | — | blocked |',
    '',
    '## 价盘冲突',
    markdownList(priceConflicts),
    '',
    '## 假设与限制',
    markdownList(review.assumptions),
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return review
}

function profitabilityLine(input: ProfitabilityLineInput): ProfitabilityLineResult {
  const units = nonNegative(input.units)
  const revenuePerUnit = nonNegative(input.revenuePerUnit)
  const variableCostPerUnit = nonNegative(input.variableCostPerUnit)
  const revenue = units * revenuePerUnit + nonNegative(input.otherRevenue)
  const variableCost = units * variableCostPerUnit
  const fixedCost = nonNegative(input.fixedCost)
  const otherCost = nonNegative(input.otherCost)
  const contribution = revenue - variableCost
  const totalCost = variableCost + fixedCost + otherCost
  const profit = revenue - totalCost
  const contributionMarginPct = revenue > 0 ? pct(contribution / revenue) : 0
  const profitMarginPct = revenue > 0 ? pct(profit / revenue) : 0
  return {
    ...input,
    units,
    revenuePerUnit,
    variableCostPerUnit,
    fixedCost,
    otherRevenue: nonNegative(input.otherRevenue),
    otherCost,
    revenue,
    variableCost,
    contribution,
    totalCost,
    profit,
    contributionMarginPct,
    profitMarginPct,
    status: profit > 0 ? 'profitable' : profit < 0 ? 'loss-making' : 'break-even',
  }
}

export function buildBusinessProfitabilityReview(input: {
  businessName: string
  currency: string
  lines: ProfitabilityLineInput[]
}): BusinessProfitabilityReview {
  const lines = input.lines.map(profitabilityLine)
  const totals = lines.reduce((result, line) => ({
    revenue: result.revenue + line.revenue,
    variableCost: result.variableCost + line.variableCost,
    contribution: result.contribution + line.contribution,
    fixedCost: result.fixedCost + (line.fixedCost ?? 0),
    totalCost: result.totalCost + line.totalCost,
    profit: result.profit + line.profit,
    contributionMarginPct: 0,
    profitMarginPct: 0,
  }), { revenue: 0, variableCost: 0, contribution: 0, fixedCost: 0, totalCost: 0, profit: 0, contributionMarginPct: 0, profitMarginPct: 0 })
  totals.contributionMarginPct = totals.revenue > 0 ? pct(totals.contribution / totals.revenue) : 0
  totals.profitMarginPct = totals.revenue > 0 ? pct(totals.profit / totals.revenue) : 0
  const warnings: string[] = []
  if (lines.length === 0) warnings.push('没有提供产品、渠道或收入线，无法判断盈利能力。')
  if (lines.some((line) => line.revenue === 0)) warnings.push('存在收入为 0 的项目；请确认销量、单价或收入字段。')
  const status: BusinessProfitabilityReview['status'] = lines.length === 0 ? 'insufficient-evidence' : totals.profit > 0 ? 'profitable' : totals.profit < 0 ? 'loss-making' : 'break-even'
  const nextActions = status === 'insufficient-evidence'
    ? ['补充销量、单价、变动成本和固定成本，再运行盈利复盘。']
    : status === 'loss-making'
      ? ['优先拆解亏损项目的价格、单位成本、渠道成本和固定成本。', '做价格、销量、成本和渠道组合的敏感性分析，不只看收入增长。']
      : status === 'break-even'
        ? ['补充目标利润率和安全缓冲，避免把盈亏平衡当成可规模化模型。', '验证促销、退货、坏账和现金周转是否会侵蚀利润。']
        : ['验证利润是否来自可重复的销量、价格和成本结构。', '设置毛利、贡献利润和现金回收的定期复盘。']
  const review: BusinessProfitabilityReview = {
    generatedAt: new Date().toISOString(),
    artifactType: 'business-profitability-review',
    businessName: input.businessName,
    currency: input.currency,
    lines,
    totals,
    status,
    warnings,
    assumptions: ['fixedCost 和 otherCost 按当前复盘周期归属于对应项目。', '未提供税费、退货、坏账或现金周转数据时，profit 是管理口径估算，不等同于会计净利润。'],
    nextActions,
    markdown: '',
  }
  review.markdown = [
    artifactHeader('business-profitability-review', `${input.businessName} 盈利复盘`, status, { currency: input.currency }),
    `# ${input.businessName} 盈利能力复盘`,
    '',
    `- 状态：${status}`,
    `- 收入：${money(totals.revenue)} ${input.currency}`,
    `- 贡献利润：${money(totals.contribution)} ${input.currency}`,
    `- 利润：${money(totals.profit)} ${input.currency}`,
    `- 利润率：${totals.profitMarginPct}%`,
    '',
    '## 项目明细',
    '| 项目 | 收入 | 总成本 | 利润 | 利润率 | 状态 |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
    lines.length > 0 ? lines.map((line) => `| ${line.name} | ${money(line.revenue)} | ${money(line.totalCost)} | ${money(line.profit)} | ${line.profitMarginPct}% | ${line.status} |`).join('\n') : '| 暂无 | — | — | — | — | insufficient-evidence |',
    '',
    '## 假设与限制',
    markdownList(review.assumptions),
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return review
}

export function buildElevatorPitch(input: {
  businessName: string
  targetCustomer: string
  problem: string
  solution: string
  differentiation?: string
  proof?: string
  ask?: string
}): ElevatorPitch {
  const differentiation = clean(input.differentiation)
  const proof = clean(input.proof)
  const ask = clean(input.ask)
  const warnings: string[] = []
  if (!differentiation) warnings.push('缺少差异化，Pitch 容易退化成通用产品描述。')
  if (!proof) warnings.push('缺少证据或结果，当前表达仍是价值假设。')
  if (!ask) warnings.push('缺少下一步请求；面向投资人、客户或合作方时应明确希望对方做什么。')
  const short = `${input.businessName} 帮助${input.targetCustomer}解决“${input.problem}”，通过${input.solution}${differentiation ? `，并以${differentiation}区别于替代方案` : ''}。`
  const medium = `${short}${proof ? ` 目前的证据是：${proof}。` : ''}${ask ? ` 我们现在希望：${ask}。` : ''}`
  const long = [
    `我们服务的对象是${input.targetCustomer}。`,
    `他们在${input.problem}上遇到持续成本或风险。`,
    `我们提供${input.solution}，核心价值是让这件事变得更可预测、更高效或更有收益。`,
    differentiation ? `与现有替代方案相比，关键差异是${differentiation}。` : '目前还需要补充与替代方案的明确差异。',
    proof ? `已有证据包括：${proof}。` : '目前还需要补充客户、收入、使用或交付证据。',
    ask ? `下一步希望得到：${ask}。` : '下一步应明确希望听众提供的资源、试用、介绍或决策。',
  ].join(' ')
  const result: ElevatorPitch = {
    generatedAt: new Date().toISOString(),
    artifactType: 'elevator-pitch',
    businessName: input.businessName,
    targetCustomer: input.targetCustomer,
    problem: input.problem,
    solution: input.solution,
    differentiation,
    proof,
    ask,
    pitches: { thirtySecond: short, sixtySecond: medium, twoMinute: long },
    warnings,
    nextActions: warnings.length > 0 ? ['补充差异化、证据和明确请求，再按听众分别练习。'] : ['按客户、投资人和合作方分别调整证据与请求。', '用真实场景和结果替换抽象形容词。'],
    markdown: '',
  }
  result.markdown = [
    artifactHeader('elevator-pitch', `${input.businessName} Elevator Pitch`, warnings.length > 0 ? 'partial' : 'ready'),
    `# ${input.businessName} 电梯 Pitch`,
    '',
    '## 30 秒',
    short,
    '',
    '## 60 秒',
    medium,
    '',
    '## 2 分钟',
    long,
    '',
    '## 需要补强',
    markdownList(warnings),
    '',
  ].join('\n')
  return result
}

export function buildBusinessPlan(input: {
  businessName: string
  executiveSummary?: string
  customer: string
  problem: string
  valueProposition: string
  market: string
  businessModel: string
  pricing: string
  channels: string[]
  goToMarket: string[]
  operations: string[]
  metrics: string[]
  milestones: string[]
  risks: string[]
}): BusinessPlan {
  const missing: string[] = []
  if (!clean(input.customer)) missing.push('目标客户')
  if (!clean(input.problem)) missing.push('问题')
  if (!clean(input.valueProposition)) missing.push('价值主张')
  if (!clean(input.businessModel)) missing.push('商业模式')
  if (!clean(input.market)) missing.push('市场')
  if (!clean(input.pricing)) missing.push('定价')
  if (input.channels.length === 0) missing.push('渠道')
  if (input.goToMarket.length === 0) missing.push('获客/进入市场计划')
  if (input.metrics.length === 0) missing.push('指标')
  const status: BusinessReadiness = missing.some((item) => ['目标客户', '问题', '价值主张', '商业模式'].includes(item)) ? 'blocked' : missing.length > 0 ? 'partial' : 'ready'
  const warnings = missing.length > 0 ? [`商业计划缺少：${missing.join('、')}。`] : []
  const executiveSummary = clean(input.executiveSummary) || `${input.businessName} 面向${input.customer}，解决${input.problem}，通过${input.valueProposition}创造价值，采用${input.businessModel}，并通过${input.channels.join('、')}触达客户。`
  const nextActions = status === 'blocked'
    ? ['先补齐客户、问题、价值主张和商业模式，避免把计划写成愿望清单。']
    : status === 'partial'
      ? ['补齐缺失的市场、定价、渠道或指标证据。', '把关键假设、负责人、验证日期和退出条件写入计划。']
      : ['将商业计划中的假设连接到定价、盈利和产品决策门。', '按月或按关键里程碑复盘实际结果与计划差异。']
  const plan: BusinessPlan = {
    generatedAt: new Date().toISOString(),
    artifactType: 'business-plan',
    businessName: input.businessName,
    executiveSummary,
    customer: input.customer,
    problem: input.problem,
    valueProposition: input.valueProposition,
    market: input.market,
    businessModel: input.businessModel,
    pricing: input.pricing,
    channels: input.channels,
    goToMarket: input.goToMarket,
    operations: input.operations,
    metrics: input.metrics,
    milestones: input.milestones,
    risks: input.risks,
    status,
    warnings,
    assumptions: ['商业计划是决策和验证文档，不是对未来结果的保证。', '市场规模、价格、转化率、成本和时间表应标明来源或假设。'],
    nextActions,
    markdown: '',
  }
  plan.markdown = [
    artifactHeader('business-plan', `${input.businessName} Business Plan`, status),
    `# ${input.businessName} 商业计划`,
    '',
    '## 执行摘要',
    executiveSummary,
    '',
    '## 客户与问题',
    `- 目标客户：${input.customer || '待补充'}`,
    `- 问题：${input.problem || '待补充'}`,
    `- 价值主张：${input.valueProposition || '待补充'}`,
    '',
    '## 市场',
    input.market || '待补充',
    '',
    '## 商业模式与定价',
    `- 商业模式：${input.businessModel || '待补充'}`,
    `- 定价：${input.pricing || '待补充'}`,
    '',
    '## 渠道与进入市场',
    '**渠道**',
    markdownList(input.channels),
    '',
    '**进入市场动作**',
    markdownList(input.goToMarket),
    '',
    '## 运营',
    markdownList(input.operations),
    '',
    '## 指标与里程碑',
    '**指标**',
    markdownList(input.metrics),
    '',
    '**里程碑**',
    markdownList(input.milestones),
    '',
    '## 风险',
    markdownList(input.risks),
    '',
    '## 假设与限制',
    markdownList(plan.assumptions),
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return plan
}
