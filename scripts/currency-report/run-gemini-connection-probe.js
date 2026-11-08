// Current-thread approval: one short connection probe, <= USD 0.0043, no retry.
// Never generates a report or advances to another diagnostic stage.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'
import { privateDir } from './storage.js'
import { finalTrialDir } from './run-final-clp-trial.js'
import { diagnosticPlan } from './prepare-gemini-diagnostics.js'
import { checkGeminiEndpoint, GEMINI_MODEL, geminiCompatibleDir } from './run-gemini-clp-trial.js'
import { callOpenRouterStream, reconcileGenerationCost } from './openrouter-stream.js'
import { createPrivateStreamJournal } from './stream-journal.js'

export const PROBE_BUDGET_USD = .0043
export const probeDir = `${privateDir}/gemini-connection-20261006-v1`
export function approvedProbe(plan) {
  const stage = plan.stages?.find(s => s.id === 'connection')
  if (!stage || stage.body.model !== GEMINI_MODEL || stage.maxCalls !== 1 || stage.retries !== 0 ||
    stage.body.max_tokens !== 256 || stage.body.reasoning?.effort !== 'medium' ||
    stage.reservedUsd > PROBE_BUDGET_USD || stage.reservedUsd <= 0) throw new Error('probe_not_authorized')
  const schema = stage.body.response_format?.json_schema?.schema
  if (JSON.stringify(schema) !== JSON.stringify({ type: 'object', additionalProperties: false,
    properties: { status: { type: 'string', enum: ['ok'] } }, required: ['status'] })) throw new Error('probe_schema_changed')
  return stage
}
export function assessProbe(result) {
  let output = null
  try { output = JSON.parse(result.partialText) } catch { /* partial output is not repaired */ }
  const schemaPassed = result.valid === true && output !== null && typeof output === 'object' &&
    !Array.isArray(output) && Object.keys(output).length === 1 && output.status === 'ok'
  return { transportPassed: result.valid === true, schemaPassed,
    connectionPassed: schemaPassed, reportGenerated: false, reportQuality: 'not_evaluated',
    generationCalls: 1, retries: 0, output: schemaPassed ? output : null }
}

async function main() {
  const mode = process.argv[2] ?? 'check'
  if (process.argv.length > 3 || !['check', 'run'].includes(mode)) throw new Error('invalid_probe_mode')
  const input = JSON.parse(await fs.readFile(`${finalTrialDir}/snapshot.json`, 'utf8'))
  const plan = diagnosticPlan(input), stage = approvedProbe(plan)
  const get = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('probe_preflight_failed')
    return response.json()
  }
  const [catalog, zdr] = await Promise.all([
    get(`https://openrouter.ai/api/v1/models/${GEMINI_MODEL}/endpoints`),
    get('https://openrouter.ai/api/v1/endpoints/zdr'),
  ])
  const endpoint = checkGeminiEndpoint(catalog, zdr, stage.body)
  if (mode === 'check') {
    console.log(JSON.stringify({ stage: stage.id, generationCalls: 0, reservedUsd: stage.reservedUsd,
      budgetUsd: PROBE_BUDGET_USD, requestHash: stage.requestHash, endpoint })); return
  }
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(stage).includes(apiKey)) throw new Error('invalid_local_key')
  const prior = JSON.parse(await fs.readFile(`${geminiCompatibleDir}/accounting.json`, 'utf8'))
  await fs.mkdir(probeDir) // permanent single-call lock, retained even on a crash
  const save = (name, value) => fs.writeFile(`${probeDir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  await save('authorization', { approvedAt: new Date().toISOString(), approvedBy: 'user-current-thread',
    budgetUsd: PROBE_BUDGET_USD, maxCalls: 1, retries: 0, automaticStageAdvance: false })
  await save('request', stage)
  await save('preflight', endpoint)
  await save('reservation', { reservedUsd: stage.reservedUsd, costUsd: null, state: 'reserved' })
  const journal = await createPrivateStreamJournal('gemini-connection-20261006-v1')
  const result = await callOpenRouterStream({ body: stage.body, apiKey, checkpoint: journal })
  await save('result', result)
  let cost = { costUsd: result.costUsd, costSource: result.costSource }
  if (cost.costUsd === null && result.responseId) {
    cost = await reconcileGenerationCost({ responseId: result.responseId, apiKey })
    await save('cost-reconciliation', cost)
  }
  const assessment = assessProbe(result)
  await save('assessment', assessment)
  const accounting = { ...cost, reservedUsd: stage.reservedUsd,
    confirmedTotalUsd: Number((prior.confirmedTotalUsd + (cost.costUsd ?? 0)).toFixed(9)),
    unknownReservedTotalUsd: Number((prior.unknownReservedTotalUsd + (cost.costUsd === null ? stage.reservedUsd : 0)).toFixed(9)),
    generationCalls: 1, retries: 0, budgetUsd: PROBE_BUDGET_USD }
  await save('accounting', accounting)
  console.log(JSON.stringify({ ...assessment, ...accounting, model: result.actualModel,
    errors: result.errors, httpStatus: result.httpStatus, responseId: result.responseId,
    latencyMs: result.latencyMs, headersMs: result.headersMs, firstContentMs: result.firstContentMs,
    finishReason: result.finishReason, usage: result.usage,
    providerErrorCode: result.providerError?.code ?? null }))
  if (cost.costUsd !== null && cost.costUsd > stage.reservedUsd) throw new Error('probe_cost_exceeded_reservation_stop')
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(/^[a-z_]+$/.test(error.message ?? '') ? error.message : 'connection_probe_failed'); process.exitCode = 1 })
}
