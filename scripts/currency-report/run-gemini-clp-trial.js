// User-authorized local comparison: one Gemini Flash medium call, no retry.
import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'
import { privateDir } from './storage.js'
import { APPROVED_INPUT_HASH, finalTrialDir, validateFinalTrial } from './run-final-clp-trial.js'
import { fingerprint, inputUpperBound, MAX_OUTPUT, callPaid } from './paid-comparison.js'
import { draftAssessment } from './trial-common-rules.js'

export const GEMINI_MODEL = 'google/gemini-3.8-flash'
export const GEMINI_PRICE = Object.freeze({ prompt: .75, completion: 3.75 })
export const GEMINI_BUDGET = .05
export const geminiTrialDir = `${privateDir}/clp-20260911-gemini38-v1`
export const geminiCompatibleDir = `${privateDir}/clp-20260911-gemini38-compatible-v1`

// Google supports a schema subset and may reject complex constraints. Keep the
// complete contract in composeDraft; simplify only provider-side decoding.
export function geminiWireSchema(schema) {
  const { minLength: _min, maxLength: _max, pattern: _pattern,
    minItems: _minItems, maxItems: _maxItems, ...wire } = structuredClone(schema)
  if (wire.properties) wire.properties = Object.fromEntries(Object.entries(wire.properties).map(([key, value]) => [key, geminiWireSchema(value)]))
  if (wire.items) wire.items = geminiWireSchema(wire.items)
  return wire
}

export function prepareGeminiTrial(input, compatible = false) {
  validateFinalTrial(input)
  const body = structuredClone(input.body)
  body.model = GEMINI_MODEL
  delete body.max_completion_tokens
  body.max_tokens = MAX_OUTPUT
  if (compatible) body.response_format.json_schema.schema = geminiWireSchema(body.response_format.json_schema.schema)
  body.provider = { only: ['google-vertex/global'], require_parameters: true, data_collection: 'deny',
    zdr: true, allow_fallbacks: false, max_price: GEMINI_PRICE }
  const reservedUsd = Math.ceil((inputUpperBound(body) * GEMINI_PRICE.prompt + MAX_OUTPUT * GEMINI_PRICE.completion) / 1e6 * 1e9) / 1e9
  if (reservedUsd > GEMINI_BUDGET) throw new Error('gemini_budget_exceeded')
  return { packet: input.packet, body, sourceInputHash: APPROVED_INPUT_HASH,
    inputHash: fingerprint({ packet: input.packet, body }), reservedUsd, budgetUsd: GEMINI_BUDGET,
    maxCalls: 1, retries: 0 }
}

export function checkGeminiEndpoint(catalog, zdr, body) {
  const endpoint = catalog.data?.endpoints?.find(e => e.tag === body.provider.only[0])
  const price = v => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0
  if (!endpoint || endpoint.model_id !== GEMINI_MODEL || endpoint.status !== 0 ||
    !zdr.data?.some(e => e.tag === endpoint.tag && e.model_id === GEMINI_MODEL) ||
    !['reasoning', 'structured_outputs', 'response_format', 'max_tokens'].every(p => endpoint.supported_parameters?.includes(p)) ||
    endpoint.max_completion_tokens < MAX_OUTPUT || !price(endpoint.pricing?.prompt) || !price(endpoint.pricing?.completion) ||
    Number(endpoint.pricing.prompt) > GEMINI_PRICE.prompt / 1e6 || Number(endpoint.pricing.completion) > GEMINI_PRICE.completion / 1e6 ||
    Number(endpoint.pricing.internal_reasoning ?? endpoint.pricing.completion) > GEMINI_PRICE.completion / 1e6 ||
    Number(endpoint.pricing.request ?? 0) !== 0 || endpoint.pricing.overrides?.some(p => p.min_prompt_tokens <= inputUpperBound(body)))
    throw new Error('gemini_endpoint_privacy_or_price_not_supported')
  return { checkedAt: new Date().toISOString(), model: GEMINI_MODEL, provider: endpoint.tag,
    zdr: true, dataCollection: 'deny', pricing: endpoint.pricing, supportedParameters: endpoint.supported_parameters }
}

