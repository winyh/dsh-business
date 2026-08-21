import { describe, expect, it } from 'vitest'
import { attachArtifactMetadata, createArtifactId, reviewArtifact } from '../src/artifacts.js'

describe('business artifact protocol', () => {
  it('creates an idempotent content-based id', () => {
    const first = createArtifactId({ artifactType: 'sample', value: 1, generatedAt: '2026-01-01' })
    const second = createArtifactId({ artifactType: 'sample', value: 1, generatedAt: '2026-02-01' })
    expect(first).toBe(second)
  })
  it('attaches metadata and blocks incomplete artifacts', () => {
    const value = attachArtifactMetadata({ artifactType: 'sample', generatedAt: '2026-01-01T00:00:00.000Z' })
    expect(value).toHaveProperty('artifactId')
    expect(reviewArtifact(value).status).toBe('partial')
    expect(reviewArtifact({ artifactType: 'sample' }).status).toBe('blocked')
  })
})
