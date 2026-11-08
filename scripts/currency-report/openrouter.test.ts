import { describe, expect, it, vi } from 'vitest'
import { composeDraft, DEFAULT_MODEL, BACKUP_MODEL, PROMPT_VERSION, draftSchemaForPacket, generateCandidate, requestBody } from './openrouter.js'
import { currentCase, wireDraft, writerDraft, modelResponse } from './test-support.js'
import { syntheticApplication, syntheticUsdApplication } from './rule-fixtures.js'
const packet = () => currentCase().packet
const draft = () => wireDraft(currentCase())
const legacyDraft = () => { const old = draft(); delete old.ruleLedger; return { ...old, implications: [old.drivers[0]], watch: [old.drivers[0]] } }
const okResponse = (candidate = writerDraft(currentCase())) => modelResponse(candidate, DEFAULT_MODEL)

describe('OpenRouter request contract and single-model transport', () => {
  it('does not retry when a model manuscript cannot enter the new review input safely', async () => {
    const unsafe = writerDraft(currentCase()); unsafe.summary = 'private@company.example'
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(unsafe))
    const run = await generateCandidate({ apiKey: 'fake-test-key', packet: packet(), fetchImpl, pause: async () => {} })
    expect(run).toMatchObject({ status: 'failed', reason: 'validation_failed', attempts: 1,
      validation: { errors: ['untrusted_text'] }, claimReview: { status: 'hold', reason: 'content_safety_failed' } })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('allows retention only for explicit public-data trials and rejects unknown settings', () => {
    expect(requestBody(packet(), DEFAULT_MODEL, 'public-data').provider).toEqual({ require_parameters: true, data_collection: 'allow', zdr: false, allow_fallbacks: false })
    expect(requestBody(packet()).provider.zdr).toBe(true)
    expect(() => requestBody(packet(), DEFAULT_MODEL, 'automatic')).toThrow('invalid_privacy_mode')
    expect(() => requestBody(packet(), 'paid/model', 'public-data')).toThrow('free_model_required')
  })
  it('asks the model only for evidence-bound narrative blocks', () => {
    const schema = draftSchemaForPacket(packet(), true)
    expect(schema.properties.change).toBeUndefined()
    expect(schema.properties.limitations).toBeUndefined()
    expect(schema.properties.drivers.items.properties.factIds).toBeUndefined()
    expect(schema.properties.drivers.items.properties.evidenceIds.items.enum).toEqual(['synthetic-policy'])
    expect(schema.properties.summary.pattern).toBe('^[^{}]*$')
    expect(schema.properties.implications.maxItems).toBe(0)
    expect(() => draftSchemaForPacket({ ...packet(), evidence: [] })).toThrow('evidence_required_for_draft')
  })
  it('assembles factual movement and limitations deterministically', () => {
    const result = composeDraft(packet(), legacyDraft())
    expect(result.validation.valid).toBe(true)
    expect(result.candidate.change.factIds).toEqual(['spot', 'day', 'five', 'mtd'])
    expect(result.candidate.change.text).toContain('{{spot}}')
    expect(result.candidate.limitations).toEqual(packet().limitations)
  })
  it('injects only approved USD conversion and code ledger rows while rejecting model-written implications', () => {
    const a = currentCase(), before = structuredClone(a.packet)
    a.packet.mechanismApplications = [syntheticUsdApplication(a.packet)]
    const d = wireDraft(a), result = composeDraft(a.packet, d, true)
    expect(result.validation).toEqual({ valid: true, errors: [] })
    expect(result.rules.automaticStatus).toBe('pass')
    expect(result.candidate.implications).toEqual([{
      title: '같은 달러 결제대금의 현지통화 환산',
      text: '같은 달러 결제금액을 헤지하지 않고 비교한다면, 현지통화 환산액은 달러당 현지통화 환율에 비례합니다. 헤지·선결제·고정 계약 환율이 적용된 결제에는 이 비교를 그대로 적용할 수 없습니다.',
      kind: 'mechanism', factIds: ['spot', 'day', 'five', 'mtd'], evidenceIds: [],
    }])
    expect(result.ruleLedger.claims.filter(c => c.target.startsWith('implications.'))).toHaveLength(3)
    expect(result.claimReview.claims.filter(c => c.target.startsWith('implications.')).every(c => c.owner === 'code')).toBe(true)
    const articleApplication = syntheticApplication(a.packet, 'usd-payment-conversion'); articleApplication.id = 'article-basis'
    a.packet.mechanismApplications.unshift(articleApplication)
    expect(composeDraft(a.packet, d, true).ruleLedger.claims.filter(c => c.target.startsWith('implications.')).every(c => c.applicationId === 'test-application')).toBe(true)
    expect(JSON.parse(requestBody(a.packet).messages[1].content).applicableMechanisms).toEqual([])
    expect(a.packet.facts).toEqual(before.facts)
    expect(d.implications).toEqual([])
    d.implications = [d.drivers[0]]
    expect(composeDraft(a.packet, d, true).validation.errors).toEqual(['draft_schema'])
    delete a.packet.mechanismApplications
    expect(composeDraft(a.packet, wireDraft(a), true).candidate.implications).toEqual([])
  })
  it.each(['publisher', 'period', 'summary', 'title'])('blocks sensitive text in transmitted evidence field %s', field => {
    const p = packet(); p.evidence[0][field] = 'private@company.example'
    expect(() => requestBody(p, DEFAULT_MODEL, 'public-data')).toThrow('unsafe_public_input')
  })
  it('never puts the authentication key in model content', async () => {
    const p = packet(); p.facts[0].label = 'unique-secret-test-token'
    const fetchImpl = vi.fn()
    await expect(generateCandidate({ apiKey: 'unique-secret-test-token', packet: p, privacy: 'public-data', fetchImpl })).rejects.toThrow('credential_in_request_body')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('preserves public-data settings through the one transport retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(okResponse())
    const run = await generateCandidate({ apiKey: 'fake-test-key', packet: packet(), privacy: 'public-data', fetchImpl, pause: async () => {} })
    expect(run.status).toBe('pending_review')
    expect(run.validation).toEqual({ valid: true, errors: [] })
    expect(run.rules.automaticStatus).toBe('pass')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchImpl.mock.calls) expect(JSON.parse(init.body).provider.data_collection).toBe('allow')
  })
  it('projects public fields rather than private metadata or collection timestamps', () => {
    const body = requestBody({ ...packet(), adminEmail: 'private@company.example' })
    expect(JSON.stringify(body)).not.toContain('private@')
    expect(JSON.stringify(body)).not.toContain('collectedAt')
  })
  it.each(['BRL', 'MXN', 'CLP'])('keeps %s timing and source scope separate from synthetic writing examples', currency => {
    const p = currentCase(currency).packet
    p.evidence[0].eventAt = `${p.baseDate}T14:00:00Z`
    p.evidence[0].collectedAt = `${p.baseDate}T20:00:00Z`
    p.evidence[0].review = { scope: '전주 시장에 대한 귀속 해석이며 당일 원인을 입증하지 않는다.' }
    const before = structuredClone(p), body = requestBody(p, 'openrouter/free')
    const input = JSON.parse(body.messages[1].content)
    expect(input).toMatchObject({ promptVersion: PROMPT_VERSION, currency, observationAt: null, applicableMechanisms: [] })
    expect(input.evidence[0]).toMatchObject({ country: p.evidence[0].country, eventAt: p.evidence[0].eventAt, admittedScope: p.evidence[0].review.scope })
    expect(input.evidence[0].collectedAt).toBeUndefined()
    expect(input.writingExamples.every(e => !('evidenceId' in e))).toBe(true)
    expect(body.response_format.json_schema.schema.properties.drivers.items.properties.evidenceIds.items.enum).toEqual(p.evidence.map(e => e.id))
    expect(p).toEqual(before)
    p.observationAt = `${p.baseDate}T09:00:00Z`
    expect(JSON.parse(requestBody(p).messages[1].content).observationAt).toBe(p.observationAt)
  })
  it.each(['observationAt', 'eventAt'])('screens newly projected %s before a request is built', field => {
    const p = packet()
    if (field === 'observationAt') p.observationAt = 'private@company.example'
    else p.evidence[0].eventAt = 'private@company.example'
    expect(() => requestBody(p)).toThrow('unsafe_public_input')
  })
  it('does not admit a legacy draft to the new generation contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(legacyDraft()))
    const r = await generateCandidate({ apiKey: 'fake-test-key', packet: packet(), fetchImpl })
    expect(r.status).toBe('failed'); expect(r.reason).toBe('validation_failed'); expect(r.attempts).toBe(1)
    expect(r.validation.errors).toEqual(['writing_contract_required'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('does not call the network without a key', async () => {
    const fetchImpl = vi.fn()
    expect((await generateCandidate({ packet: packet(), fetchImpl })).reason).toBe('missing_key')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('retries 429 once and stops', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 429 })))
    const r = await generateCandidate({ apiKey: 'test', packet: packet(), fetchImpl, pause: async () => {} })
    expect(r.reason).toBe('http_429'); expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
  it('retries a timeout once and preserves failure', async () => {
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))))
    const r = await generateCandidate({ apiKey: 'test', packet: packet(), fetchImpl, timeoutMs: 5, pause: async () => {} })
    expect(r.reason).toBe('timeout'); expect(r.attempts).toBe(2)
  })
  it.each([401, 404])('does not relax privacy or retry unavailable endpoint %s', async status => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status }))
    expect((await generateCandidate({ apiKey: 'test', packet: packet(), fetchImpl })).reason).toBe(`http_${status}`)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('returns invalid_json once without interpreting a transport response as content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{'))
    expect((await generateCandidate({ apiKey: 'test', packet: packet(), fetchImpl })).reason).toBe('invalid_json')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('propagates a content safety rejection without retry or schema false positive', async () => {
    const c = writerDraft(currentCase()); c.summary = '가격을 인상하세요.'
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(c))
    const result = await generateCandidate({ apiKey: 'test', packet: packet(), fetchImpl })
    expect(result.reason).toBe('validation_failed')
    expect(result.validation.errors).toEqual(['advice_or_instruction'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('keeps malformed candidate diagnostics private without accepting plain prose', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'Incomplete prose', reasoning: 'working' } }] })))
    const run = await generateCandidate({ apiKey: 'fake-test-key', packet: packet(), privacy: 'public-data', fetchImpl })
    expect(run.reason).toBe('output_truncated')
    expect(run.diagnostics).toMatchObject({ finishReason: 'length', toolCallCount: 0, hasContent: true, hasReasoning: true })
    expect(run.raw).toContain('Incomplete prose')
    expect(run.candidate).toBeUndefined()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('recognizes a provider error carried by HTTP 200, never a JSON repair candidate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 502, message: 'untrusted text', metadata: { error_type: 'provider_unavailable' } } })))
    const run = await generateCandidate({ apiKey: 'fake-test-key', packet: packet(), fetchImpl })
    expect(run.reason).toBe('provider_generation_error')
    expect(run.diagnostics?.errorCode).toBe(502)
    expect(run.diagnostics?.errorType).toBe('provider_unavailable')
    expect(run.model).toBe('not_reported')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('never automatically retries a diagnostic request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429 }))
    const run = await generateCandidate({ apiKey: 'fake-test-key', packet: packet(), maxAttempts: 1, fetchImpl })
    expect(run.attempts).toBe(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it('uses model-specific schemas with the same public input and privacy', () => {
    const primary = requestBody(packet(), DEFAULT_MODEL)
    const backup = requestBody(packet(), BACKUP_MODEL)
    expect(backup.messages).toEqual(primary.messages)
    expect(backup.provider).toEqual(primary.provider)
    expect(backup.response_format.json_schema.strict).toBe(true)
    expect(backup.reasoning).toEqual({ effort: 'none' })
    expect(primary.tools[0].function.parameters).toEqual(backup.response_format.json_schema.schema)
  })
  it.each(['scope', 'limitation'])('screens projected %s for private data before sending', field => {
    const p = packet()
    if (field === 'scope') p.evidence[0].review = { scope: 'private@company.example' }
    else p.limitations.push('private@company.example')
    expect(() => requestBody(p)).toThrow('unsafe_public_input')
  })
})
