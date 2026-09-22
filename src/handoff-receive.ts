import { artifactDomain, reviewArtifact } from './artifacts.js'
import { validDate } from './artifact-integrity.js'
import { handoffRoutes } from './handoff-routes.js'

export interface HandoffRoute {
  from: string
  nextTool: string
  purpose: string
  text: string[]
  lists: string[]
  mode: 'direct' | 'reference'
}

export const handoffParameters = {
  artifactJson: { type: 'string', required: true, description: 'Original JSON artifact or successful result envelope; preserve its checksum.' },
  initiativeId: { type: 'string', required: true, description: 'Stable ID shared by all receipts for this business initiative.' },
  owner: { type: 'string', required: true, description: 'Human responsible for the next action.' },
  action: { type: 'string', required: true, description: 'Concrete next action, not a claim of completion.' },
  dueDate: { type: 'string', required: true, description: 'ISO date or timestamp for the action deadline.' },
} as const

export interface ReceiveOptions { initiativeId: string; owner: string; action: string; dueDate: string }
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function meaningful(value: unknown): boolean {
  return typeof value === 'string' ? !!value.trim() : Object.keys(asRecord(value)).length > 0
}

export function receiveHandoff(value: unknown, options: ReceiveOptions) {
  const envelope = asRecord(value)
  const isEnvelope = Object.hasOwn(envelope, 'data')
  const source = asRecord(isEnvelope ? envelope.data : value)
  const review = reviewArtifact(source)
  const issues = [...review.issues]
  const warnings = [...review.warnings]
  const missing: string[] = []
  const sourceType = text(source.artifactType)
  const route: HandoffRoute | undefined = Object.hasOwn(handoffRoutes, sourceType) ? handoffRoutes[sourceType] : undefined
  if (isEnvelope && envelope.ok !== true) issues.push('来源工具未成功，不能消费其 data。')
  if (!route) issues.push(`本插件不接收 ${sourceType || 'unknown'}，请按职责交接。`)
  if (route) {
    if (source.handoffFrom !== route.from) issues.push(`handoffFrom 必须为 ${route.from}。`)
    if (route.mode === 'direct' && source.handoffTo !== artifactDomain) issues.push(`handoffTo 必须为 ${artifactDomain}，不能消费发给其他插件的交接。`)
    for (const field of route.text) if (!text(source[field])) missing.push(field)
    for (const field of route.lists) {
      const values = source[field]
      if (!Array.isArray(values) || values.length === 0 || !values.every(meaningful)) missing.push(field)
    }
  }
  for (const field of ['initiativeId', 'owner', 'action'] as const) if (!options[field].trim()) missing.push(field)
  if (!validDate(options.dueDate)) issues.push('dueDate 必须是有效 ISO 日期或时间。')
  else if (Date.parse(options.dueDate.length === 10 ? options.dueDate + 'T23:59:59Z' : options.dueDate) < Date.now()) missing.push('dueDate 已逾期，请明确新的行动日期')
  if (source.initiativeId && source.initiativeId !== options.initiativeId.trim()) issues.push('initiativeId 与来源不一致。')
  if (['blocked', 'stale', 'rejected'].includes(text(source.status)) || ['hold', 'stop'].includes(text(source.decision))) issues.push('上游工件要求停止或重新审查，不能向下推进。')
  if (['partial', 'draft', 'open', 'implemented', 'accepted'].includes(text(source.status))) missing.push('上游尚未完成验证')
  if (review.status === 'stale') issues.push('来源已过期，必须回到生产插件重新核验。')
  if (sourceType === 'opportunity-handoff' && Object.keys(asRecord(source.validationExperiment)).length === 0) missing.push('validationExperiment')
  if (sourceType === 'product-sales-handoff' && !['proceed', 'scale'].includes(text(source.productDecision))) missing.push('productDecision')
  if (sourceType === 'product-feedback-closure' && source.status !== 'verified') missing.push('反馈尚未 verified')
  if (sourceType === 'sales-feedback-handoff') {
    if (!['dsh-growth'].includes(artifactDomain) && (!Array.isArray(source.feedback) || !source.feedback.length
      || !source.feedback.every(value => {
        const row = asRecord(value)
        return typeof row.reason === 'string' && !!row.reason.trim()
          && typeof row.count === 'number' && Number.isInteger(row.count) && row.count > 0
      }))) missing.push('feedback.reason/count')
    const summary = asRecord(source.summary)
    if (![summary.won, summary.lost].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0)) missing.push('summary.won/lost')
    else if (Number(summary.won) + Number(summary.lost) === 0) missing.push('没有可复盘的成交或失单记录')
  }
  const sourceWarnings = [source.warnings, envelope.warnings].flatMap(items => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string' && !!item.trim()) : [])
  // Warnings remain visible; acceptance only acknowledges a review assignment.
  const status = issues.length > 0 ? 'blocked' : missing.length > 0 || review.status !== 'ready' ? 'needs-validation' : 'accepted'
  const contextKeys = [...new Set([...(route?.text ?? []), ...(route?.lists ?? []), 'validationExperiment', 'riskiestAssumption', 'summary', 'feedback', 'openQuestions', 'commercialQuestions', 'requiredApprovals', 'risks', 'claimBoundaries', 'sourceArtifactId'])]
  const context = Object.fromEntries(contextKeys.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
  const nextActions = status === 'accepted'
    ? [`${options.owner.trim()}：在 ${options.dueDate} 前${options.action.trim()}。`, `下一工具：${route?.nextTool}。`, route?.purpose ?? '']
    : [...issues, ...missing.map(field => `补齐或核验：${field}。`), '修正来源并重新接收；不要修改回执状态冒充完成。']
  return {
    artifactType: 'handoff-receipt', generatedAt: new Date().toISOString(), initiativeId: options.initiativeId.trim(),
    receivedBy: artifactDomain, mode: route?.mode ?? 'direct', status,
    sourceArtifactId: text(source.artifactId), sourceArtifactType: sourceType,
    sourceContentHash: text(source.contentHash), sourceProducer: text(source.handoffFrom),
    sourceStatus: text(source.status), owner: options.owner.trim(), action: options.action.trim(), dueDate: options.dueDate,
    nextTool: route?.nextTool ?? '', purpose: route?.purpose ?? '', context,
    issues, missing, warnings: [...new Set([...warnings, ...sourceWarnings])],
    approvalGranted: false, completionClaimed: false, nextActions,
  }
}
