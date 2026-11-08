// Preparation only. No credentials, generation transport, approval, or execution.
import { createHash } from 'node:crypto'
import Ajv from 'ajv'
import { requestTokenBound } from './request-budget.js'
import { assertGenerationWireRequest } from './generation-wire.js'

export const SOL_COMPARISON = Object.freeze({ model: 'openai/gpt-6.1-sol', route: 'azure',
  referenceUsd: .045854, prompt: 2, completion: 10, cacheWrite: 2.5, outputTokens: 8192 })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const ceilUsd = value => Math.ceil(value * 1e9) / 1e9

export function prepareSolComparison(reference) {
  const prior = reference?.plan, original = prior?.body
  if (!original || original.model !== 'anthropic/claude-sonnet-5.5' || prior.requestHash !== hash(original)
    || prior.packetHash !== hash(reference.packet) || prior.outputContract?.writingContractVersion !== 'writer-links/1'
    || original.reasoning?.effort !== 'medium' || original.max_tokens !== 8192)
    throw new Error('frozen_reference_required')
  assertGenerationWireRequest(original, prior.outputContract)
  const body = structuredClone(original), contract = { ...structuredClone(prior.outputContract), model: SOL_COMPARISON.model }
  const sent = JSON.parse(body.messages.find(m => m.role === 'user').content)
  sent.outputLayout = contract
  body.messages.find(m => m.role === 'user').content = JSON.stringify(sent)
  body.model = SOL_COMPARISON.model
  delete body.max_tokens
  body.max_completion_tokens = SOL_COMPARISON.outputTokens
  body.provider = { only: [SOL_COMPARISON.route], require_parameters: true, zdr: true, data_collection: 'deny',
    allow_fallbacks: false, max_price: { prompt: SOL_COMPARISON.prompt, completion: SOL_COMPARISON.completion } }
  assertGenerationWireRequest(body, contract)
  new Ajv({ allErrors: true }).compile(body.response_format.json_schema.schema)
  const bound = requestTokenBound(body), capUsd = Math.floor(SOL_COMPARISON.referenceUsd * 1.25 * 1e9) / 1e9
  const maximumUsd = ceilUsd((bound * SOL_COMPARISON.cacheWrite + SOL_COMPARISON.outputTokens * SOL_COMPARISON.completion) / 1e6)
  if (bound > 44000 || /sk-or-|-----BEGIN .*PRIVATE KEY|bearer\s+\S+|[\w.+-]+@[\w.-]+\.[a-z]{2}/i.test(JSON.stringify(body.messages)))
    throw new Error('unsafe_or_oversized_sol_input')
  const oldSent = JSON.parse(original.messages.find(m => m.role === 'user').content)
  delete oldSent.outputLayout; const contentOnly = structuredClone(sent); delete contentOnly.outputLayout
  if (hash(oldSent) !== hash(contentOnly) || body.messages[0].content !== original.messages[0].content
    || hash(body.response_format) !== hash(original.response_format)) throw new Error('comparison_content_changed')
  return { version: 'sol-comparison-preparation/1', status: maximumUsd > capUsd ? 'budget_hold' : 'prepared_pending_approval',
    currency: reference.packet.currency, baseDate: reference.packet.baseDate, sourceRequestHash: prior.requestHash,
    packetHash: prior.packetHash, contentHash: hash(contentOnly), requestHash: hash(body), body, outputContract: contract,
    budget: { referenceActualUsd: SOL_COMPARISON.referenceUsd, allowedMinimumUsd: .0343905, allowedMaximumUsd: capUsd,
      sameUsageEstimateUsd: .045854, estimatePromptTokens: 16132, estimateCompletionTokens: 1359,
      inputTokenUpperBound: bound, inputReservationPerMillion: SOL_COMPARISON.cacheWrite,
      outputTokenUpperBoundIncludingReasoning: SOL_COMPARISON.outputTokens, reservationUsd: maximumUsd,
      exactTargetModelInputTokens: null, estimateIsGuaranteedMaximum: false },
    timeoutMs: 120000, retries: 0, maximumNewCalls: 1, messagesAndSchemaPreserved: true,
    paidCallAuthorized: false, publicationApproved: false, modelCalls: 0 }
}

export function inspectSolEndpoint(plan, catalog, zdr) {
  const body = plan?.body
  if (body?.model !== SOL_COMPARISON.model || plan.requestHash !== hash(body)
    || body.provider?.only?.join(',') !== SOL_COMPARISON.route || body.provider?.zdr !== true
    || body.provider?.data_collection !== 'deny' || body.provider?.require_parameters !== true
    || body.provider?.allow_fallbacks !== false || body.reasoning?.effort !== 'medium'
    || body.max_completion_tokens !== SOL_COMPARISON.outputTokens || body.tools?.length || body.plugins?.length)
    throw new Error('unsafe_sol_preparation')
  const endpoint = catalog.data?.endpoints?.find(e => e.tag === SOL_COMPARISON.route)
  const price = (value, ceiling) => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= ceiling / 1e6
  if (!endpoint || endpoint.model_id !== body.model || endpoint.status !== 0
    || !zdr.data?.some(e => e.model_id === body.model && e.tag === SOL_COMPARISON.route)
    || !['reasoning', 'response_format', 'structured_outputs', 'max_completion_tokens'].every(p => endpoint.supported_parameters?.includes(p))
    || endpoint.max_completion_tokens < body.max_completion_tokens
    || endpoint.context_length < requestTokenBound(body) + body.max_completion_tokens
    || !price(endpoint.pricing?.prompt, 2) || !price(endpoint.pricing?.completion, 10)
    || !price(endpoint.pricing?.internal_reasoning ?? endpoint.pricing?.completion, 10)
    || Number(endpoint.pricing?.request ?? 0) !== 0
    || ['input_cache_read','input_cache_write','input_cache_write_1h'].some(k => endpoint.pricing[k] !== undefined && !price(endpoint.pricing[k], 2.5))
    || endpoint.pricing?.overrides?.some(o => o.min_prompt_tokens <= requestTokenBound(body)))
    throw new Error('sol_privacy_support_or_price_hold')
  return { model: body.model, route: SOL_COMPARISON.route, pricing: endpoint.pricing,
    zdr: true, dataCollection: 'deny', structuredOutputSupport: true, modelCalls: 0,
    executionAuthorized: false, checkedAt: new Date().toISOString() }
}
