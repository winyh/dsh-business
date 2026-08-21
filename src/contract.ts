export interface SuiteContractIssue {
  field: string
  message: string
}

export interface SuiteContractReview {
  ok: boolean
  issues: SuiteContractIssue[]
  nextActions: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateSuiteResultEnvelope(value: unknown): SuiteContractReview {
  const issues: SuiteContractIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ field: 'root', message: '结果必须是 JSON object。' }], nextActions: ['返回 schemaVersion、ok、data、warnings、assumptions、lineage 和 nextActions。'] }
  if (value.schemaVersion !== '1.0') issues.push({ field: 'schemaVersion', message: '必须为 1.0。' })
  if (value.ok !== true) issues.push({ field: 'ok', message: '必须为 true；失败结果需要由调用方明确处理。' })
  for (const field of ['warnings', 'assumptions', 'lineage', 'nextActions']) {
    if (!Array.isArray(value[field])) issues.push({ field, message: '必须是数组。' })
  }
  return { ok: issues.length === 0, issues, nextActions: issues.length === 0 ? ['继续按 data、lineage 和 nextActions 消费，不要忽略 warnings。'] : ['补齐统一结果外层后再交给下游插件。'] }
}

export function validateSuiteArtifact(value: unknown, expected: { artifactType?: string; handoffFrom?: string; handoffTo?: string } = {}): SuiteContractReview {
  const issues: SuiteContractIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ field: 'root', message: '工件必须是 JSON object。' }], nextActions: ['返回 schemaVersion、artifactId 和 artifactType。'] }
  if (value.schemaVersion !== '1.0') issues.push({ field: 'schemaVersion', message: '必须为 1.0。' })
  if (typeof value.artifactId !== 'string' || !value.artifactId.trim()) issues.push({ field: 'artifactId', message: '必须是稳定、可追踪的非空字符串。' })
  if (typeof value.artifactType !== 'string' || !value.artifactType.trim()) issues.push({ field: 'artifactType', message: '必须标识工件用途。' })
  if (expected.artifactType && value.artifactType !== expected.artifactType) issues.push({ field: 'artifactType', message: `应为 ${expected.artifactType}。` })
  if (expected.handoffFrom && value.handoffFrom !== expected.handoffFrom) issues.push({ field: 'handoffFrom', message: `应为 ${expected.handoffFrom}。` })
  if (expected.handoffTo && value.handoffTo !== expected.handoffTo) issues.push({ field: 'handoffTo', message: `应为 ${expected.handoffTo}。` })
  return { ok: issues.length === 0, issues, nextActions: issues.length === 0 ? ['保留来源、证据和下一步，再交给目标插件。'] : ['修复契约字段或停止交接；不要靠缺失字段推断业务结论。'] }
}
