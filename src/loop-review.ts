import { reviewArtifact } from './artifacts.js'
import { validDate } from './artifact-integrity.js'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function reviewLoopArtifacts(values: unknown[], initiativeId: string) {
  const issues: string[] = []
  const warnings: string[] = []
  const unique = new Map<string, Record<string, unknown>>()
  let duplicates = 0
  for (const value of values) {
    const envelope = record(value)
    if (Object.hasOwn(envelope, 'data') && envelope.ok !== true) { issues.push('存在失败的工具结果，不能用于闭环。'); continue }
    const item = record(Object.hasOwn(envelope, 'data') ? envelope.data : value)
    const id = typeof item.artifactId === 'string' ? item.artifactId : ''
    if (!id) { issues.push('存在没有 artifactId 的工件。'); continue }
    const previous = unique.get(id)
    if (previous) {
      duplicates += 1
      if (previous.contentHash !== item.contentHash) issues.push(`同一 artifactId 存在冲突版本：${id}。请明确最新版本并刷新回执。`)
    } else unique.set(id, item)
  }
  if (!initiativeId.trim()) issues.push('必须提供 initiativeId，以免把不同事项的工件拼成闭环。')
  const artifacts = [...unique.values()]
  const reviews = new Map(artifacts.map(item => {
    const review = reviewArtifact(item)
    if (review.status === 'blocked') issues.push(...review.issues.map(issue => `${String(item.artifactId)}：${issue}`))
    warnings.push(...review.warnings)
    return [item.artifactId, review]
  }))
  const receipts = artifacts.filter(item => item.artifactType === 'handoff-receipt'
    && item.initiativeId === initiativeId.trim() && item.status === 'accepted')
  const usable = receipts.filter(receipt => {
    const source = unique.get(String(receipt.sourceArtifactId))
    if (!source || source.contentHash !== receipt.sourceContentHash) {
      warnings.push(`回执 ${String(receipt.artifactId)} 缺少对应原工件或绑定的版本已变化。`)
      return false
    }
    if (source.initiativeId && source.initiativeId !== initiativeId.trim()) {
      issues.push('回执与来源不属于同一事项。')
      return false
    }
    return reviews.get(receipt.artifactId)?.status === 'ready' && reviews.get(source.artifactId)?.status === 'ready'
      && validDate(receipt.dueDate)
      && receipt.sourceArtifactType === source.artifactType
      && typeof receipt.owner === 'string' && !!receipt.owner.trim()
      && typeof receipt.action === 'string' && !!receipt.action.trim()
      && receipt.approvalGranted === false && receipt.completionClaimed === false
  })
  const has = (receiver: string, type: string) => usable.some(item => item.receivedBy === receiver && item.sourceArtifactType === type)
  const productOpportunity = usable.find(item => item.receivedBy === 'dsh-product' && item.sourceArtifactType === 'opportunity-handoff')
  const commercialContext = usable.some(item => item.receivedBy === 'dsh-business'
    && item.sourceArtifactType === 'opportunity-handoff' && item.sourceArtifactId === productOpportunity?.sourceArtifactId)
  const closure = usable.find(item => {
    if (item.receivedBy !== 'dsh-sales' || item.sourceArtifactType !== 'product-feedback-closure') return false
    const closed = unique.get(String(item.sourceArtifactId))
    const feedback = closed && unique.get(String(closed.sourceArtifactId))
    const verification = record(closed?.verification)
    return closed?.status === 'verified' && verification.result === 'passed'
      && typeof verification.method === 'string' && !!verification.method.trim()
      && typeof verification.source === 'string' && !!verification.source.trim()
      && validDate(verification.observedAt) && validDate(feedback?.generatedAt)
      && Date.parse(verification.observedAt) >= Date.parse(feedback.generatedAt) && Date.parse(verification.observedAt) <= Date.now()
      && closed.initiativeId === initiativeId.trim()
      && typeof closed.evidence === 'string' && !!closed.evidence.trim()
      && feedback?.artifactType === 'sales-feedback-handoff' && feedback.contentHash === closed.sourceContentHash
      && usable.some(receipt => receipt.receivedBy === 'dsh-product' && receipt.sourceArtifactId === closed.sourceArtifactId)
  })
  const productMetrics = new Set(usable.filter(item => item.receivedBy === 'dsh-growth' && item.sourceArtifactType === 'growth-handoff')
    .map(item => unique.get(String(item.sourceArtifactId))?.primaryMetric))
  const publicMetrics = new Set(usable.filter(item => item.receivedBy === 'dsh-geo' && item.sourceArtifactType === 'product-discoverability-handoff')
    .map(item => unique.get(String(item.sourceArtifactId))?.targetMetric))
  const measured = artifacts.some(item => item.artifactType === 'growth-attribution-review' && item.status === 'measured'
    && reviews.get(item.artifactId)?.status === 'ready' && Array.isArray(item.results) && item.results.length > 0
    && item.results.every(value => {
      const result = record(value)
      const plan = unique.get(String(result.planArtifactId))
      return result.status === 'measured' && plan?.contentHash === result.planContentHash
        && productMetrics.has(plan?.targetMetric) && publicMetrics.has(plan?.targetMetric)
        && usable.some(receipt => receipt.receivedBy === 'dsh-growth' && receipt.sourceArtifactId === result.planArtifactId)
    }))
  const gates = [
    { id: 'discovery', label: '产品已接收机会原件', satisfied: !!productOpportunity },
    { id: 'commercial', label: '同一机会经过商业审查，商业约束已被销售接收', satisfied: commercialContext && has('dsh-sales', 'commercial-handoff') },
    { id: 'product', label: '销售已接收产品价值与交付边界', satisfied: has('dsh-sales', 'product-sales-handoff') },
    { id: 'discoverability', label: 'GEO 已接收允许公开的事实与禁止承诺', satisfied: has('dsh-geo', 'product-discoverability-handoff') },
    { id: 'measurement', label: '增长已接收产品指标和 GEO 计划，并提供绑定版本的实际观测', satisfied: has('dsh-growth', 'growth-handoff') && has('dsh-growth', 'geo-growth-measurement-plan') && measured },
    { id: 'feedback', label: '产品已接收销售反馈并明确处理动作', satisfied: has('dsh-product', 'sales-feedback-handoff') },
    { id: 'closure', label: '反馈完成复验，且原反馈方接收了对应版本的处理结果', satisfied: !!closure },
  ]
  const missing = gates.filter(gate => !gate.satisfied)
  const status = issues.length ? 'blocked' : missing.length ? 'partial' : 'ready'
  return {
    artifactType: 'business-loop-review', generatedAt: new Date().toISOString(), initiativeId: initiativeId.trim(),
    status, coordinationClosed: status === 'ready', businessImpact: measured ? 'observed-not-attributed' : 'not-measured',
    gates, missing, artifactCount: artifacts.length, duplicates,
    acceptedReceiptCount: usable.length, issues, warnings: [...new Set(warnings)],
    newDiscoveryReceived: has('dsh-idea', 'sales-feedback-handoff'),
    nextActions: [
      ...issues,
      ...missing.map(gate => `补齐：${gate.label}。请提交原工件和同一 initiativeId 的接收回执。`),
      ...(status === 'ready' ? ['协作反馈链已闭合；接收和复验不等于成交、留存或利润改善，请用实际业务数据复盘。'] : []),
      '发现新的市场问题时，将面向 dsh-idea 的销售反馈交给 idea_handoff_receive；不必为了凑齐流程编造新发现。',
    ],
  }
}
