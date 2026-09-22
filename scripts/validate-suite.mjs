import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { load } from 'js-yaml'

// Optional workspace integration check. Requires six built sibling repositories.
// Synthetic data only. No model, network, customer outreach, publication or user profile.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = dirname(root)
const repos = ['dsh-idea', 'dsh-business', 'dsh-product', 'dsh-geo', 'dsh-growth', 'dsh-sales']
const temporary = await mkdtemp(join(tmpdir(), 'dsh-loop-fixture-'))
const ctx = new Context()
ctx.baseUrl = pathToFileURL(root).href + '/'
const deadline = setTimeout(() => { console.error('Suite validation timed out'); process.exit(1) }, 45000)
const day = offset => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)
try {
  const patches = []
  for (const repo of repos) {
    const directory = join(workspace, repo)
    const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    await readFile(join(directory, pkg.main))
    const bundle = load(await readFile(join(directory, pkg.dsh.bundle.patch), 'utf8'), { schema: entryListSchema })
    const contribution = bundle.flatMap(patch => patch.insert ?? []).find(row => row.name === repo)
    assert.ok(contribution, repo + ' must be enabled by its shipped bundle')
    contribution.name = pathToFileURL(join(directory, pkg.main)).href
    contribution.config = { ...contribution.config, defaultRoot: temporary }
    patches.push(...bundle)
  }
  const webRoot = join(workspace, 'dsh-geo/node_modules/@deepseek-ai/dsh-web')
  const webPkg = JSON.parse(await readFile(join(webRoot, 'package.json'), 'utf8'))
  const configPath = join(temporary, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: '@deepseek-ai/dsh-fs-local'", '  config:', '    cwd: ' + JSON.stringify(temporary),
    '- name: ' + JSON.stringify(pathToFileURL(join(webRoot, webPkg.main)).href), '',
  ].join('\n'))
  await ctx.plugin(Loader)
  await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-include', config: { path: pathToFileURL(configPath).href, patches } })
  await ctx.loader.await()
  const tools = ctx.get('tools')
  let calls = 0
  const invoke = async (name, args) => {
    const result = await tools.execute({ name, arguments: args, callId: 'loop-' + (++calls), signal: new AbortController().signal })
    assert.equal(result.isError, false, name + ': ' + JSON.stringify(result))
    assert.ok(result.value?.data, name + ' must return structured data')
    return result.value.data
  }
  const initiativeId = 'synthetic-report-export-loop'
  const artifacts = []
  const keep = value => { artifacts.push(value); return value }
  const receive = async (prefix, source, expected = 'accepted') => {
    const receipt = await invoke(prefix + '_handoff_receive', {
      artifactJson: JSON.stringify({ ok: true, data: source }), initiativeId,
      owner: 'Synthetic fixture owner', action: '核对模拟来源并执行本阶段下一步', dueDate: day(-7),
    })
    assert.equal(receipt.status, expected, prefix + ': ' + JSON.stringify(receipt))
    assert.equal(receipt.completionClaimed, false)
    if (expected === 'accepted') keep(receipt)
    return receipt
  }
  const opportunity = keep(await invoke('idea_opportunity_handoff', { reviewJson: JSON.stringify({
    source: 'synthetic-interviews.json', signalImport: { signals: [] },
    opportunityMap: { themes: [{ id: 't1', user: '运营人员', scene: '周报', opportunity: '减少导出重复工作', representativeProblems: ['导出慢'], currentWorkarounds: ['人工复制'] }] },
    candidates: [{ id: 'c1', themeId: 't1', title: '报告导出', user: '运营人员', scene: '周报', problem: '导出慢',
      solution: '批量导出', whyNow: '报告量增加', evidence: ['模拟访谈记录第1条'], riskiestAssumption: '可减少人工时间' }],
    experiment: { method: 'concierge', successThreshold: '3/5 完成任务', failureThreshold: '0/5 完成', audience: '模拟用户', decisionRule: '复核后决定' },
    warnings: [], nextActions: [],
  }) }))
  await receive('product', opportunity)
  await receive('business', opportunity)
  const pricing = await invoke('business_pricing_review', { productName: 'Synthetic report', offers: JSON.stringify([
    { sku: 'demo', channel: 'direct', listPrice: 100, transactionPrice: 100, unitCost: 30, minimumTransactionPrice: 70 },
  ]) })
  const profitability = await invoke('business_profitability_review', { businessName: 'Synthetic report',
    lines: JSON.stringify([{ name: 'demo', units: 10, revenuePerUnit: 100, variableCostPerUnit: 30, fixedCost: 100 }]) })
  const commercial = keep(await invoke('business_commercial_handoff', { productName: 'Synthetic report', handoffTo: 'dsh-sales',
    pricingJson: JSON.stringify(pricing), profitabilityJson: JSON.stringify(profitability), source: 'synthetic-pricing.md' }))
  await receive('sales', commercial)
  const product = keep(await invoke('product_sales_handoff', {
    productName: 'Synthetic report', productDecision: 'proceed', targetBuyer: '运营人员', customerProblem: '人工导出慢',
    desiredOutcome: '缩短报告时间', valueEvidence: '["模拟试用记录"]', proofPoints: '["模拟用户完成导出"]',
    commercialContext: '["报价仍需负责人审批"]', nextCustomerAction: '由用户确认下一次演示', source: 'synthetic-product.md',
  }))
  await receive('sales', product)
  const publicFacts = keep(await invoke('product_discoverability_handoff', {
    initiativeId, productName: 'Synthetic report', audience: '运营人员', publicFacts: '["支持报告导出"]',
    evidence: '["模拟公开演示"]', claimBoundaries: '["不得承诺收入或排名"]', targetMetric: 'activation', source: 'synthetic-public-facts.md',
  }))
  await receive('geo', publicFacts)
  const productGrowth = keep(await invoke('product_growth_handoff', { productName: 'Synthetic report', productOutcome: '完成导出',
    evidence: '["模拟试用记录"]', primaryMetric: 'activation', guardrails: '["error-rate"]', source: 'synthetic-product.md' }))
  await receive('growth', productGrowth)
  const plan = keep(await invoke('geo_growth_measurement_plan', {
    contentId: 'synthetic-page', channel: 'organic', targetMetric: 'activation', publishAt: day(2),
    baselineWindow: day(4) + '/' + day(3), source: 'synthetic-page.md',
  }))
  await receive('growth', plan)
  const observation = { contentId: plan.contentId, channel: plan.channel, metric: plan.targetMetric, value: 8, baseline: 10,
    unit: 'users', baselineWindow: plan.baselineWindow, window: day(2) + '/' + day(1), source: 'synthetic-events.csv' }
  const measured = keep(await invoke('growth_attribution_review', { measurementJson: JSON.stringify(plan), metricsJson: JSON.stringify([observation]) }))
  assert.equal(measured.status, 'measured')
  assert.equal(measured.results[0].deltas[0].delta, -2)
  const salesPath = join(temporary, 'synthetic-crm.csv')
  await writeFile(salesPath, 'outcome,amount,segment,reason\nwon,100,demo,\nlost,80,demo,缺少导出功能\nlost,90,demo,市场需求不明确\n')
  const feedbackArgs = { path: salesPath, outcomeField: 'outcome', amountField: 'amount', segmentField: 'segment', reasonField: 'reason' }
  const feedback = keep(await invoke('sales_feedback_handoff', { ...feedbackArgs, target: 'dsh-product' }))
  await receive('product', feedback)
  const closure = keep(await invoke('product_feedback_close', {
    initiativeId, feedbackJson: JSON.stringify(feedback), action: '修复导出并复验', owner: 'Synthetic owner', dueDate: day(-7),
    status: 'verified', evidence: 'synthetic-recheck.md',
    verificationJson: JSON.stringify({ method: '重复模拟失败步骤', source: 'synthetic-recheck.md', observedAt: new Date().toISOString(), result: 'passed' }),
  }))
  assert.equal(closure.status, 'verified')
  await receive('sales', closure)
  const discoveryFeedback = keep(await invoke('sales_feedback_handoff', { ...feedbackArgs, target: 'dsh-idea' }))
  const discoveryReceipt = await receive('idea', discoveryFeedback)
  assert.ok(discoveryReceipt.signals.length > 0)
  const evidenceScore = await invoke('idea_evidence_score', { signalsJson: JSON.stringify(discoveryReceipt) })
  assert.ok(evidenceScore.signals.every(signal => signal.evidenceState !== 'validated'))
  const loop = await invoke('business_loop_review', { initiativeId, artifactsJson: JSON.stringify(artifacts) })
  assert.equal(loop.status, 'ready', JSON.stringify(loop))
  assert.equal(loop.coordinationClosed, true)
  assert.equal(loop.businessImpact, 'observed-not-attributed')
  await writeFile(join(temporary, 'synthetic-artifacts.json'), JSON.stringify(artifacts.map(data => ({ ok: true, data }))))
  const indexedLoop = await invoke('business_loop_review', { initiativeId, root: temporary })
  assert.equal(indexedLoop.coordinationClosed, true, JSON.stringify(indexedLoop))
  // Old artifacts, missing originals, unrelated work and stale receipts never close the loop.
  await receive('idea', feedback, 'blocked')
  await receive('product', { ...opportunity, problem: 'tampered' }, 'blocked')
  const incomplete = await invoke('business_loop_review', { initiativeId, artifactsJson: JSON.stringify(artifacts.filter(item => item.artifactId !== feedback.artifactId)) })
  assert.equal(incomplete.coordinationClosed, false)
  const unrelated = await invoke('business_loop_review', { initiativeId: 'another-project', artifactsJson: JSON.stringify(artifacts) })
  assert.equal(unrelated.coordinationClosed, false)
  const repeated = await invoke('growth_attribution_review', { measurementJson: JSON.stringify(plan), metricsJson: JSON.stringify([observation, observation]) })
  assert.equal(repeated.status, 'partial')
  await writeFile(join(temporary, 'synthetic-failed.json'), JSON.stringify({ ok: false, data: opportunity }))
  const failedIndex = await invoke('business_loop_review', { initiativeId, root: temporary })
  assert.equal(failedIndex.status, 'blocked')
  for (const [name, source] of [['sales_product_handoff_review', product], ['sales_commercial_handoff_review', commercial], ['growth_handoff_consume', productGrowth]]) {
    const failed = await invoke(name, { handoffJson: JSON.stringify({ ok: false, data: source }) })
    assert.equal(failed.status, 'blocked', name + ' must reject failed envelopes')
  }
  console.log('SIX_PLUGIN_LOOP_OK ' + JSON.stringify({ tools: tools.schemas().filter(tool => repos.some(repo => tool.name.startsWith(repo.slice(4) + '_'))).length, calls,
    gates: loop.gates.length, negativeDelta: -2, syntheticData: true, externalActions: false }))
} finally {
  clearTimeout(deadline)
  await ctx.fiber.dispose()
  await rm(temporary, { recursive: true, force: true })
}
