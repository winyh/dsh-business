import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  buildBusinessModelReview,
  buildBusinessPlan,
  buildBusinessPricingReview,
  buildBusinessProfitabilityReview,
  buildElevatorPitch,
} from './business.js'
import { buildCommercialHandoff } from './commercial.js'
import { auditBusinessNote, scanBusinessVault } from './context.js'
import { appendArtifactAudit, attachArtifactMetadata, contentHash, indexArtifacts, reviewArtifact } from './artifacts.js'
import { jsonValue, renderResult, resultEnvelope, resultSchema, type ResultLineage } from './output.js'
import type { BusinessEvidence, BusinessFileSystemLike, BusinessPricingReview, BusinessProfitabilityReview, PricingOfferInput, ProfitabilityLineInput } from './types.js'

export interface BusinessConfig {
  defaultRoot: string
  defaultCurrency: string
  defaultLanguage: string
  maxResultChars: number
  maxFiles: number
  maxFileBytes: number
  maxTextChars: number
}

function businessOutput(maxChars: number) {
  return { schema: resultSchema, render: (_args: unknown, value: unknown) => renderResult(value, maxChars) }
}

function lineageFromValue(value: unknown): ResultLineage[] {
  const sources = new Set<string>()
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    if (typeof record.source === 'string' && record.source.trim()) sources.add(record.source.trim())
    if (Array.isArray(record.evidence)) {
      for (const item of record.evidence) {
        if (typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).source === 'string') {
          const source = String((item as Record<string, unknown>).source).trim()
          if (source) sources.add(source)
        }
      }
    }
  }
  return [...sources].map((source) => ({ source }))
}

function wrapResult(value: unknown, options: { lineage?: ResultLineage[]; assumptions?: string[]; nextActions?: string[] } = {}) {
  const warnings = typeof value === 'object' && value !== null && 'warnings' in value && Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return resultEnvelope({ data: jsonValue(attachArtifactMetadata(value, { staleAfterDays: 90 })), warnings, assumptions: options.assumptions, lineage: options.lineage ?? lineageFromValue(value), nextActions: options.nextActions })
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

function objectFromJson(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) as unknown } catch (error) { throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
  const data = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error(`${label} must be a JSON object or result envelope.`)
  return data as Record<string, unknown>
}

function pricingReviewFromJson(value: string): BusinessPricingReview {
  const data = objectFromJson(value, 'pricingJson')
  if (data.artifactType !== 'business-pricing-review' || !Array.isArray(data.offers)) throw new Error('pricingJson must contain a business_pricing_review result.')
  return data as unknown as BusinessPricingReview
}

function profitabilityReviewFromJson(value: string): BusinessProfitabilityReview {
  const data = objectFromJson(value, 'profitabilityJson')
  if (data.artifactType !== 'business-profitability-review' || typeof data.totals !== 'object' || data.totals === null) throw new Error('profitabilityJson must contain a business_profitability_review result.')
  return data as unknown as BusinessProfitabilityReview
}

