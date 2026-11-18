import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attachArtifactMetadata } from '../src/artifacts.js'
import { reviewLoopArtifacts } from '../src/loop-review.js'
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
const seal = (value: Record<string, unknown>) => attachArtifactMetadata(value, { staleAfterDays: 30 })
it('cannot close a loop just because all document types exist', () => {
  const artifacts = ['opportunity-handoff', 'product-sales-handoff', 'commercial-handoff', 'growth-attribution-review', 'sales-feedback-handoff', 'product-feedback-closure'].map(artifactType => seal({ artifactType }))
  const result = reviewLoopArtifacts(artifacts, 'demo')
  expect(result.status).toBe('partial')
  expect(result.coordinationClosed).toBe(false)
})
it('counts duplicates once and flags conflicting versions', () => {
  const artifact = seal({ artifactType: 'opportunity-handoff' })
  expect(reviewLoopArtifacts([artifact, artifact], 'demo').duplicates).toBe(1)
  expect(reviewLoopArtifacts([artifact, { ...artifact, contentHash: 'changed' }], 'demo').status).toBe('blocked')
})
it('rejects failed envelopes and cannot combine unrelated receipts', () => {
  const artifact = seal({ artifactType: 'opportunity-handoff' })
  const receipt = seal({ artifactType: 'handoff-receipt', initiativeId: 'other', status: 'accepted',
    sourceArtifactId: artifact.artifactId, sourceContentHash: artifact.contentHash, sourceArtifactType: artifact.artifactType,
    receivedBy: 'dsh-product', owner: 'owner', action: 'review', approvalGranted: false, completionClaimed: false })
  expect(reviewLoopArtifacts([artifact, receipt], 'demo').acceptedReceiptCount).toBe(0)
  expect(reviewLoopArtifacts([{ ok: false, data: artifact }], 'demo').status).toBe('blocked')
})
it('isolates failed results only when they unambiguously belong to another initiative', () => {
  for (const failed of [{ ok: false, data: { initiativeId: 'B' } }, { ok: false, initiativeId: 'B', data: {} }]) {
    expect(reviewLoopArtifacts([failed], 'A').status).toBe('partial')
    expect(reviewLoopArtifacts([failed], 'B').status).toBe('blocked')
  }
  expect(reviewLoopArtifacts([{ ok: false, initiativeId: 'A', data: { initiativeId: 'B' } }], 'A').status).toBe('blocked')
})
it('does not trust a receipt whose original version is absent or stale', () => {
  const receipt = seal({ artifactType: 'handoff-receipt', initiativeId: 'demo', status: 'accepted',
    sourceArtifactId: 'missing', sourceContentHash: 'missing', sourceArtifactType: 'opportunity-handoff', receivedBy: 'dsh-product' })
  expect(reviewLoopArtifacts([receipt], 'demo').acceptedReceiptCount).toBe(0)
})