async function main() {
  const mode = process.argv[2] ?? 'check'
  if (process.argv.length > 3 || !['check', 'run', 'check-compatible', 'run-compatible'].includes(mode)) throw new Error('invalid_mode')
  const compatible = mode.endsWith('-compatible')
  const dir = compatible ? geminiCompatibleDir : geminiTrialDir
  const save = (name, value) => fs.writeFile(`${dir}/${name}.json`, JSON.stringify(value, null, 2), { flag: 'wx' })
  const input = JSON.parse(await fs.readFile(`${finalTrialDir}/snapshot.json`, 'utf8'))
  const config = prepareGeminiTrial(input, compatible)
  let priorCorrectionReservation = 0
  if (compatible) {
    const first = JSON.parse(await fs.readFile(`${geminiTrialDir}/result.json`, 'utf8'))
    if (first.candidate || !first.errors?.includes('http_400')) throw new Error('not_a_pre_generation_format_rejection')
    priorCorrectionReservation = first.costUsd ?? JSON.parse(await fs.readFile(`${geminiTrialDir}/reservation.json`, 'utf8')).reservedUsd
    if (priorCorrectionReservation + config.reservedUsd > .10) throw new Error('correction_total_budget_exceeded')
  }
  const get = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error('gemini_preflight_failed'); return r.json() }
  const [catalog, zdr] = await Promise.all([get(`https://openrouter.ai/api/v1/models/${GEMINI_MODEL}/endpoints`), get('https://openrouter.ai/api/v1/endpoints/zdr')])
  const endpoint = checkGeminiEndpoint(catalog, zdr, config.body)
  if (mode.startsWith('check')) {
    console.log(JSON.stringify({ model: GEMINI_MODEL, reservedUsd: config.reservedUsd, budgetUsd: GEMINI_BUDGET,
      inputHash: config.inputHash, maxCalls: 1, retries: 0, generationCalls: 0, priorCorrectionReservation, endpoint })); return
  }
  const apiKey = parse(await fs.readFile('.env.report.local', 'utf8')).OPENROUTER_API_KEY
  if (!apiKey || JSON.stringify(config).includes(apiKey)) throw new Error('invalid_local_key')
  // A permanent campaign lock prevents duplicate spend after a crash or another invocation.
  await fs.mkdir(dir)
  await save('authorization', { authorizedBy: 'user-in-current-thread', at: new Date().toISOString(),
    model: GEMINI_MODEL, budgetUsd: GEMINI_BUDGET, maxCalls: 1, retries: 0,
    ...(compatible ? { correctionTotalBudgetUsd: .10, priorCorrectionReservation } : {}) })
  await save('snapshot', config)
  await save('preflight', endpoint)
  await save('reservation', { reservedUsd: config.reservedUsd, costUsd: null, state: 'reserved' })
  const result = await callPaid({ body: config.body, packet: config.packet, apiKey })
  await save('result', result)
  const assessment = draftAssessment(result)
  await save('draft-assessment', assessment)
  const prior = JSON.parse(await fs.readFile(`${compatible ? geminiTrialDir : finalTrialDir}/accounting.json`, 'utf8'))
  const accounting = { costUsd: result.costUsd, costSource: result.costSource,
    confirmedTotalUsd: Number((prior.confirmedTotalUsd + (result.costUsd ?? 0)).toFixed(9)),
    unknownReservedTotalUsd: Number((prior.unknownReservedTotalUsd + (result.costUsd === null ? config.reservedUsd : 0)).toFixed(9)),
    generationCalls: 1, retries: 0, budgetUsd: GEMINI_BUDGET }
  await save('accounting', accounting)
  console.log(JSON.stringify({ ...assessment, ...accounting, model: result.actualModel, errors: result.errors,
    latencyMs: result.latencyMs, promptTokens: result.promptTokens, completionTokens: result.completionTokens, reasoningTokens: result.reasoningTokens }))
  if (result.costUsd !== null && result.costUsd > config.reservedUsd) throw new Error('provider_cost_exceeded_reservation_stop')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(/^[a-z_]+$/.test(error.message ?? '') ? error.message : error.code ?? 'gemini_trial_failed'); process.exitCode = 1 })
}
