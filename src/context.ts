import type { BusinessConfig } from './tools.js'
import type { BusinessFileRecord, BusinessFileSystemLike } from './types.js'

function childPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, '')}\\${name}`
}

function frontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  return Object.fromEntries((match[1] ?? '').split(/\r?\n/).flatMap((line) => {
    const index = line.indexOf(':')
    return index > 0 ? [[line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')]] : []
  }))
}

function artifactType(path: string, content: string, meta: Record<string, string>): string {
  if (meta.artifactType) return meta.artifactType
  if (/pricing|定价|报价/i.test(path + content)) return 'business-pricing-review'
  if (/profitability|盈利|利润/i.test(path + content)) return 'business-profitability-review'
  if (/commercial|商业交接/i.test(path + content)) return 'commercial-handoff'
  return 'business-note'
}

export function auditBusinessNote(path: string, content: string): { path: string; artifactType: string; status: 'ready' | 'partial' | 'blocked'; missing: string[]; warnings: string[]; nextActions: string[] } {
  const meta = frontmatter(content)
  const missing = ['type', 'status', 'owner', 'updated', 'source'].filter((key) => !meta[key])
  const type = artifactType(path, content, meta)
  const status = missing.length === 0 ? 'ready' : missing.length <= 2 ? 'partial' : 'blocked'
  return { path, artifactType: type, status, missing, warnings: missing.length > 0 ? ['商业结论缺少完整来源和责任信息，不能直接作为审批依据。'] : [], nextActions: status === 'ready' ? ['将事实、假设、风险和审批边界带入 business_commercial_handoff。'] : [`补齐字段：${missing.join('、')}。`] }
}

export async function scanBusinessVault(fs: BusinessFileSystemLike, config: BusinessConfig, root: string, signal?: AbortSignal): Promise<{ root: string; files: BusinessFileRecord[]; supportedNotes: number; dataFiles: string[]; errors: string[] }> {
  const files: BusinessFileRecord[] = []
  const dataFiles: string[] = []
  const errors: string[] = []
  const walk = async (path: string, target: unknown): Promise<void> => {
    if (files.length >= config.maxFiles) return
    let entries: Awaited<ReturnType<BusinessFileSystemLike['listDir']>>
    try { entries = await fs.listDir(target, signal) } catch (error) { errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`); return }
    for (const entry of entries) {
      if (files.length >= config.maxFiles) break
      const child = childPath(path, entry.name)
      if (entry.type === 'directory') { if (!entry.name.startsWith('.')) await walk(child, entry.target); continue }
      const size = entry.size ?? 0
      const ext = entry.name.match(/\.[^.]+$/)?.[0].toLowerCase() ?? ''
      if (!['.md', '.markdown', '.csv', '.json', '.jsonl', '.ndjson'].includes(ext)) { files.push({ path: child, type: ext || 'file', size, status: 'skipped', reasons: ['unsupported extension'] }); continue }
      if (size > config.maxFileBytes) { files.push({ path: child, type: ext, size, status: 'skipped', reasons: [`exceeds maxFileBytes (${config.maxFileBytes})`] }); continue }
      try {
        if (ext === '.md' || ext === '.markdown') {
          const content = await fs.readText(entry.target, signal)
          const audit = auditBusinessNote(child, content)
          files.push({ path: child, type: ext, size, artifactType: audit.artifactType, status: 'supported', reasons: audit.missing })
        } else {
          dataFiles.push(child)
          files.push({ path: child, type: ext, size, status: 'supported', reasons: [] })
        }
      } catch (error) { files.push({ path: child, type: ext, size, status: 'error', reasons: [error instanceof Error ? error.message : String(error)] }); errors.push(`${child}: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }
  const target = await fs.resolve(root, { signal })
  await walk(root, target)
  return { root, files, supportedNotes: files.filter((file) => file.artifactType).length, dataFiles, errors }
}
