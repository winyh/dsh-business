import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import { registerBusinessTools, type BusinessConfig } from './tools.js'
import type { BusinessFileSystemLike } from './types.js'

export { validateSuiteArtifact, validateSuiteResultEnvelope } from './contract.js'

export const name = 'dsh-business'
export const inject = ['tools', 'fs']

export type Config = BusinessConfig

export const Config: Schema<BusinessConfig> = Schema.object({
  defaultRoot: Schema.string().default('.'),
  defaultCurrency: Schema.string().default('CNY'),
  defaultLanguage: Schema.string().default('zh-CN'),
  maxResultChars: Schema.number().step(1).min(1_000).max(200_000).default(50_000),
  maxFiles: Schema.number().step(1).min(1).max(5_000).default(500),
  maxFileBytes: Schema.number().step(1).min(1_024).max(10_485_760).default(1_048_576),
  maxTextChars: Schema.number().step(1).min(1_000).max(1_000_000).default(180_000),
})

export function apply(ctx: Context, config: BusinessConfig): void {
  const fs = (ctx as unknown as { fs: BusinessFileSystemLike }).fs
  registerBusinessTools(ctx, config, fs)
}
