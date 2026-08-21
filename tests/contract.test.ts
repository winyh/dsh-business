import { describe, expect, it } from 'vitest'
import { validateSuiteArtifact, validateSuiteResultEnvelope } from '../src/contract.js'

describe('six-plugin public contract', () => {
  it('accepts a valid result envelope', () => {
    const review = validateSuiteResultEnvelope({ schemaVersion: '1.0', ok: true, data: {}, warnings: [], assumptions: [], lineage: [], nextActions: [] })
    expect(review.ok).toBe(true)
  })

  it('checks the complete handoff chain without weakening boundaries', () => {
    const chain = [
      ['opportunity-handoff', 'dsh-idea', 'dsh-product'],
      ['product-sales-handoff', 'dsh-product', 'dsh-sales'],
      ['commercial-handoff', 'dsh-business', 'dsh-sales'],
      ['sales-feedback-handoff', 'dsh-sales', 'dsh-idea'],
    ] as const
    for (const [artifactType, handoffFrom, handoffTo] of chain) {
      const review = validateSuiteArtifact({ schemaVersion: '1.0', artifactId: `test-${artifactType}`, artifactType, handoffFrom, handoffTo }, { artifactType, handoffFrom, handoffTo })
      expect(review.ok).toBe(true)
    }
  })
})
