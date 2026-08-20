import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  buildBusinessModelReview,
  buildBusinessPlan,
  buildBusinessPricingReview,
  buildBusinessProfitabilityReview,
  buildElevatorPitch,
} from './business.js'
import { jsonValue, renderResult, resultEnvelope, resultSchema } from './output.js'
import type { BusinessEvidence, PricingOfferInput, ProfitabilityLineInput } from './types.js'

export interface BusinessConfig {
  defaultCurrency: string
  defaultLanguage: string
  maxResultChars: number
}

function businessOutput(maxChars: number) {
  return { schema: resultSchema, render: (_args: unknown, value: unknown) => renderResult(value, maxChars) }
}

function wrapResult(value: unknown, options: { assumptions?: string[]; nextActions?: string[] } = {}) {
  const warnings = typeof value === 'object' && value !== null && 'warnings' in value && Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return resultEnvelope({ data: jsonValue(value), warnings, assumptions: options.assumptions, nextActions: options.nextActions })
}

function stringList(value: string | undefined, label: string): string[] {
  if (!value?.trim()) return []
  const trimmed = value.trim()
  try {
    if (trimmed.startsWith('[')) {
      const parsed: unknown = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) throw new Error('Expected an array.')
      return parsed.map((item) => String(item).trim()).filter(Boolean)
    }
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return trimmed.split(/\r?\n|\s*;\s*|\s*\|\s*/).map((item) => item.replace(/^[-*]\s+/, '').trim()).filter(Boolean)
}

function optionalNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  if (value === undefined || value === null || value === '') return undefined
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) throw new Error(`${key} must be a finite number.`)
  return number
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  return optionalNumber(record, key) ?? 0
}

function evidenceFromJson(value: string | undefined): BusinessEvidence[] {
  if (!value?.trim()) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('evidence must be a JSON array.')
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`evidence[${index}] must be an object.`)
    const record = item as Record<string, unknown>
    const status = String(record.status ?? 'missing') as BusinessEvidence['status']
    if (!['fact', 'assumption', 'missing'].includes(status)) throw new Error(`evidence[${index}].status is invalid.`)
    const label = String(record.label ?? record.name ?? '').trim()
    if (!label) throw new Error(`evidence[${index}].label is required.`)
    return {
      id: String(record.id ?? `E${index + 1}`),
      label,
      status,
      evidence: record.evidence === undefined || record.evidence === null ? undefined : String(record.evidence),
      source: record.source === undefined || record.source === null ? undefined : String(record.source),
    }
  })
}

function offersFromJson(value: string): PricingOfferInput[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('offers must be a JSON array.')
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`offers[${index}] must be an object.`)
    const record = item as Record<string, unknown>
    const sku = String(record.sku ?? '').trim()
    const channel = String(record.channel ?? '').trim()
    if (!sku || !channel) throw new Error(`offers[${index}] requires sku and channel.`)
    return {
      sku,
      channel,
      listPrice: requiredNumber(record, 'listPrice'),
      transactionPrice: optionalNumber(record, 'transactionPrice'),
      supplyPrice: optionalNumber(record, 'supplyPrice'),
      unitCost: requiredNumber(record, 'unitCost'),
      commissionRate: optionalNumber(record, 'commissionRate'),
      discountRate: optionalNumber(record, 'discountRate'),
      logisticsPerUnit: optionalNumber(record, 'logisticsPerUnit'),
      otherVariableCostPerUnit: optionalNumber(record, 'otherVariableCostPerUnit'),
      minimumTransactionPrice: optionalNumber(record, 'minimumTransactionPrice'),
      targetContributionMargin: optionalNumber(record, 'targetContributionMargin'),
      volume: optionalNumber(record, 'volume'),
    }
  })
}

