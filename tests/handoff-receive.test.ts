import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { artifactDomain, attachArtifactMetadata, reviewArtifact } from '../src/artifacts.js'
import { handoffRoutes } from '../src/handoff-routes.js'
import { receiveHandoff } from '../src/handoff-receive.js'

const options = { initiativeId: 'initiative-demo', owner: 'Demo owner', action: '核验原证据并记录下一步', dueDate: '2026-09-30' }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T12:00:00Z')) })
afterEach(() => vi.useRealTimers())

function fixture(type: string, changes: Record<string, unknown> = {}) {
  const route = handoffRoutes[type]!
  const raw: Record<string, unknown> = {
    artifactType: type, handoffFrom: route.from, handoffTo: route.mode === 'direct' ? artifactDomain : 'dsh-product',
    status: type === 'product-feedback-closure' ? 'verified' : 'ready', generatedAt: new Date().toISOString(),
    validationExperiment: { method: 'interview', successThreshold: '3/5' },
    productDecision: 'proceed', summary: { won: 1, lost: 2 }, warnings: ['不是业务效果或审批证明'],
  }
  for (const field of route.text) raw[field] = 'fixture-' + field
  for (const field of route.lists) raw[field] = ['fixture-evidence']
  if (type === 'sales-feedback-handoff') raw.feedback = [{ reason: '模拟失单原因', count: 2, target: artifactDomain }]
  return attachArtifactMetadata({ ...raw, ...changes }, { staleAfterDays: 30 })
}

describe('owned handoff receipt', () => {
  for (const type of Object.keys(handoffRoutes)) {
    it('receives ' + type + ' with an owned next step and retained constraints', () => {
      const artifact = fixture(type)
      const receipt = receiveHandoff({ ok: true, data: artifact }, options)
      expect(receipt.status).toBe('accepted')
      expect(receipt.sourceArtifactId).toBe(artifact.artifactId)
      expect(receipt.sourceContentHash).toBe(artifact.contentHash)
      expect(receipt.approvalGranted).toBe(false)
      expect(receipt.completionClaimed).toBe(false)
      expect(receipt.warnings).toContain('不是业务效果或审批证明')
      expect(receipt.nextTool).toBe(handoffRoutes[type]!.nextTool)
    })
  }
  const type = Object.keys(handoffRoutes)[0]!
  it('rejects failed calls, wrong producers, unknown types and tampered payloads', () => {
    expect(receiveHandoff({ ok: false, data: fixture(type) }, options).status).toBe('blocked')
    expect(receiveHandoff(fixture(type, { handoffFrom: 'dsh-other' }), options).status).toBe('blocked')
    expect(receiveHandoff(attachArtifactMetadata({ artifactType: 'constructor' }), options).status).toBe('blocked')
    expect(receiveHandoff({ ...fixture(type), warnings: [] }, options).status).toBe('blocked')
  })
  it('rejects misrouting for direct handoffs', () => {
    const direct = Object.keys(handoffRoutes).find(key => handoffRoutes[key]!.mode === 'direct')
    if (direct) expect(receiveHandoff(fixture(direct, { handoffTo: 'dsh-other' }), options).status).toBe('blocked')
  })
  it('does not promote incomplete evidence, stale inputs or blank ownership', () => {
    const required = handoffRoutes[type]!.text[0]!
    expect(receiveHandoff(fixture(type, { [required]: ' ' }), options).status).toBe('needs-validation')
    expect(receiveHandoff(fixture(type), { ...options, owner: ' ' }).status).toBe('needs-validation')
    expect(receiveHandoff(fixture(type, { status: 'partial' }), options).status).toBe('needs-validation')
    expect(receiveHandoff(fixture(type, { generatedAt: '2026-08-01', staleAfter: '2026-08-31' }), options).status).toBe('blocked')
    expect(receiveHandoff(fixture(type), { ...options, dueDate: '2026-02-30' }).status).toBe('blocked')
    expect(receiveHandoff(fixture(type, { initiativeId: 'unrelated' }), options).status).toBe('blocked')
  })
})

describe('versioned artifact integrity', () => {
  it('round-trips through JSON and attaches idempotently without repairing altered artifacts', () => {
    const artifact = fixture(Object.keys(handoffRoutes)[0]!)
    expect(reviewArtifact(JSON.parse(JSON.stringify(artifact))).status).toBe('ready')
    expect(attachArtifactMetadata(artifact)).toEqual(artifact)
    const tampered = { ...artifact, nextActions: ['pretend approved'] }
    expect(reviewArtifact(attachArtifactMetadata(tampered)).status).toBe('blocked')
  })
  it('validates real dates and never silently upgrades legacy checksum trust', () => {
    const artifact = fixture(Object.keys(handoffRoutes)[0]!)
    expect(reviewArtifact({ ...artifact, generatedAt: 'nonsense' }).status).toBe('blocked')
    expect(reviewArtifact(fixture(Object.keys(handoffRoutes)[0]!, { generatedAt: '2026-02-30' })).status).toBe('blocked')
    expect(reviewArtifact(fixture(Object.keys(handoffRoutes)[0]!, { generatedAt: '2026-10-01' })).status).toBe('blocked')
    const legacy: Record<string, unknown> = { ...artifact }
    delete legacy.hashVersion
    expect(reviewArtifact(legacy).status).toBe('partial')
  })
})
