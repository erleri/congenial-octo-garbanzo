import { describe, expect, it, vi } from 'vitest'
import { buildPacket } from './core.js'
import { clpEvidence } from './clp-case.js'
import { paidBody, parsePaidResponse, callPaid, fingerprint } from './paid-comparison.js'
import { requestBody } from './openrouter.js'
const model = 'openai/gpt-5.4'
const data = { baseDate: '2026-09-11', dailyRates: ['2026-08-31','2026-09-04','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11'].map((date,i) => ({ date, currency: 'CLP', rateType: 'LOCAL_PER_USD', source: 'API', value: 920 + i })) }
const packet = () => buildPacket(data, 'CLP', data.baseDate, clpEvidence)
const block = { title: '배경', text: 'Emol이 구리 조정을 배경으로 설명했습니다.', kind: 'interpretation', evidenceIds: ['emol-close'] }
const draft = () => ({ title: '구리와 소비 여건을 분리해서 읽기', summary: '직접 원인은 확정하지 않습니다.', drivers: [block], implications: [{ ...block, kind: 'mechanism' }], watch: [block] })
const payload = (value = draft()) => ({ model, id: 'gen-test-1', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { cost: .02, prompt_tokens: 1000, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 100 } } })
describe('paid historical comparison safety', () => {




  it('admits CLP original-reviewed sources only; does not infer observation time', () => {
    const p = packet()
    expect(p.evidence).toHaveLength(3)
    expect(p.observationAt).toBeUndefined()
    expect(p.assessment.timeline.every(t => !t.triggerReady)).toBe(true)
    expect(buildPacket(data, 'CLP', data.baseDate, clpEvidence.map(e => ({ ...e, review: undefined }))).evidence).toHaveLength(0)
    expect(p.facts[1].value).toBeCloseTo((926 / 925 - 1) * 100)
  })
  it('requires at least one verified same-day market source', () => {
    expect(() => paidBody({ ...packet(), evidence: [] }, model)).toThrow('original_source_gate_failed')
    expect(() => paidBody({ ...packet(), evidence: packet().evidence.slice(2) }, model)).toThrow('original_source_gate_failed')
  })
  it('allows only explicit paid models without altering the free default boundary', () => {
    expect(() => paidBody(packet(), 'openai/other')).toThrow('paid_model_not_authorized')
    expect(() => requestBody(packet(), model)).toThrow('free_model_required')
    const a = paidBody(packet(), model), b = paidBody(packet(), 'openai/gpt-5.4-mini')
    expect(a.messages).toEqual(b.messages)
    expect(a.response_format).toEqual(b.response_format)
    expect(a.reasoning).toEqual({ effort: 'medium' })
    expect(a.max_completion_tokens).toBe(8192)
    expect(a.provider).toMatchObject({ only: ['azure'], zdr: true, data_collection: 'deny', allow_fallbacks: false, require_parameters: true })
    expect(a).not.toHaveProperty('tools')
  })
  it('binds the chart, prices, sources and prompt into a stable snapshot', () => {
    const p = packet(), body = paidBody(p, model)
    const hash = fingerprint({ packet: p, messages: body.messages })
    expect(fingerprint({ packet: { ...p, series: [] }, messages: body.messages })).not.toBe(hash)
  })

  it('checks returned model, truncation, JSON and evidence IDs without content retries', () => {
    expect(parsePaidResponse(payload(), packet(), model).valid).toBe(true)
    expect(parsePaidResponse({ ...payload(), model: 'other' }, packet(), model).errors).toContain('returned_model_mismatch')
    expect(parsePaidResponse({ ...payload(), choices: [{ finish_reason: 'length' }] }, packet(), model).errors).toContain('output_truncated')
    expect(parsePaidResponse({ ...payload(), choices: [{ finish_reason: 'stop', message: { content: '{' } }] }, packet(), model).errors).toContain('invalid_candidate_json')
    const bad = draft(); bad.drivers = [{ ...block, evidenceIds: ['missing'] }]
    expect(parsePaidResponse(payload(bad), packet(), model)).toMatchObject({ valid: false, retryable: false })
  })
  it.each([429, 500, 502, 503, 504])('marks transient %s retryable but makes only one call', async status => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }))
    const result = await callPaid({ body: paidBody(packet(), model), packet: packet(), apiKey: 'test-key', fetchImpl })
    expect(result.retryable).toBe(true); expect(result.costUsd).toBeNull(); expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each([400, 401, 403, 404])('does not retry or relax endpoint conditions for %s', async status => {
    const result = await callPaid({ body: paidBody(packet(), model), packet: packet(), apiKey: 'test-key', fetchImpl: async () => new Response('{}', { status }) })
    expect(result.retryable).toBe(false)
  })
  it('records returned usage cost and reasoning even if content is rejected', async () => {
    const result = await callPaid({ body: paidBody(packet(), model), packet: packet(), apiKey: 'test-key', fetchImpl: async () => new Response(JSON.stringify(payload())) })
    expect(result).toMatchObject({ valid: false, costUsd: .02, costSource: 'usage.cost', reasoningTokens: 100 })
    expect(result.errors).toContain('writing_contract_required')
  })
  it('looks up missing usage cost once by response ID', async () => {
    const p = payload(); delete p.usage.cost
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(p))).mockResolvedValueOnce(new Response(JSON.stringify({ data: { total_cost: .03 } })))
    const missing = await callPaid({ body: paidBody(packet(), model), packet: packet(), apiKey: 'test-key', fetchImpl })
    expect(missing).toMatchObject({ costUsd: .03, costSource: 'generation.total_cost' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[1][0]).toBe('https://openrouter.ai/api/v1/generation?id=gen-test-1')
  })
  it('keeps cost unknown rather than free when response-ID lookup fails', async () => {
    const p = payload(); delete p.usage.cost
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(p))).mockRejectedValueOnce(new Error('offline'))
    const result = await callPaid({ body: paidBody(packet(), model), packet: packet(), apiKey: 'test-key', fetchImpl })
    expect(result).toMatchObject({ costUsd: null, costSource: 'unknown' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('treats a timeout as ambiguous charge and makes no automatic second paid call', async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))))
    const result = await callPaid({ body: paidBody(packet(), model), packet: packet(), apiKey: 'test-key', fetchImpl, timeoutMs: 5 })
    expect(result).toMatchObject({ costUsd: null, retryable: true, errors: ['timeout'] })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

})
