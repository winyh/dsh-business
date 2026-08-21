import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const manifest = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'))
const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm'
const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm pack --dry-run --json'] : ['pack', '--dry-run', '--json']
const result = spawnSync(command, commandArgs, { encoding: 'utf8', windowsHide: true })
if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || 'pnpm pack --dry-run failed')
const output = `${result.stdout}\n${result.stderr}`
function findPackMetadata(text) {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{') continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let end = start; end < text.length; end += 1) {
      const char = text[end]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth += 1
      else if (char === '}' && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, end + 1))
          if (Array.isArray(value.files)) return value
        } catch {}
        break
      }
    }
  }
  throw new Error('Could not parse pnpm pack --dry-run --json output')
}
const pack = findPackMetadata(output)
const paths = new Set(pack.files.map((file) => file.path))
const required = ['.codex-plugin/plugin.json', 'lib/index.mjs', 'lib/index.d.mts', 'cordis.patch.yml']
if (manifest.skills) required.push('skills/')
for (const path of required) {
  const present = path.endsWith('/') ? [...paths].some((item) => item.startsWith(path)) : paths.has(path)
  if (!present) throw new Error(`package is missing ${path}`)
}
if (!paths.has('package.json') || [...paths].some((path) => path === 'docs' || path.startsWith('docs/'))) throw new Error('package must include package.json and exclude docs/')
console.log(`package contents ok: ${pkg.name} (${pack.filename})`)
