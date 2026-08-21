export type BusinessReadiness = 'ready' | 'partial' | 'blocked'
export type BusinessEvidenceStatus = 'fact' | 'assumption' | 'missing'
export type BusinessDecision = 'proceed' | 'revise' | 'hold' | 'reject'
export type PricingDecision = 'proceed' | 'revise' | 'hold'
export type OfferStatus = 'healthy' | 'warning' | 'blocked'
export type ProfitabilityStatus = 'profitable' | 'break-even' | 'loss-making' | 'insufficient-evidence'

export interface BusinessEvidence {
  id: string
  label: string
  status: BusinessEvidenceStatus
  evidence?: string
  source?: string
}

export interface BusinessModelReview {
  generatedAt: string
  artifactType: 'business-model-review'
  businessName: string
  targetCustomer: string
  valueProposition: string
  revenueStreams: string[]
  pricingModel: string
  channels: string[]
  costDrivers: string[]
  evidence: BusinessEvidence[]
  status: BusinessReadiness
  decision: BusinessDecision
  missing: string[]
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
  markdown: string
}

export interface PricingOfferInput {
  sku: string
  channel: string
  listPrice: number
  transactionPrice?: number
  supplyPrice?: number
  unitCost: number
  commissionRate?: number
  discountRate?: number
  logisticsPerUnit?: number
  otherVariableCostPerUnit?: number
  minimumTransactionPrice?: number
  targetContributionMargin?: number
  volume?: number
}

export interface PricingOfferResult extends PricingOfferInput {
  effectivePrice: number
  grossProfitPerUnit: number
  grossMarginPct: number
  channelCostPerUnit: number
  contributionPerUnit: number
  contributionMarginPct: number
  estimatedContribution?: number
  status: OfferStatus
  reasons: string[]
}

export interface BusinessPricingReview {
  generatedAt: string
  artifactType: 'business-pricing-review'
  productName: string
  currency: string
  offers: PricingOfferResult[]
  priceConflicts: string[]
  status: BusinessReadiness
  decision: PricingDecision
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
  markdown: string
}

export interface ProfitabilityLineInput {
  name: string
  units: number
  revenuePerUnit: number
  variableCostPerUnit: number
  fixedCost?: number
  otherRevenue?: number
  otherCost?: number
}

export interface ProfitabilityLineResult extends ProfitabilityLineInput {
  revenue: number
  variableCost: number
  contribution: number
  totalCost: number
  profit: number
  contributionMarginPct: number
  profitMarginPct: number
  status: Exclude<ProfitabilityStatus, 'insufficient-evidence'>
}

export interface BusinessProfitabilityReview {
  generatedAt: string
  artifactType: 'business-profitability-review'
  businessName: string
  currency: string
  lines: ProfitabilityLineResult[]
  totals: {
    revenue: number
    variableCost: number
    contribution: number
    fixedCost: number
    totalCost: number
    profit: number
    contributionMarginPct: number
    profitMarginPct: number
  }
  status: ProfitabilityStatus
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
  markdown: string
}

export interface ElevatorPitch {
  generatedAt: string
  artifactType: 'elevator-pitch'
  businessName: string
  targetCustomer: string
  problem: string
  solution: string
  differentiation: string
  proof: string
  ask: string
  pitches: {
    thirtySecond: string
    sixtySecond: string
    twoMinute: string
  }
  warnings: string[]
  nextActions: string[]
  markdown: string
}

export interface BusinessPlan {
  generatedAt: string
  artifactType: 'business-plan'
  businessName: string
  executiveSummary: string
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
  status: BusinessReadiness
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
  markdown: string
}

export interface CommercialOfferSummary {
  sku: string
  channel: string
  effectivePrice: number
  minimumTransactionPrice?: number
  unitCost: number
  contributionPerUnit: number
  contributionMarginPct: number
  status: OfferStatus
}

export interface BusinessCommercialHandoff {
  handoffVersion: '1.0'
  artifactType: 'commercial-handoff'
  handoffFrom: 'dsh-business'
  handoffTo: 'dsh-sales' | 'dsh-product'
  generatedAt: string
  status: 'ready-for-review' | 'partial' | 'blocked'
  decision: 'review' | 'hold'
  productName: string
  currency: string
  offers: CommercialOfferSummary[]
  profitabilitySummary?: {
    status: ProfitabilityStatus
    revenue: number
    contribution: number
    profit: number
    profitMarginPct: number
  }
  risks: string[]
  requiredApprovals: string[]
  source?: string
  warnings: string[]
  nextActions: string[]
  markdown: string
}
