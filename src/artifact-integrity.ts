import { createHash } from 'node:crypto'

// Versioned checksum for transport integrity, not a signature or proof of truth.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]))
  }
  return value
}

export function integrityHash(value: Record<string, unknown>): string {
  const payload = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'contentHash'))
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex')
}

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false
  const day = value.slice(0, 10)
  const parsed = Date.parse(day + 'T00:00:00Z')
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value))
}
