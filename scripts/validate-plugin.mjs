import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = process.cwd()
const manifestPath = resolve(root, '.codex-plugin', 'plugin.json')
const packagePath = resolve(root, 'package.json')

const fail = (message) => {
  throw new Error(`[plugin:validate] ${message}`)
}

if (!existsSync(manifestPath)) fail('missing .codex-plugin/plugin.json')
if (!existsSync(packagePath)) fail('missing package.json')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))

if (manifest.name !== pkg.name) fail(`manifest name ${manifest.name} does not match package name ${pkg.name}`)
if (manifest.name !== basename(resolve(root))) fail(`manifest name ${manifest.name} does not match repository directory`)
if (!manifest.version) fail('manifest version is required')
if (!manifest.description) fail('manifest description is required')
if (!manifest.author?.name) fail('manifest author.name is required')
if (!manifest.interface?.displayName) fail('manifest interface.displayName is required')
if (!manifest.interface?.shortDescription) fail('manifest interface.shortDescription is required')
if (!manifest.interface?.longDescription) fail('manifest interface.longDescription is required')
if (!Array.isArray(manifest.interface?.capabilities) || manifest.interface.capabilities.length === 0) {
  fail('manifest interface.capabilities must be a non-empty array')
}
if (pkg.main !== 'lib/index.mjs') fail(`package main must be lib/index.mjs, got ${pkg.main}`)
if (pkg.types !== 'lib/index.d.mts') fail(`package types must be lib/index.d.mts, got ${pkg.types}`)

for (const relativePath of [
  '.codex-plugin/plugin.json',
  'cordis.patch.yml',
  'lib/index.mjs',
  'lib/index.d.mts',
  'README.md',
  'README.zh.md',
  'LICENSE',
  'SECURITY.md',
]) {
  if (!existsSync(resolve(root, relativePath))) fail(`missing required file ${relativePath}`)
}

if (!Array.isArray(pkg.files)) fail('package files must be an array')
for (const publishedPath of ['lib', '.codex-plugin', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'SECURITY.md']) {
  if (!pkg.files.includes(publishedPath)) fail(`package files must include ${publishedPath}`)
}

if (manifest.skills && !existsSync(resolve(root, manifest.skills))) {
  fail(`manifest skills path does not exist: ${manifest.skills}`)
}

if (readFileSync(manifestPath, 'utf8').includes('[TODO:')) fail('manifest contains an unresolved TODO placeholder')

console.log(`plugin manifest ok: ${manifest.name} (${manifest.version})`)
