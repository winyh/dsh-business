import type { JsonValue } from '@deepseek-ai/dsh-tools'

export const resultSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  properties: {
    ok: { type: 'boolean' as const },
    data: { type: 'json' as const },
    warnings: { type: 'array' as const, items: { type: 'string' as const } },
    assumptions: { type: 'array' as const, items: { type: 'string' as const } },
    nextActions: { type: 'array' as const, items: { type: 'string' as const } },
  },
}

export function resultEnvelope<T extends JsonValue>(options: {
  data: T
  warnings?: string[]
  assumptions?: string[]
  nextActions?: string[]
}) {
  return {
    ok: true,
    data: options.data,
    warnings: [...(options.warnings ?? [])],
    assumptions: [...(options.assumptions ?? [])],
    nextActions: [...(options.nextActions ?? [])],
  }
}

export function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

export function renderResult(value: unknown, maxChars: number): Array<{ type: 'text'; text: string }> {
  const text = JSON.stringify(value, null, 2)
  const rendered = text.length > maxChars ? `${text.slice(0, maxChars)}\n... result truncated by dsh-business ...` : text
  return [{ type: 'text', text: rendered }]
}