async function ensureInsideRoot(fs: BusinessFileSystemLike, config: BusinessConfig, path: string, signal?: AbortSignal): Promise<void> {
  const root = await fs.resolve(config.defaultRoot, { signal })
  const target = await fs.resolve(path, { signal })
  if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${path}`)
}

export function registerBusinessTools(ctx: Context, config: BusinessConfig, fs: BusinessFileSystemLike): void {
  ctx.tools.register(defineTool({
    name: 'business_onboarding',
    description: 'Run a read-only business readiness scan over local Markdown, CSV and JSON evidence. It identifies commercial inputs and missing source/owner metadata before calculation.',
    parameters: { root: { type: 'string', description: 'Optional directory under defaultRoot.' } },
    output: businessOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      const scan = await scanBusinessVault(fs, config, root, exec.signal)
      const status = scan.supportedNotes > 0 || scan.dataFiles.length > 0 ? scan.errors.length > 0 ? 'partial' : 'ready' : 'blocked'
      const result = { artifactType: 'business-onboarding', generatedAt: new Date().toISOString(), root, status, scan, warnings: scan.errors, nextActions: status === 'ready' ? ['运行 business_audit_note 检查关键材料，再运行 business_pricing_review/business_profitability_review。'] : ['补充产品、价格、成本或销售反馈资料，再运行 onboarding。'] }
      return wrapResult(result, { lineage: [{ source: root }], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_audit_note',
    description: 'Audit one local business Markdown note for artifact type, status, owner, updated date, source and approval boundary. It never treats a complete template as approval.',
    parameters: { path: { type: 'string', required: true, description: 'Business Markdown artifact under defaultRoot.' } },
    output: businessOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      const content = await fs.readText(target, exec.signal)
      if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`)
      const result = auditBusinessNote(args.path, content)
      return wrapResult(result, { lineage: [{ source: args.path }], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_apply_artifact',
    description: 'Preview or apply a business Markdown artifact under defaultRoot using explicit confirmation and a version guard.',
    parameters: { path: { type: 'string', required: true }, content: { type: 'string', required: true }, confirm: { type: 'boolean', required: true, description: 'false previews only; true applies the guarded write.' } },
    output: businessOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      const current = await fs.readText(target, exec.signal)
      const diff = { beforeLines: current.split(/\r?\n/).length, afterLines: args.content.split(/\r?\n/).length, changed: current !== args.content }
      if (!args.confirm) return wrapResult({ status: 'preview-only', path: args.path, applied: false, diff }, { nextActions: ['审阅 diff；确认后再次调用并设置 confirm=true。'] })
      await fs.writeText(target, args.content, { kind: 'replaceIfVersion', version: info.version }, exec.signal)
      let audit: unknown
      try { audit = await appendArtifactAudit(fs, config.defaultRoot, { action: 'apply', path: args.path, beforeHash: contentHash(current), afterHash: contentHash(args.content), approved: true }, exec.signal) } catch (error) { audit = { status: 'audit-failed', warning: error instanceof Error ? error.message : String(error) } }
      return wrapResult({ status: 'applied', path: args.path, applied: true, guarded: true, diff, audit }, { lineage: [{ source: args.path }] })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_artifact_review',
    description: 'Validate a business artifact before handing it to another plugin. Checks schema, stable ID, source hash and evidence freshness without changing files.',
    parameters: {
      artifactJson: { type: 'string', required: true, description: 'JSON returned by a plugin tool.' },
      expectedType: { type: 'string', description: 'Optional expected artifactType.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args) {
      let value: unknown
      try { value = JSON.parse(args.artifactJson) as unknown } catch (error) { throw new Error(`artifactJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
      const data = typeof value === 'object' && value !== null && 'data' in value ? (value as { data: unknown }).data : value
      const review = reviewArtifact(data, args.expectedType?.trim() || undefined)
      return wrapResult({ artifactType: 'business-artifact-review', generatedAt: new Date().toISOString(), ...review }, { nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_loop_review',
    description: 'Review the six-plugin business loop from supplied artifacts. It identifies missing gates and does not treat document existence as business validation.',
    parameters: {
      artifactsJson: { type: 'string', description: 'Optional JSON array of artifacts or result envelopes. If omitted, the plugin scans root for local artifact files.' },
      root: { type: 'string', description: 'Optional project root to scan when artifactsJson is omitted.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args, exec) {
      let artifacts: unknown[]
      let index
      if (args.artifactsJson?.trim()) {
        let parsed: unknown
        try { parsed = JSON.parse(args.artifactsJson) as unknown } catch (error) { throw new Error(`artifactsJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
        if (!Array.isArray(parsed)) throw new Error('artifactsJson must be a JSON array.')
        artifacts = parsed.map((item) => typeof item === 'object' && item !== null && 'data' in item ? (item as { data: unknown }).data : item)
      } else {
        const root = args.root?.trim() || config.defaultRoot
        await ensureInsideRoot(fs, config, root, exec.signal)
        index = await indexArtifacts(fs, root, config.maxFiles, config.maxTextChars, exec.signal)
        artifacts = index.artifacts.map((item) => item as unknown)
      }
      const reviews = index ? index.artifacts.map((item) => ({ status: item.status, warnings: item.warnings, issues: item.issues })) : artifacts.map((item) => reviewArtifact(item))
      const types = new Set(artifacts.map((item) => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).artifactType === 'string' ? (item as Record<string, unknown>).artifactType : ''))
      const gates = [
        { id: 'discovery', label: '新发现已形成机会交接', satisfied: types.has('opportunity-handoff') },
        { id: 'product', label: '产品已经形成决策或销售交接', satisfied: types.has('product-sales-handoff') || types.has('decision-review') },
        { id: 'commercial', label: '商业约束已经评估', satisfied: types.has('commercial-handoff') },
        { id: 'measurement', label: '增长或可发现性已经绑定目标指标', satisfied: types.has('growth-attribution-review') || types.has('geo-growth-measurement-plan') },
        { id: 'feedback', label: '销售/客户反馈已经回流', satisfied: types.has('sales-feedback-handoff') || types.has('product-feedback-closure') },
      ]
      const missing = gates.filter((gate) => !gate.satisfied)
      const warnings = [...new Set(reviews.flatMap((review) => review.warnings))]
      const nextActions = missing.length > 0 ? missing.map((gate) => `补齐：${gate.label}。`) : ['所有主要阶段都有结构化工件；进入 business_loop_review 的下一轮复盘，确认指标是否改善。']
      const status = reviews.some((review) => review.status === 'blocked') ? 'blocked' : missing.length > 0 ? 'partial' : reviews.some((review) => review.status === 'stale') ? 'partial' : 'ready'
      return wrapResult({ artifactType: 'business-loop-review', generatedAt: new Date().toISOString(), status, gates, missing, artifactCount: artifacts.length, indexed: index ? { root: index.root, scannedFiles: index.scannedFiles, warnings: index.warnings } : undefined, warnings, nextActions }, { nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'business_artifact_index',
    description: 'Scan a local project root for structured Markdown/JSON artifacts and report their IDs, types, freshness and validation status. Skips docs, hidden directories, node_modules and generated lib files.',
    parameters: { root: { type: 'string', description: 'Optional project root under defaultRoot.' } },
    output: businessOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      const index = await indexArtifacts(fs, root, config.maxFiles, config.maxTextChars, exec.signal)
      return wrapResult({ artifactType: 'business-artifact-index', generatedAt: new Date().toISOString(), ...index, nextActions: index.artifacts.length > 0 ? ['把需要交接的最新 artifactId 传给对应插件的 *_artifact_review。'] : ['先运行 idea/product/business/geo/growth/sales 工具生成结构化工件。'] }, { lineage: [{ source: root }] })
    },
  }))

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
    name: 'business_commercial_handoff',
    description: 'Turn a business_pricing_review and optional business_profitability_review into a versioned commercial-handoff for dsh-sales or dsh-product. It preserves calculated facts and risks but never grants price approval, discount authority or a revenue commitment.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product or offer portfolio name.' },
      handoffTo: { type: 'string', required: true, enum: ['dsh-sales', 'dsh-product'], description: 'Intended consumer of the commercial constraints.' },
      pricingJson: { type: 'string', required: true, description: 'JSON returned by business_pricing_review, including its result envelope or data object.' },
      profitabilityJson: { type: 'string', description: 'Optional JSON returned by business_profitability_review.' },
      source: { type: 'string', description: 'Source artifact path or approval record path.' },
    },
    output: businessOutput(config.maxResultChars),
    async execute(args) {
      const handoff = buildCommercialHandoff({
        productName: args.productName,
        handoffTo: args.handoffTo as 'dsh-sales' | 'dsh-product',
        pricing: pricingReviewFromJson(args.pricingJson),
        profitability: args.profitabilityJson ? profitabilityReviewFromJson(args.profitabilityJson) : undefined,
        source: args.source,
      })
      return wrapResult(handoff, { lineage: args.source ? [{ source: args.source }] : [], nextActions: handoff.nextActions })
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
