// Authorization: one GPT-5.4 medium generation, additional USD 0.18, no retry.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'
import { privateDir } from './storage.js'
import { paidBody, fingerprint, inputUpperBound, reservationFor, callPaid, PROFILES } from './paid-comparison.js'
import { draftAssessment } from './trial-common-rules.js'

export const FINAL_TRIAL_BUDGET = .18
export const APPROVED_INPUT_HASH = '39c2572d538812e2ef05d4eca0cda3e0113e055c9ad67463cce4c8b17c7515f0'
export const finalTrialDir = `${privateDir}/clp-20260911-final-rules-v1`
const readInput = () => fs.readFile(`${privateDir}/clp-20260911-final-input-v1/input.json`, 'utf8').then(JSON.parse)
const save = (name, value) => fs.writeFile(`${finalTrialDir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })

export function validateFinalTrial(input) {
  if (input.inputHash !== APPROVED_INPUT_HASH || fingerprint({ packet: input.packet, body: input.body }) !== APPROVED_INPUT_HASH)
    throw new Error('approved_input_changed')
  if (fingerprint(paidBody(input.packet, 'openai/gpt-5.4')) !== fingerprint(input.body)) throw new Error('current_request_contract_changed')
  const reservedUsd = reservationFor(input.body)
  if (reservedUsd > FINAL_TRIAL_BUDGET) throw new Error('approved_budget_exceeded')
  return { reservedUsd, budgetUsd: FINAL_TRIAL_BUDGET, maxCalls: 1, retries: 0, inputHash: APPROVED_INPUT_HASH }
}

async function preflight(body) {
  const get = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('endpoint_preflight_failed')
    return response.json()
  }
  const model = body.model, price = PROFILES[model]
  const [zdr, catalog] = await Promise.all([
    get('https://openrouter.ai/api/v1/endpoints/zdr'), get(`https://openrouter.ai/api/v1/models/${model}/endpoints`),
  ])
  const endpoint = catalog.data?.endpoints?.find(e => e.tag === 'azure')
  const nonnegative = v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0
  if (!endpoint || !zdr.data?.some(e => e.tag === 'azure' && e.model_id === model) ||
    !['reasoning', 'structured_outputs', 'response_format', 'max_completion_tokens'].every(p => endpoint.supported_parameters?.includes(p)) ||
    !nonnegative(endpoint.pricing.prompt) || !nonnegative(endpoint.pricing.completion) ||
    Number(endpoint.pricing.prompt) > price.prompt / 1e6 || Number(endpoint.pricing.completion) > price.completion / 1e6 ||
    Number(endpoint.pricing.request ?? 0) !== 0 || endpoint.pricing.overrides?.some(p => p.min_prompt_tokens <= inputUpperBound(body)))
    throw new Error('endpoint_privacy_or_price_not_supported')
  return { checkedAt: new Date().toISOString(), model, provider: 'azure', zdr: true,
    dataCollection: 'deny', pricing: endpoint.pricing, supportedParameters: endpoint.supported_parameters }
}

async function main() {
  if (process.argv.length > 3 || !['check', 'run'].includes(process.argv[2] ?? 'check')) throw new Error('invalid_mode')
  const input = await readInput(), authorization = validateFinalTrial(input)
  const endpoint = await preflight(input.body)
  if ((process.argv[2] ?? 'check') === 'check') {
    console.log(JSON.stringify({ ...authorization, ...endpoint, generationCalls: 0 })); return
  }
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(input).includes(apiKey)) throw new Error('invalid_local_key')
  await fs.mkdir(finalTrialDir) // Permanent single-use lock; even interrupted calls cannot run twice.
  await save('authorization', { ...authorization, authorizedBy: 'user-in-current-thread', at: new Date().toISOString() })
  await save('snapshot', input)
  await save('preflight', endpoint)
  await save('reservation', { ...authorization, costUsd: null, state: 'reserved' })
  const result = await callPaid({ body: input.body, packet: input.packet, apiKey })
  await save('result', result)
  const assessment = draftAssessment(result)
  await save('draft-assessment', assessment)
  const accounting = { costUsd: result.costUsd, costSource: result.costSource,
    confirmedTotalUsd: Number((input.cost.priorConfirmedUsd + (result.costUsd ?? 0)).toFixed(9)),
    unknownReservedTotalUsd: Number((input.cost.priorUnknownReservedUsd + (result.costUsd === null ? authorization.reservedUsd : 0)).toFixed(9)),
    generationCalls: 1, retries: 0, budgetUsd: FINAL_TRIAL_BUDGET }
  await save('accounting', accounting)
  console.log(JSON.stringify({ ...assessment, ...accounting, model: result.actualModel, errors: result.errors,
    latencyMs: result.latencyMs, promptTokens: result.promptTokens, completionTokens: result.completionTokens, reasoningTokens: result.reasoningTokens }))
  if (result.costUsd !== null && result.costUsd > authorization.reservedUsd) throw new Error('provider_cost_exceeded_reservation_stop')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(/^[a-z_]+$/.test(error.message ?? '') ? error.message : error.code ?? 'final_trial_failed')
    process.exitCode = 1
  })
}
