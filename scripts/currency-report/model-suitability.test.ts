import { describe, expect, it } from 'vitest'
import { prepareSuitability, executeSuitability, writerEndpointPreflight, WRITER_MODELS } from './model-suitability-local.js'
import { fingerprint } from './research-harness.js'
import { packetBinding } from './rules.js'
import { syntheticCase } from './rule-fixtures.js'

function cases() {
  return ['CLP', 'BRL'].map(currency => {
    const { packet } = syntheticCase(currency)
    const body = { model: 'google/gemini-3.8-flash', stream: true, reasoning: { effort: 'medium' }, max_tokens: 16384,
      messages: [{ role: 'system', content: 'synthetic fixed writer contract' }, { role: 'user', content: JSON.stringify({ researchBrief: { version: 'synthetic' } }) }],
      response_format: { type: 'json_schema', json_schema: { name: 'synthetic', strict: true, schema: { type: 'object' } } },
      provider: { only: ['google-vertex/global/flex'] } }
    return { packet, plan: { packetHash: packetBinding(packet), calls: [{ stage: 'harness_generation', body, requestHash: fingerprint(body) }] } }
  })
}
const failed = { valid: false, actualModel: null, errors: ['http_429'], costUsd: 0 }
describe('Frozen two-case writer suitability trial', () => {
  it('preserves all editorial messages/schema and isolates only model routing and output aliases', () => {
    const snapshots = cases(), before = structuredClone(snapshots), plan = prepareSuitability(snapshots)
    expect(plan.calls.map(c => c.stage)).toEqual(['clp-gpt54', 'clp-sonnet55', 'brl-gpt54', 'brl-sonnet55'])
    for (const call of plan.calls) {
      const original = snapshots.find(s => s.packet.currency === call.currency)!.plan.calls[0].body
      expect(call.body.messages).toEqual(original.messages)
      expect(call.body.response_format).toEqual(original.response_format)
      expect(call.body.provider).toMatchObject({ zdr: true, data_collection: 'deny', allow_fallbacks: false })
      expect(call.body.model.startsWith('openai/') ? call.body.max_completion_tokens : call.body.max_tokens).toBe(16384)
      expect(call.body.model.startsWith('openai/') ? call.body.max_tokens : call.body.max_completion_tokens).toBeUndefined()
    }
    expect(snapshots).toEqual(before)
  })
  it('rejects changed input and an insufficient approval before any invocation', async () => {
    const snapshots = cases(), plan = prepareSuitability(snapshots)
    let calls = 0
    const invoke = async () => { calls++; return failed }
    await expect(executeSuitability({ plan, snapshots, approvedBudgetUsd: plan.totalMaximumUsd - .001, invoke })).rejects.toThrow('unapproved_writer_comparison')
    plan.calls[0].body.messages[0].content += ' changed'
    await expect(executeSuitability({ plan, snapshots, approvedBudgetUsd: 1.11, invoke })).rejects.toThrow('unapproved_writer_comparison')
    expect(calls).toBe(0)
  })
  it('records four failures once each rather than retrying or falling back', async () => {
    const snapshots = cases(), plan = prepareSuitability(snapshots), calls: string[] = []
    const r = await executeSuitability({ plan, snapshots, approvedBudgetUsd: 1.11,
      invoke: async c => { calls.push(c.stage); return failed } })
    expect(calls).toEqual(plan.calls.map(c => c.stage))
    expect(r.results.every(c => c.status === 'transport_failed')).toBe(true)
    expect(r.actualCostUsd).toBe(0); expect(r.unknownReservedUsd).toBe(0)
  })
  it('preserves unknown reservations and stops after an interrupted request', async () => {
    const snapshots = cases(), plan = prepareSuitability(snapshots)
    let calls = 0
    const r = await executeSuitability({ plan, snapshots, approvedBudgetUsd: 1.11, invoke: async () => {
      calls++; throw new Error('interrupted')
    } })
    expect(calls).toBe(1); expect(r.status).toBe('interrupted')
    expect(r.unknownReservedUsd).toBe(plan.calls[0].maximumUsd)
    expect(r.ledger.slice(1).every(r => r.state === 'not_started')).toBe(true)
  })
  it('detects an unexpected billed model and halts when a charge exceeds its reservation', async () => {
    const snapshots = cases(), plan = prepareSuitability(snapshots)
    const mismatch = await executeSuitability({ plan, snapshots, approvedBudgetUsd: 1.11,
      invoke: async () => ({ ...failed, valid: true, actualModel: 'unexpected/model' }) })
    expect(mismatch.results.every(r => r.status === 'model_mismatch')).toBe(true)
    let calls = 0
    const over = await executeSuitability({ plan, snapshots, approvedBudgetUsd: 1.11, invoke: async c => {
      calls++; return { ...failed, costUsd: c.maximumUsd + .001 }
    } })
    expect(over.status).toBe('cost_exceeded'); expect(calls).toBe(1)
  })
  it('preflights Azure output alias and structured support but never accepts missing ZDR', async () => {
    const body = prepareSuitability(cases()).calls[0].body, config = WRITER_MODELS[0]
    const endpoint = { tag: 'azure', model_id: config.model, status: 0, context_length: 100000, max_completion_tokens: 16384,
      supported_parameters: ['reasoning', 'response_format', 'structured_outputs', 'max_completion_tokens'],
      pricing: { prompt: '0.0000025', completion: '0.000015' } }
    const mock = (zdr: boolean) => async url => new Response(JSON.stringify(url.includes('/zdr')
      ? { data: zdr ? [{ tag: 'azure', model_id: config.model }] : [] } : { data: { endpoints: [endpoint] } }))
    expect(await writerEndpointPreflight(body, mock(true))).toMatchObject({ route: 'azure', modelCalls: 0 })
    await expect(writerEndpointPreflight(body, mock(false))).rejects.toThrow('writer_privacy_support_or_price_failed')
    endpoint.supported_parameters = ['reasoning', 'response_format', 'max_tokens']
    await expect(writerEndpointPreflight(body, mock(true))).rejects.toThrow('writer_privacy_support_or_price_failed')
  })
})
