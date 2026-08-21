import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const artifactDomain = 'dsh-business'

export type ArtifactStatus = 'draft' | 'ready' | 'partial' | 'blocked' | 'stale' | 'applied'

export interface ArtifactFileSystem {
  resolve(path: string, options?: { signal?: AbortSignal }): Promise<unknown>
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; version: unknown } | undefined>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  listDir(target: unknown, signal?: AbortSignal): Promise<Array<{ name: string; type: string; target: unknown; size?: number }>>
  writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface ArtifactIndexItem {
  path: string
  artifactId?: string
  artifactType?: string
  generatedAt?: string
  staleAfter?: string
  status: ArtifactReview['status'] | 'unreadable'
  issues: string[]
  warnings: string[]
}

export interface ArtifactReview {
  status: 'ready' | 'partial' | 'blocked' | 'stale'
  issues: string[]
  warnings: string[]
  nextActions: string[]
  artifactId?: string
  artifactType?: string
  sourceHash?: string
  contentHash?: string
  staleAfter?: string
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !['artifactId', 'generatedAt', 'capturedAt', 'markdown', 'warnings', 'nextActions'].includes(key)).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, normalized(item)]))
  }
  return value
}

export function contentHash(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(normalized(value))
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'artifact'
}

export function createArtifactId(value: Record<string, unknown>): string {
  const type = typeof value.artifactType === 'string' ? value.artifactType : 'artifact'
  return `${artifactDomain}-${slug(type)}-${contentHash(value).slice(0, 12)}`
}

function addDays(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

export function attachArtifactMetadata<T>(value: T, options: { staleAfterDays?: number; sourceHash?: string } = {}): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (typeof record.artifactType !== 'string' || !record.artifactType.trim()) return value
  const generatedAt = typeof record.generatedAt === 'string' && record.generatedAt ? record.generatedAt : new Date().toISOString()
  const metadata: Record<string, unknown> = {
    schemaVersion: typeof record.schemaVersion === 'string' ? record.schemaVersion : '1.0',
    artifactId: typeof record.artifactId === 'string' && record.artifactId ? record.artifactId : createArtifactId({ ...record, generatedAt: undefined }),
    generatedAt,
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : generatedAt,
    revision: typeof record.revision === 'number' ? record.revision : 1,
  }
  if (options.sourceHash) metadata.sourceHash = options.sourceHash
  else if (typeof record.sourceHash === 'string' && record.sourceHash) metadata.sourceHash = record.sourceHash
  metadata.contentHash = contentHash(record)
  if (options.staleAfterDays !== undefined) metadata.staleAfter = typeof record.staleAfter === 'string' ? record.staleAfter : addDays(generatedAt, options.staleAfterDays)
  else if (typeof record.staleAfter === 'string') metadata.staleAfter = record.staleAfter
  return { ...record, ...metadata } as T
}

export function reviewArtifact(value: unknown, expectedType?: string): ArtifactReview {
  const issues: string[] = []
  const warnings: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'blocked', issues: ['工件必须是 JSON object。'], warnings, nextActions: ['传入插件实际生成的 JSON 工件，而不是 Markdown 展示文本。'] }
  const record = value as Record<string, unknown>
  const artifactType = typeof record.artifactType === 'string' ? record.artifactType : undefined
  const artifactId = typeof record.artifactId === 'string' ? record.artifactId : undefined
  const sourceHash = typeof record.sourceHash === 'string' ? record.sourceHash : undefined
  const artifactContentHash = typeof record.contentHash === 'string' ? record.contentHash : undefined
  const staleAfter = typeof record.staleAfter === 'string' ? record.staleAfter : undefined
  if (record.schemaVersion !== '1.0') issues.push('schemaVersion 必须为 1.0。')
  if (!artifactId?.trim()) issues.push('缺少稳定 artifactId。')
  if (!artifactType?.trim()) issues.push('缺少 artifactType。')
  if (expectedType && artifactType !== expectedType) issues.push(`artifactType 必须为 ${expectedType}。`)
  if (typeof record.generatedAt !== 'string' || !record.generatedAt.trim()) issues.push('缺少 generatedAt。')
  if (!artifactContentHash) warnings.push('缺少 contentHash，无法判断工件内容是否发生变化。')
  if (!staleAfter) warnings.push('缺少 staleAfter，无法自动判断证据是否过期。')
  const stale = staleAfter ? Date.parse(staleAfter) <= Date.now() : false
  if (stale) warnings.push(`工件已过期：${staleAfter}。`)
  const status = issues.length > 0 ? 'blocked' : stale ? 'stale' : warnings.length > 0 ? 'partial' : 'ready'
  return { status, issues, warnings, artifactId, artifactType, sourceHash, contentHash: artifactContentHash, staleAfter, nextActions: status === 'ready' ? ['可以交给目标插件继续处理，并保留 artifactId 作为回溯入口。'] : ['补齐缺失的工件元数据后再进入下一阶段。'] }
}

