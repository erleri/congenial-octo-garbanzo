// Local, explicitly budgeted writer comparison. Production/free defaults are untouched.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parse } from 'dotenv'
import { fingerprint } from './research-harness.js'
import { packetBinding } from './rules.js'
import { requestTokenBound } from './request-budget.js'
import { composeDraft } from './openrouter.js'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'
import { createPrivateStreamJournal } from './stream-journal.js'

export const WRITER_MODELS = Object.freeze([
  { model: 'openai/gpt-5.4', route: 'azure', label: 'gpt54', prompt: 2.5, completion: 15, outputField: 'max_completion_tokens' },
  { model: 'anthropic/claude-sonnet-5.5', route: 'google-vertex/global', label: 'sonnet55', prompt: 2, completion: 10, outputField: 'max_tokens' },
])
const CASE_ROOTS = [
  '.local-reports/private/harness-comparison-clp-20261005-harness-ab-v1',
  '.local-reports/private/harness-comparison-brl-20261007-harness-ab-v1',
]
const preparation = '.local-reports/private/model-suitability-clp-brl-v1'

export function prepareSuitability(snapshots) {
  if (snapshots.length !== 2 || snapshots.map(s => s.packet.currency).join(',') !== 'CLP,BRL') throw new Error('two_frozen_cases_required')
  const calls = snapshots.flatMap(s => {
    const original = s.plan.calls.find(c => c.stage === 'harness_generation')
    if (!original || original.requestHash !== fingerprint(original.body) || s.plan.packetHash !== packetBinding(s.packet) ||
      original.body.model !== 'google/gemini-3.8-flash' || original.body.reasoning?.effort !== 'medium' || original.body.max_tokens !== 16384 ||
      !JSON.parse(original.body.messages.find(m => m.role === 'user').content).researchBrief)
      throw new Error('frozen_harness_input_changed')
    return WRITER_MODELS.map(m => {
      const body = structuredClone(original.body)
      body.model = m.model
      delete body.max_tokens; delete body.max_completion_tokens
      body[m.outputField] = 16384
      body.provider = { only: [m.route], require_parameters: true, zdr: true, data_collection: 'deny', allow_fallbacks: false,
        max_price: { prompt: m.prompt, completion: m.completion } }
      const inputBound = requestTokenBound(body)
      if (inputBound > 44000) throw new Error('writer_input_limit_exceeded')
      return { stage: `${s.packet.currency.toLowerCase()}-${m.label}`, currency: s.packet.currency, baseDate: s.packet.baseDate,
        packetHash: packetBinding(s.packet), sourceRequestHash: original.requestHash, body, requestHash: fingerprint(body),
        inputBound, outputBound: 16384, maximumUsd: Math.ceil((inputBound * m.prompt + 16384 * m.completion) / 1e6 * 1e9) / 1e9 }
    })
  })
  return { version: 'model-suitability/1', calls, maxCalls: 4, retries: 0, totalMaximumUsd: Number(calls.reduce((n, c) => n + c.maximumUsd, 0).toFixed(9)),
    existingGeminiReused: true, messagesAndSchemaUnchanged: true, publicationApproved: false, paidCallAuthorized: false }
}