function profitabilityLinesFromJson(value: string): ProfitabilityLineInput[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('lines must be a JSON array.')
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`lines[${index}] must be an object.`)
    const record = item as Record<string, unknown>
    const name = String(record.name ?? '').trim()
    if (!name) throw new Error(`lines[${index}].name is required.`)
    return {
      name,
      units: requiredNumber(record, 'units'),
      revenuePerUnit: requiredNumber(record, 'revenuePerUnit'),
      variableCostPerUnit: requiredNumber(record, 'variableCostPerUnit'),
      fixedCost: optionalNumber(record, 'fixedCost'),
      otherRevenue: optionalNumber(record, 'otherRevenue'),
      otherCost: optionalNumber(record, 'otherCost'),
    }
  })
}

export function registerBusinessTools(ctx: Context, config: BusinessConfig): void {
  ctx.tools.register(defineTool({
    name: 'business_model_review',
    description: 'Review a business model across customer, value proposition, revenue streams, pricing model, channels, cost drivers and evidence. It distinguishes a missing business case from a disproved one.',
    parameters: {
      businessName: { type: 'string', required: true, description: 'Business or product name.' },
      targetCustomer: { type: 'string', required: true, description: 'Target customer or buyer.' },
      valueProposition: { type: 'string', required: true, description: 'Customer value delivered.' },
      revenueStreams: { type: 'string', required: true, description: 'JSON array or newline-separated revenue streams.' },
      pricingModel: { type: 'string', required: true, description: 'Pricing or charging model.' },
      channels: { type: 'string', required: true, description: 'JSON array or newline-separated acquisition/distribution channels.' },
      costDrivers: { type: 'string', required: true, description: 'JSON array or newline-separated cost drivers.' },
      evidence: { type: 'string', description: 'Optional JSON array of {id,label,status,evidence,source}; status is fact, assumption or missing.' },
      fitStatus: { type: 'string', description: 'Optional fit assessment: promising, uncertain or disproved.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args) {
      const fitStatus = args.fitStatus?.trim()
      if (fitStatus && !['promising', 'uncertain', 'disproved'].includes(fitStatus)) throw new Error('fitStatus must be promising, uncertain or disproved.')
      const review = buildBusinessModelReview({
        businessName: args.businessName,
        targetCustomer: args.targetCustomer,
        valueProposition: args.valueProposition,
        revenueStreams: stringList(args.revenueStreams, 'revenueStreams'),
        pricingModel: args.pricingModel,
        channels: stringList(args.channels, 'channels'),
        costDrivers: stringList(args.costDrivers, 'costDrivers'),
        evidence: evidenceFromJson(args.evidence),
        fitStatus: fitStatus as 'promising' | 'uncertain' | 'disproved' | undefined,
      })
      return wrapResult(review, { assumptions: review.assumptions, nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_pricing_review',
    description: 'Review price architecture and channel economics. Calculates effective price, gross margin, contribution margin, minimum transaction price violations and cross-channel price conflicts.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product or SKU portfolio name.' },
      currency: { type: 'string', description: 'Currency code; defaults to configured currency.' },
      offers: { type: 'string', required: true, description: 'JSON array of offers with sku, channel, listPrice, unitCost and optional transactionPrice, supplyPrice, commissionRate, discountRate, logisticsPerUnit, minimumTransactionPrice, targetContributionMargin and volume.' },
      priceGapWarningPct: { type: 'number', description: 'Cross-channel effective-price spread warning threshold; defaults to 15.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args) {
      const review = buildBusinessPricingReview({ productName: args.productName, currency: args.currency?.trim() || config.defaultCurrency, offers: offersFromJson(args.offers), priceGapWarningPct: args.priceGapWarningPct })
      return wrapResult(review, { assumptions: review.assumptions, nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_profitability_review',
    description: 'Review profitability by product, channel or business line. Calculates revenue, variable cost, contribution, total cost, profit and margins; it does not claim accounting net profit without tax, returns, bad-debt and cash data.',
    parameters: {
      businessName: { type: 'string', required: true, description: 'Business name.' },
      currency: { type: 'string', description: 'Currency code; defaults to configured currency.' },
      lines: { type: 'string', required: true, description: 'JSON array of {name,units,revenuePerUnit,variableCostPerUnit,fixedCost,otherRevenue,otherCost}.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args) {
      const review = buildBusinessProfitabilityReview({ businessName: args.businessName, currency: args.currency?.trim() || config.defaultCurrency, lines: profitabilityLinesFromJson(args.lines) })
      return wrapResult(review, { assumptions: review.assumptions, nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_elevator_pitch',
    description: 'Create 30-second, 60-second and 2-minute elevator pitches from customer, problem, solution, differentiation, proof and ask. It marks missing evidence instead of inventing traction.',
    parameters: {
      businessName: { type: 'string', required: true, description: 'Business or product name.' },
      targetCustomer: { type: 'string', required: true, description: 'Who the business serves.' },
      problem: { type: 'string', required: true, description: 'Important customer problem.' },
      solution: { type: 'string', required: true, description: 'What the business provides.' },
      differentiation: { type: 'string', description: 'Why this is different or better.' },
      proof: { type: 'string', description: 'Evidence such as usage, paid customers, retention, savings or outcomes.' },
      ask: { type: 'string', description: 'What the listener should do next.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args) {
      const pitch = buildElevatorPitch({ businessName: args.businessName, targetCustomer: args.targetCustomer, problem: args.problem, solution: args.solution, differentiation: args.differentiation, proof: args.proof, ask: args.ask })
      return wrapResult(pitch, { nextActions: pitch.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_plan',
    description: 'Generate an evidence-aware business plan covering executive summary, customer, problem, value proposition, market, business model, pricing, channels, go-to-market, operations, metrics, milestones and risks.',
    parameters: {
      businessName: { type: 'string', required: true, description: 'Business or product name.' },
      executiveSummary: { type: 'string', description: 'Optional answer-first executive summary.' },
      customer: { type: 'string', required: true, description: 'Target customer or buyer.' },
      problem: { type: 'string', required: true, description: 'Customer problem.' },
      valueProposition: { type: 'string', required: true, description: 'Customer value proposition.' },
      market: { type: 'string', required: true, description: 'Market, segment and demand context.' },
      businessModel: { type: 'string', required: true, description: 'How the business creates, delivers and captures value.' },
      pricing: { type: 'string', required: true, description: 'Pricing architecture or charging approach.' },
      channels: { type: 'string', required: true, description: 'JSON array or newline-separated channels.' },
      goToMarket: { type: 'string', required: true, description: 'JSON array or newline-separated go-to-market actions.' },
      operations: { type: 'string', description: 'JSON array or newline-separated operating capabilities.' },
      metrics: { type: 'string', required: true, description: 'JSON array or newline-separated success metrics.' },
      milestones: { type: 'string', description: 'JSON array or newline-separated milestones.' },
      risks: { type: 'string', description: 'JSON array or newline-separated risks and mitigations.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args) {
      const plan = buildBusinessPlan({
        businessName: args.businessName,
        executiveSummary: args.executiveSummary,
        customer: args.customer,
        problem: args.problem,
        valueProposition: args.valueProposition,
        market: args.market,
        businessModel: args.businessModel,
        pricing: args.pricing,
        channels: stringList(args.channels, 'channels'),
        goToMarket: stringList(args.goToMarket, 'goToMarket'),
        operations: stringList(args.operations, 'operations'),
        metrics: stringList(args.metrics, 'metrics'),
        milestones: stringList(args.milestones, 'milestones'),
        risks: stringList(args.risks, 'risks'),
      })
      return wrapResult(plan, { assumptions: plan.assumptions, nextActions: plan.nextActions })
    },
  }))

  ctx.logger.info(`[dsh-business] registered business strategy tools with default currency ${config.defaultCurrency}`)
}