function scalar(value: string): unknown {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  return trimmed
}

function candidatesFromText(path: string, content: string): unknown[] {
  const extension = path.toLowerCase().slice(path.lastIndexOf('.'))
  if (['.json', '.jsonl', '.ndjson'].includes(extension)) {
    const lines = extension === '.json' ? [content] : content.split(/\r?\n/).filter(Boolean)
    const values: unknown[] = []
    for (const line of lines) {
      try {
        const parsed: unknown = JSON.parse(line)
        const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
        if (Array.isArray(data)) values.push(...data)
        else values.push(data)
      } catch { /* index skips malformed records and reports the file warning */ }
    }
    return values
  }
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return []
  const frontmatter: Record<string, unknown> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    const key = field?.[1]
    const value = field?.[2]
    if (key && value !== undefined) frontmatter[key] = scalar(value)
  }
  return frontmatter.artifactType ? [frontmatter] : []
}

export async function indexArtifacts(fs: ArtifactFileSystem, root: string, maxFiles: number, maxTextChars: number, signal?: AbortSignal): Promise<{ root: string; scannedFiles: number; artifacts: ArtifactIndexItem[]; warnings: string[] }> {
  const artifacts: ArtifactIndexItem[] = []
  const warnings: string[] = []
  let scannedFiles = 0
  const walk = async (path: string, target: unknown): Promise<void> => {
    if (scannedFiles >= maxFiles) return
    let entries: Awaited<ReturnType<ArtifactFileSystem['listDir']>>
    try { entries = await fs.listDir(target, signal) } catch (error) { warnings.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); return }
    for (const entry of entries) {
      if (scannedFiles >= maxFiles) break
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'docs' || entry.name === 'lib' || entry.name === 'coverage' || entry.name.startsWith('.')) continue
      const child = join(path, entry.name)
      if (entry.type === 'directory') { await walk(child, entry.target); continue }
      const extension = entry.name.toLowerCase().slice(entry.name.lastIndexOf('.'))
      if (!['.md', '.markdown', '.json', '.jsonl', '.ndjson'].includes(extension)) continue
      scannedFiles += 1
      if ((entry.size ?? 0) > maxTextChars) { warnings.push(`${child}: 超过 maxTextChars，已跳过。`); continue }
      try {
        const values = candidatesFromText(child, await fs.readText(entry.target, signal))
        for (const value of values) {
          const review = reviewArtifact(value)
          const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
          artifacts.push({ path: child, artifactId: typeof record.artifactId === 'string' ? record.artifactId : undefined, artifactType: typeof record.artifactType === 'string' ? record.artifactType : undefined, generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : undefined, staleAfter: typeof record.staleAfter === 'string' ? record.staleAfter : undefined, status: review.status, issues: review.issues, warnings: review.warnings })
        }
      } catch (error) { warnings.push(`${child}: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  await walk(root, await fs.resolve(root, { signal }))
  return { root, scannedFiles, artifacts, warnings }
}

export async function appendArtifactAudit(fs: ArtifactFileSystem, root: string, event: Record<string, unknown>, signal?: AbortSignal): Promise<{ path: string; entries: number }> {
  const path = join(root, '.dsh-business-audit.jsonl')
  const target = await fs.resolve(path, { signal })
  const info = await fs.stat(target, signal)
  const current = info?.type === 'file' ? await fs.readText(target, signal) : ''
  const next = `${current}${JSON.stringify({ ...event, plugin: artifactDomain, recordedAt: new Date().toISOString() })}\n`
  await fs.writeText(target, next, info ? { kind: 'replaceIfVersion', version: info.version } : { kind: 'createIfAbsent' }, signal)
  return { path, entries: next.trim() ? next.trim().split(/\r?\n/).length : 0 }
}