export async function writerEndpointPreflight(body, fetchImpl = fetch) {
  const config = WRITER_MODELS.find(m => m.model === body.model)
  if (!config || body.provider.only.join(',') !== config.route || body.provider.zdr !== true || body.provider.data_collection !== 'deny' ||
    body.provider.allow_fallbacks !== false || body.provider.require_parameters !== true || body.reasoning?.effort !== 'medium')
    throw new Error('unapproved_writer_route')
  const get = async url => { const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
    if (!r.ok) throw new Error('writer_catalog_unavailable'); return r.json() }
  const [catalog, zdr] = await Promise.all([get(`https://openrouter.ai/api/v1/models/${body.model}/endpoints`), get('https://openrouter.ai/api/v1/endpoints/zdr')])
  const endpoint = catalog.data?.endpoints?.find(e => e.tag === config.route)
  const price = v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0
  const input = requestTokenBound(body), output = body[config.outputField]
  if (!endpoint || endpoint.model_id !== config.model || endpoint.status !== 0 || !zdr.data?.some(e => e.model_id === config.model && e.tag === config.route) ||
    !['reasoning', 'response_format', 'structured_outputs', config.outputField].every(p => endpoint.supported_parameters?.includes(p)) ||
    output !== 16384 || input > 44000 || endpoint.max_completion_tokens < output || endpoint.context_length < input + output ||
    !price(endpoint.pricing?.prompt) || !price(endpoint.pricing?.completion) || !price(endpoint.pricing.internal_reasoning ?? endpoint.pricing.completion) ||
    Number(endpoint.pricing.prompt) > config.prompt / 1e6 || Number(endpoint.pricing.completion) > config.completion / 1e6 ||
    Number(endpoint.pricing.internal_reasoning ?? endpoint.pricing.completion) > config.completion / 1e6 ||
    Number(endpoint.pricing.request ?? 0) !== 0 || endpoint.pricing.overrides?.some(p => p.min_prompt_tokens <= input) ||
    fingerprint(body.provider.max_price) !== fingerprint({ prompt: config.prompt, completion: config.completion }))
    throw new Error('writer_privacy_support_or_price_failed')
  return { model: config.model, route: config.route, checkedAt: new Date().toISOString(), pricing: endpoint.pricing,
    zdr: true, dataCollection: 'deny', modelCalls: 0 }
}

export async function executeSuitability({ plan, snapshots, approvedBudgetUsd, invoke, checkpoint = async () => {} }) {
  if (fingerprint(plan) !== fingerprint(prepareSuitability(snapshots)) || !Number.isFinite(approvedBudgetUsd) ||
    approvedBudgetUsd < plan.totalMaximumUsd || approvedBudgetUsd > 1.11) throw new Error('unapproved_writer_comparison')
  const ledger = plan.calls.map(c => ({ stage: c.stage, reservedUsd: c.maximumUsd, costUsd: null, state: 'not_started' }))
  const accounting = () => ({ actualCostUsd: Number(ledger.reduce((n, r) => n + (r.costUsd ?? 0), 0).toFixed(9)),
    unknownReservedUsd: Number(ledger.filter(r => r.state !== 'not_started' && r.costUsd === null).reduce((n, r) => n + r.reservedUsd, 0).toFixed(9)) })
  await checkpoint('reservation', ledger)
  const results = []
  for (const [i, c] of plan.calls.entries()) {
    ledger[i].state = 'started'; await checkpoint('ledger-start', ledger)
    let transport
    try { transport = await invoke(c) } catch {
      ledger[i].state = 'cost_unresolved'; await checkpoint('ledger-interrupted', ledger)
      return { status: 'interrupted', ledger, results, ...accounting(), publicationApproved: false }
    }
    const cost = transport.costUsd
    ledger[i].costUsd = typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null
    ledger[i].state = ledger[i].costUsd === null ? 'cost_unresolved' : 'completed'
    await checkpoint('ledger-complete', ledger)
    if (ledger[i].costUsd !== null && ledger[i].costUsd > c.maximumUsd)
      return { status: 'cost_exceeded', ledger, results, ...accounting(), publicationApproved: false }
    const packet = snapshots.find(s => s.packet.currency === c.currency).packet
    let result = { stage: c.stage, currency: c.currency, baseDate: c.baseDate, requestedModel: c.body.model,
      actualModel: transport.actualModel, status: 'transport_failed', errors: transport.errors ?? [] }
    if (transport.valid) {
      if (transport.actualModel !== c.body.model && !transport.actualModel?.startsWith(c.body.model + '-20')) result.status = 'model_mismatch'
      else try {
        const draft = JSON.parse(transport.partialText), generated = composeDraft(packet, draft, true, true)
        result = { ...result, draft, generated, status: generated.validation.valid ? 'generated_pending_content_review' : 'validation_hold' }
      } catch { result.status = 'invalid_output' }
    }
    results.push(result); await checkpoint('candidate', result)
  }
  return { status: 'comparison_pending_content_review', ledger, results, ...accounting(), publicationApproved: false }
}

