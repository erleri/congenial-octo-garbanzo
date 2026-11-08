import { describe, expect, it } from 'vitest'
import { checkGeminiEndpoint, GEMINI_MODEL, geminiWireSchema } from './run-gemini-clp-trial.js'
import { paidBody, assertProviderSchema, parsePaidResponse } from './paid-comparison.js'
import { comparisonPacket, currentCase, wireDraft } from './test-support.js'

// Synthetic provider metadata: these are routing boundaries, not model quality tests.
const body = { provider: { only: ['google-vertex/global'] }, messages: [], response_format: {} }
const endpoint = () => ({ model_id: GEMINI_MODEL, tag: 'google-vertex/global', status: 0,
  max_completion_tokens: 65536, supported_parameters: ['reasoning', 'structured_outputs', 'response_format', 'max_tokens'],
  pricing: { prompt: '0.00000075', completion: '0.00000375', internal_reasoning: '0.00000375' } })
const zdr = { data: [{ tag: 'google-vertex/global', model_id: GEMINI_MODEL }] }

describe('single-call Gemini endpoint admission', () => {
  it('requires the exact model and provider to appear in the ZDR list', () => {
    expect(checkGeminiEndpoint({ data: { endpoints: [endpoint()] } }, zdr, body).provider).toBe('google-vertex/global')
    expect(() => checkGeminiEndpoint({ data: { endpoints: [endpoint()] } }, { data: [{ tag: 'google-vertex/global', model_id: 'other' }] }, body)).toThrow('gemini_endpoint_privacy_or_price_not_supported')
  })
  it('rejects a surcharge on reasoning even when visible output pricing is within budget', () => {
    const e = endpoint()
    e.pricing.internal_reasoning = '0.0000075'
    expect(() => checkGeminiEndpoint({ data: { endpoints: [e] } }, zdr, body)).toThrow('gemini_endpoint_privacy_or_price_not_supported')
  })
  it('rejects an endpoint that silently lacks structured output support', () => {
    const e = endpoint()
    e.supported_parameters = ['reasoning', 'max_tokens']
    expect(() => checkGeminiEndpoint({ data: { endpoints: [e] } }, zdr, body)).toThrow('gemini_endpoint_privacy_or_price_not_supported')
  })
  it('retains the application length and source checks when provider decoding constraints are simplified', () => {
    const original = paidBody(comparisonPacket(), 'openai/gpt-5.4').response_format.json_schema.schema
    const wire = geminiWireSchema(original)
    expect(() => assertProviderSchema(wire)).not.toThrow()
    expect(wire.properties.drivers.items.properties.evidenceIds.items.enum).toEqual(original.properties.drivers.items.properties.evidenceIds.items.enum)
    const sample = currentCase(), draft = wireDraft(sample)
    const parse = () => parsePaidResponse({ model: GEMINI_MODEL,
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] }, sample.packet, GEMINI_MODEL, true)
    expect(parse().safetyValidation?.valid).toBe(true)
    draft.drivers[0].text = '설명'.repeat(300)
    expect(parse().errors).toContain('draft_schema')
    draft.drivers[0].text = sample.content.drivers[0].text
    draft.drivers[0].evidenceIds = ['unverified-source']
    expect(parse().errors).toContain('draft_schema')
  })
})
