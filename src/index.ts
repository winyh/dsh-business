import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { registerBusinessTools, type BusinessConfig } from './tools.js'

export const name = 'dsh-business'
export const inject = ['tools']

export type Config = BusinessConfig

export const Config: Schema<BusinessConfig> = Schema.object({
  defaultCurrency: Schema.string().default('CNY'),
  defaultLanguage: Schema.string().default('zh-CN'),
  maxResultChars: Schema.number().step(1).min(1_000).max(200_000).default(50_000),
})

export function apply(ctx: Context, config: BusinessConfig): void {
  registerBusinessTools(ctx, config)
}
