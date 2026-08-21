import { describe, expect, it } from 'vitest'
import { auditBusinessNote } from '../src/context.js'

describe('business local context', () => {
  it('flags missing metadata without treating the note as approval', () => {
    const result = auditBusinessNote('pricing.md', '# Pricing\n\n价格待确认')
    expect(result.status).toBe('blocked')
    expect(result.warnings[0]).toContain('审批')
  })

  it('recognizes a complete sourced business note', () => {
    const result = auditBusinessNote('pricing.md', '---\ntype: business-pricing-review\nstatus: active\nowner: finance\nupdated: 2026-08-21\nsource: pricing.csv\n---\n# Pricing')
    expect(result.status).toBe('ready')
    expect(result.artifactType).toBe('business-pricing-review')
  })
})
