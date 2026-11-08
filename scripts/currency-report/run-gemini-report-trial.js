// User approval: one actual historical CLP report, USD .045 maximum, no retry.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'
import { privateDir } from './storage.js'
import { finalTrialDir } from './run-final-clp-trial.js'
import { diagnosticPlan } from './prepare-gemini-diagnostics.js'
import { checkGeminiEndpoint, GEMINI_MODEL } from './run-gemini-clp-trial.js'
import { probeDir } from './run-gemini-connection-probe.js'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'
import { createPrivateStreamJournal } from './stream-journal.js'
import { fingerprint, parsePaidResponse } from './paid-comparison.js'
import { draftAssessment } from './trial-common-rules.js'

export const REPORT_TRIAL_BUDGET_USD = .045
export const geminiReportDir = `${privateDir}/clp-20260911-gemini-stream-20261006-v1`
export function approvedReportStage(plan) {
  const stage = plan.stages?.find(s => s.id === 'full-ledger')
  if (!stage || stage.body.model !== GEMINI_MODEL || stage.maxCalls !== 1 || stage.retries !== 0 ||
    stage.body.max_tokens !== 8192 || stage.body.reasoning?.effort !== 'medium' ||
    stage.reservedUsd > REPORT_TRIAL_BUDGET_USD || stage.reservedUsd <= 0 ||
    stage.requestHash !== fingerprint(stage.body) || !stage.body.response_format?.json_schema?.schema?.required?.includes('ruleLedger'))
    throw new Error('report_trial_not_authorized')
  return stage
}

async function main() {
  const mode = process.argv[2] ?? 'check'
  if (process.argv.length > 3 || !['check', 'run'].includes(mode)) throw new Error('invalid_report_trial_mode')
  const input = JSON.parse(await fs.readFile(`${finalTrialDir}/snapshot.json`, 'utf8'))
  const plan = diagnosticPlan(input), stage = approvedReportStage(plan)
  const get = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('report_trial_preflight_failed')
    return response.json()
  }
  const [catalog, zdr] = await Promise.all([
    get(`https://openrouter.ai/api/v1/models/${GEMINI_MODEL}/endpoints`), get('https://openrouter.ai/api/v1/endpoints/zdr'),
  ])
  const endpoint = checkGeminiEndpoint(catalog, zdr, stage.body)
  if (mode === 'check') {
    console.log(JSON.stringify({ generationCalls: 0, reservedUsd: stage.reservedUsd,
      budgetUsd: REPORT_TRIAL_BUDGET_USD, requestHash: stage.requestHash, endpoint })); return
  }
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(stage).includes(apiKey)) throw new Error('invalid_local_key')
  const prior = JSON.parse(await fs.readFile(`${probeDir}/accounting.json`, 'utf8'))
  await fs.mkdir(geminiReportDir) // permanent lock before first POST, including crashes
  const save = (name, value) => fs.writeFile(`${geminiReportDir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  const snapshot = { packet: input.packet, body: stage.body, sourceInputHash: plan.sourceInputHash,
    inputHash: fingerprint({ packet: input.packet, body: stage.body }) }
  await save('authorization', { approvedBy: 'user-current-thread', at: new Date().toISOString(),
    budgetUsd: REPORT_TRIAL_BUDGET_USD, maxCalls: 1, retries: 0 })
  await save('snapshot', snapshot)
  await save('preflight', endpoint)
  await save('reservation', { reservedUsd: stage.reservedUsd, costUsd: null, state: 'reserved' })
  const journal = await createPrivateStreamJournal('clp-gemini-report-20261006-v1')
  const transport = await callOpenRouterStream({ body: stage.body, apiKey, checkpoint: journal })
  await save('transport', transport)
  const parsed = transport.valid ? parsePaidResponse(transport.payload, input.packet, GEMINI_MODEL, true, true) :
    { valid: false, errors: transport.errors, candidate: null, retryable: false }
  let cost = { costUsd: transport.costUsd, costSource: transport.costSource }
  if (cost.costUsd === null && transport.responseId) {
    cost = await reconcileGenerationCost({ responseId: transport.responseId, apiKey })
    await save('cost-reconciliation', cost)
  }
  const result = { ...parsed, ...cost, transportPassed: transport.valid,
    actualModel: transport.actualModel, responseId: transport.responseId, latencyMs: transport.latencyMs,
    firstContentMs: transport.firstContentMs, usage: transport.usage, retries: 0 }
  await save('result', result)
  const assessment = draftAssessment(result)
  await save('draft-assessment', assessment)
  const accounting = { ...cost, reservedUsd: stage.reservedUsd,
    confirmedTotalUsd: Number((prior.confirmedTotalUsd + (cost.costUsd ?? 0)).toFixed(9)),
    unknownReservedTotalUsd: Number((prior.unknownReservedTotalUsd + (cost.costUsd === null ? stage.reservedUsd : 0)).toFixed(9)),
    generationCalls: 1, retries: 0, budgetUsd: REPORT_TRIAL_BUDGET_USD }
  await save('accounting', accounting)
  console.log(JSON.stringify({ ...assessment, ...accounting, transportPassed: transport.valid,
    model: result.actualModel, errors: result.errors, latencyMs: result.latencyMs, usage: result.usage }))
  if (cost.costUsd !== null && cost.costUsd > stage.reservedUsd) throw new Error('report_cost_exceeded_reservation_stop')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(/^[a-z_]+$/.test(error.message ?? '') ? error.message : 'report_trial_failed'); process.exitCode = 1 })
}
