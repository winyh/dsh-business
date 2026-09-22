import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'

// Load the shipped bundle and compiled entry with real DSH services.
// No model, API key, network request or user's DSH profile is needed.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const temporary = await mkdtemp(join(tmpdir(), pkg.name + '-runtime-'))
const ctx = new Context()
ctx.baseUrl = pathToFileURL(root).href + '/'
const deadline = setTimeout(() => { console.error('DSH runtime validation timed out'); process.exit(1) }, 30000)
try {
  await writeFile(join(temporary, 'evidence.md'), '# Customer evidence\n\nA customer needs a repeatable report. Source: interview.\n')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  const patches = load(await readFile(join(root, pkg.dsh.bundle.patch), 'utf8'), { schema: entryListSchema })
  const contribution = patches.flatMap((patch) => patch.insert ?? []).find((row) => row.name === pkg.name)
  assert.ok(contribution, 'bundle must activate the package by name')
  // A source checkout is not installed in node_modules; use its published entry.
  contribution.name = pathToFileURL(join(root, pkg.main)).href
  contribution.config = { ...contribution.config, defaultRoot: temporary }
  patches.push({ id: 'fixture-fs', config: { cwd: temporary } })
  await ctx.plugin(Loader)
  // Include persists its composed tree during unload; keep that file disposable.
  const fixturePath = join(temporary, 'cordis.yml')
  await writeFile(fixturePath, await readFile(join(root, 'tests/runtime/cordis.yml')))
  await ctx.loader.create({
    name: '@deepseek-ai/cordis-plugin-include',
    config: { path: pathToFileURL(fixturePath).href, patches },
  })
  await ctx.loader.await()
  const tools = ctx.get('tools')
  assert.ok(tools, 'real tool service must activate')
  const prefix = pkg.name.slice(4) + '_'
  const names = tools.schemas().map((tool) => tool.name).filter((name) => name.startsWith(prefix))
  assert.ok(names.length > 0, 'plugin must expose model-visible tools')
  assert.equal(new Set(names).size, names.length, 'tool names must be unique')
  const name = pkg.name === 'dsh-geo' ? 'geo_setup_check' : prefix + 'onboarding'
  assert.ok(names.includes(name), name + ' must be registered')
  const invoke = (args, signal = new AbortController().signal) => tools.execute({
    callId: 'compat-read', name, arguments: args, signal,
  })
  const result = await invoke({ root: temporary })
  assert.equal(result.isError, false, JSON.stringify(result))
  assert.ok(result.content.some((block) => block.type === 'text' && block.text.length > 0), 'result must be model-readable')
  if (pkg.name === 'dsh-geo') {
    assert.equal(result.value.ready, true)
    assert.equal(result.value.markdownFiles, 1)
  } else {
    assert.equal(result.value.ok, true)
    assert.ok(result.value.data, 'result must contain structured business output')
  }
  const invalid = await invoke({ root: 42 })
  const artifactReview = await tools.execute({
    callId: 'compat-artifact', name: prefix + 'artifact_review',
    arguments: { artifactJson: '{}' }, signal: new AbortController().signal,
  })
  assert.equal(artifactReview.isError, false, JSON.stringify(artifactReview))
  assert.equal(artifactReview.value.data.status, 'blocked', 'incomplete artifacts must produce a structured review')
  assert.equal(invalid.isError, true, 'invalid tool arguments must fail at the runtime boundary')
  const cancelled = await invoke({ root: temporary }, AbortSignal.abort())
  assert.equal(cancelled.isError, true, 'already cancelled calls must not succeed')
  const plugin = [...ctx.loader.entries()].find((entry) => entry.options.name === contribution.name)
  assert.ok(plugin?.fiber, 'bundle must load through the Cordis loader')
  await plugin.fiber.dispose()
  assert.ok(tools.schemas().every((tool) => !tool.name.startsWith(prefix)), 'unloading must remove all contributed tools')
  console.log('DSH 0.1.5-rc.2 runtime ok: ' + pkg.name + ' (' + names.length + ' tools; read, validation, cancellation, unload)')
} finally {
  clearTimeout(deadline)
  await ctx.fiber.dispose()
  await rm(temporary, { recursive: true, force: true })
}
