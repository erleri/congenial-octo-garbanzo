import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { currentCase, writerDraft } from './test-support.js'
import { requestBody, composeDraft } from './openrouter.js'
import { generationWire, decodeGenerationOutput } from './generation-wire.js'
import { prepareSolComparison, inspectSolEndpoint } from './sol-comparison-preparation.js'
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
function fixture() {
  const x = currentCase('CLP'), body = requestBody(x.packet, 'openrouter/free')
  const wire = generationWire(body.response_format.json_schema.schema, 'anthropic/claude-sonnet-5.5')
  body.model = 'anthropic/claude-sonnet-5.5'; body.max_tokens = 8192; delete body.max_completion_tokens
  body.reasoning = { effort: 'medium' }; body.response_format.json_schema.schema = wire.schema
  const sent = JSON.parse(body.messages[1].content); sent.outputLayout = wire.contract
  body.messages[1].content = JSON.stringify(sent)
  return { ...x, reference: { packet: x.packet, plan: { body, requestHash: hash(body), packetHash: hash(x.packet), outputContract: wire.contract } } }
}

it('preserves writing content and output shape across models, keeps approval false and holds a conservative cost above the requested band', () => {
  const network = vi.fn(() => { throw Error('offline_only') }); vi.stubGlobal('fetch', network)
  try {
    const f = fixture(), before = structuredClone(f.reference), plan = prepareSolComparison(f.reference)
    expect(plan).toMatchObject({ status: 'budget_hold', messagesAndSchemaPreserved: true, paidCallAuthorized: false, modelCalls: 0, retries: 0 })
    expect(plan.budget.reservationUsd).toBeGreaterThan(plan.budget.allowedMaximumUsd)
    expect(plan.budget).toMatchObject({ sameUsageEstimateUsd: .045854, exactTargetModelInputTokens: null, estimateIsGuaranteedMaximum: false })
    expect(plan.body).toMatchObject({ model: 'openai/gpt-6.1-sol', max_completion_tokens: 8192, reasoning: { effort: 'medium' }, provider: { only: ['azure'], allow_fallbacks: false, zdr: true } })
    expect(plan.body).not.toHaveProperty('max_tokens')
    expect(f.reference).toEqual(before); expect(network).not.toHaveBeenCalled()
    const draft = writerDraft(f), slots = structuredClone(draft)
    for (const [field, { max }] of Object.entries(plan.outputContract.sections) as [string, { max: number }][]) {
      slots[field] = Object.fromEntries(Array.from({ length: max }, (_, i) => [`slot_${i}`, draft[field][i] ?? null]))
    }
    const decoded = decodeGenerationOutput(slots, plan.outputContract)
    expect(decoded).toEqual(draft)
    expect(composeDraft(f.packet, decoded, true, true).rules.semanticStatus).toBe('unverified')
    const oldSchema = generationWire(requestBody(f.packet, 'openrouter/free').response_format.json_schema.schema, 'anthropic/claude-sonnet-5.5').schema
    expect(oldSchema).toEqual(plan.body.response_format.json_schema.schema)
  } finally { vi.unstubAllGlobals() }
})

it('rejects changed frozen source or request instead of reusing its old approval', () => {
  const a = fixture().reference; a.plan.body.reasoning.effort = 'high'
  expect(() => prepareSolComparison(a)).toThrow('frozen_reference_required')
  const b = fixture().reference; b.packet.baseDate = '2026-01-01'
  expect(() => prepareSolComparison(b)).toThrow('frozen_reference_required')
})

it('checks Sol route privacy, output support and all billable token rates without authorizing generation', () => {
  const plan = prepareSolComparison(fixture().reference)
  const endpoint = { tag: 'azure', model_id: plan.body.model, status: 0, pricing: { prompt: '0.000002', completion: '0.00001', input_cache_write: '0.0000025' },
    supported_parameters: ['reasoning', 'response_format', 'structured_outputs', 'max_completion_tokens'], max_completion_tokens: 128000, context_length: 1050000 }
  const catalog = { data: { endpoints: [endpoint] } }, zdr = { data: [{ tag: 'azure', model_id: plan.body.model }] }
  expect(inspectSolEndpoint(plan, catalog, zdr)).toMatchObject({ zdr: true, modelCalls: 0, executionAuthorized: false })
  expect(() => inspectSolEndpoint(plan, catalog, { data: [] })).toThrow('sol_privacy_support_or_price_hold')
  for (const change of [{ pricing: { ...endpoint.pricing, internal_reasoning: '0.00002' } }, { supported_parameters: ['max_tokens'] },
    { pricing: { ...endpoint.pricing, request: '.01' } }, { pricing: { ...endpoint.pricing, input_cache_write: '.000005' } }]) {
    expect(() => inspectSolEndpoint(plan, { data: { endpoints: [{ ...endpoint, ...change }] } }, zdr)).toThrow('sol_privacy_support_or_price_hold')
  }
})