async function main() {
  const { values } = parseArgs({ options: { mode: { type: 'string' }, 'budget-usd': { type: 'string' } }, strict: true })
  if (!['prepare', 'run'].includes(values.mode)) throw new Error('explicit_writer_mode_required')
  const snapshots = await Promise.all(CASE_ROOTS.map(root => fs.readFile(`${root}/001-snapshot.json`, 'utf8').then(JSON.parse)))
  const plan = prepareSuitability(snapshots)
  if (values.mode === 'prepare') {
    await fs.mkdir(preparation)
    await fs.writeFile(`${preparation}/plan.json`, JSON.stringify(plan, null, 2), { flag: 'wx' })
    const endpoints = []
    for (const call of plan.calls) endpoints.push({ stage: call.stage, ...await writerEndpointPreflight(call.body) })
    await fs.writeFile(`${preparation}/preflight.json`, JSON.stringify(endpoints, null, 2), { flag: 'wx' })
    console.log(JSON.stringify({ preparation, maximumUsd: plan.totalMaximumUsd, calls: plan.calls.map(c => ({ stage: c.stage, maximumUsd: c.maximumUsd })), endpoints, modelCalls: 0 }))
    return
  }
  const frozen = JSON.parse(await fs.readFile(`${preparation}/plan.json`, 'utf8'))
  const approvedBudgetUsd = Number(values['budget-usd'])
  if (fingerprint(frozen) !== fingerprint(plan) || !Number.isFinite(approvedBudgetUsd) || approvedBudgetUsd < plan.totalMaximumUsd || approvedBudgetUsd > 1.11)
    throw new Error('explicit_writer_budget_required')
  for (const call of plan.calls) await writerEndpointPreflight(call.body)
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(plan).includes(apiKey)) throw new Error('invalid_local_writer_key')
  const root = '.local-reports/private/model-suitability-clp-brl-trial-v1'
  await fs.mkdir(root) // Permanent single-campaign lock, including after a crash.
  let sequence = 0
  const save = (name, value) => fs.writeFile(`${root}/${String(sequence++).padStart(3, '0')}-${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  await save('authorization', { approvedBudgetUsd, maxCalls: 4, retries: 0, publicInformationOnly: true, publicationApproved: false })
  await save('snapshot', { snapshots, plan })
  const result = await executeSuitability({ plan, snapshots, approvedBudgetUsd, checkpoint: save, invoke: async call => {
    console.log(JSON.stringify({ stage: call.stage, status: 'started' }))
    const journal = await createPrivateStreamJournal(`writer-suitability-v1-${call.stage}`)
    const transport = await callOpenRouterStream({ body: call.body, apiKey, timeoutMs: 120000, checkpoint: journal })
    await save('transport', { stage: call.stage, ...transport })
    if (transport.costUsd === null && transport.responseId) Object.assign(transport, await reconcileGenerationCost({ responseId: transport.responseId, apiKey }))
    console.log(JSON.stringify({ stage: call.stage, valid: transport.valid, costUsd: transport.costUsd, errors: transport.errors ?? [] }))
    return transport
  } })
  await save('result', result)
  console.log(JSON.stringify({ root, status: result.status, actualCostUsd: result.actualCostUsd, unknownReservedUsd: result.unknownReservedUsd,
    calls: result.ledger.filter(r => r.state !== 'not_started').length, publicationApproved: false }))
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(e => {
  console.error(/^[a-z_]+$/.test(e.message) ? e.message : 'writer_comparison_stopped'); process.exitCode = 1
})
