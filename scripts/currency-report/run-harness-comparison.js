// Explicitly budgeted local comparison. `prepare`/`collect` commands never reach this file.
import fs from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'
import { fingerprint } from './research-harness.js'
import { packetBinding } from './rules.js'
import { prepareHarnessComparison } from './live-research-local.js'
import { endpointPreflight } from './run-clp-editorial-trial.js'
import { composeDraft } from './openrouter.js'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'
import { createPrivateStreamJournal } from './stream-journal.js'

export async function executeHarnessComparison({ plan, packet, approvedBudgetUsd, invoke, checkpoint = async () => {} }) {
  if (!Number.isFinite(approvedBudgetUsd) || approvedBudgetUsd <= 0 || approvedBudgetUsd > 1 ||
    plan.status !== 'prepared_not_called' || plan.maxCalls !== 2 || plan.retries !== 0 || plan.calls.length !== 2 ||
    plan.calls.map(c => c.stage).join(',') !== 'baseline_generation,harness_generation' || plan.packetHash !== packetBinding(packet) ||
    plan.calls.some(c => c.requestHash !== fingerprint(c.body) || c.body.model !== plan.model) ||
    plan.totalMaximumUsd !== Number(plan.calls.reduce((n, c) => n + c.maximumUsd, 0).toFixed(9)) || plan.totalMaximumUsd > approvedBudgetUsd)
    throw new Error('unapproved_or_changed_comparison')
  // Reserve both requests before any invocation. Missing charges keep their reservation.
  const ledger = plan.calls.map(c => ({ stage: c.stage, requestHash: c.requestHash, reservedUsd: c.maximumUsd, costUsd: null, state: 'not_started' }))
  const accounting = () => ({ actualCostUsd: ledger.reduce((n, r) => n + (r.costUsd ?? 0), 0),
    unknownReservedUsd: ledger.filter(r => r.costUsd === null && r.state !== 'not_started').reduce((n, r) => n + r.reservedUsd, 0) })
  await checkpoint('reservation', structuredClone(ledger))
  const results = []
  for (const [index, call] of plan.calls.entries()) {
    ledger[index].state = 'started'; await checkpoint('ledger-start', structuredClone(ledger))
    let transport
    try { transport = await invoke(call) } catch {
      ledger[index].state = 'cost_unresolved'; await checkpoint('ledger-interrupted', structuredClone(ledger))
      return { status: 'interrupted', ledger, results, ...accounting(), publicationApproved: false }
    }
    const money = typeof transport.costUsd === 'number' && Number.isFinite(transport.costUsd) && transport.costUsd >= 0 ? transport.costUsd : null
    ledger[index].costUsd = money
    ledger[index].state = money === null ? 'cost_unresolved' : 'completed'
    await checkpoint('ledger-complete', structuredClone(ledger))
    if (money !== null && money > call.maximumUsd) return { status: 'cost_exceeded', ledger, results, ...accounting(), publicationApproved: false }
    let result = { stage: call.stage, status: 'transport_failed', errors: transport.errors ?? [] }
    if (transport.valid && (transport.actualModel === plan.model || transport.actualModel?.startsWith(plan.model + '-20'))) {
      try {
        const draft = JSON.parse(transport.partialText)
        const generated = composeDraft(packet, draft, true, true)
        result = { stage: call.stage, status: generated.validation.valid ? 'generated_pending_content_review' : 'validation_hold', draft, generated }
      } catch { result = { stage: call.stage, status: 'invalid_output' } }
    } else if (transport.valid) result.status = 'model_mismatch'
    results.push(result); await checkpoint('candidate', result)
  }
  return { status: 'comparison_pending_content_review', ledger, results, ...accounting(),
    publicationApproved: false }
}

async function main() {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, input: { type: 'string' }, dossier: { type: 'string' },
    'budget-usd': { type: 'string' }, 'run-id': { type: 'string' } }, strict: true })
  if (!values.plan || !values.input || !values.dossier || !values['budget-usd'] || !/^[a-z0-9-]{8,80}$/.test(values['run-id'] ?? ''))
    throw new Error('explicit_comparison_authorization_required')
  const plan = JSON.parse(await fs.readFile(values.plan, 'utf8'))
  const packet = JSON.parse(await fs.readFile(values.input, 'utf8')).packet
  const dossier = JSON.parse(await fs.readFile(values.dossier, 'utf8'))
  if (fingerprint(plan) !== fingerprint(prepareHarnessComparison(packet, dossier))) throw new Error('frozen_comparison_changed')
  const approvedBudgetUsd = Number(values['budget-usd'])
  if (!Number.isFinite(approvedBudgetUsd) || approvedBudgetUsd > 1 || approvedBudgetUsd < plan.totalMaximumUsd) throw new Error('comparison_budget_insufficient')
  for (const call of plan.calls) await endpointPreflight(call.body)
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(plan).includes(apiKey)) throw new Error('invalid_comparison_key')
  const dir = `.local-reports/private/harness-comparison-${values['run-id']}`
  await fs.mkdir(dir) // permanent execution lock; repeat run IDs cannot spend again
  let sequence = 0
  const save = (name, value) => fs.writeFile(`${dir}/${String(sequence++).padStart(3, '0')}-${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  await save('authorization', { planHash: fingerprint(plan), approvedBudgetUsd, maxCalls: 2, retries: 0, publicationApproved: false })
  await save('snapshot', { packet, dossier, plan })
  const result = await executeHarnessComparison({ plan, packet, approvedBudgetUsd, checkpoint: save, invoke: async call => {
    const journal = await createPrivateStreamJournal(`${values['run-id']}-${call.stage.replaceAll('_', '-')}`)
    const transport = await callOpenRouterStream({ body: call.body, apiKey, checkpoint: journal, timeoutMs: 120000 })
    await save('transport', { stage: call.stage, ...transport })
    if (transport.costUsd === null && transport.responseId) Object.assign(transport, await reconcileGenerationCost({ responseId: transport.responseId, apiKey }))
    return transport
  } })
  await save('result', result)
  console.log(JSON.stringify({ output: dir, status: result.status, actualCostUsd: result.actualCostUsd ?? null,
    unknownReservedUsd: result.unknownReservedUsd ?? null, modelCalls: result.ledger.filter(r => r.state !== 'not_started').length, publicationApproved: false }))
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch(() => { console.error('harness_comparison_stopped'); process.exitCode = 1 })
