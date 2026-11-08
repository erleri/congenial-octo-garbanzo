import { describe, expect, it, vi } from 'vitest'
import { generateCandidate } from './openrouter.js'
import { parsePaidResponse } from './paid-comparison.js'
import { currentCase, writerDraft, modelResponse } from './test-support.js'

// Thin integration tests: failure propagation and no retry, NOT copies of
// low-level content/editorial/ledger rule matrices.
describe('generation gate propagation with current-schema responses', () => {
  it('propagates editorial rejection after a successful safety gate in free and paid paths', async () => {
    const a = currentCase()
    a.content.drivers = [{ ...a.content.drivers[0], title: '관측 한계와 원인 단정의 어려움',
      text: '관측시각이 달라 직접 원인을 확정할 수 없다. 해당 발표만으로 전체 변동을 설명하기 어렵다.' }]
    const wire = writerDraft(a), model = 'openai/gpt-5.4'
    const payload = { model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(wire) } }] }
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    const free = await generateCandidate({ apiKey: 'test-key', model: 'openrouter/free', packet: a.packet, fetchImpl })
    expect(free.validation).toEqual({ valid: true, errors: [] })
    expect(free.reason).toBe('common_rules_hold')
    expect(free.editorial.blockers).toEqual(['drivers.0:limitation_as_driver'])
    expect(free.candidate.drivers[0]).toEqual(a.content.drivers[0])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const paid = parsePaidResponse(payload, a.packet, model, true)
    expect(paid.safetyValidation).toEqual(free.validation)
    expect(paid.editorial).toEqual(free.editorial)
    expect(paid).toMatchObject({ valid: false, retryable: false })
    expect(paid.errors).toContain('editorial:drivers.0:limitation_as_driver')
  })
  it('propagates a ledger failure without treating valid prose as approved', async () => {
    const a = currentCase(), wire = writerDraft(a)
    wire.ruleLedger.claims.find(c => c.target === 'title').evidenceIds = ['unknown']
    const fetchImpl = vi.fn().mockResolvedValue(modelResponse(wire, 'openrouter/free'))
    const run = await generateCandidate({ apiKey: 'test-only', packet: a.packet, model: 'openrouter/free', fetchImpl })
    expect(run.validation.valid).toBe(false)
    expect(run.validation.errors).toEqual(['draft_schema'])
    expect(run.validation.details).toContain('.ruleLedger.claims[0].evidenceIds[0]:enum')
    expect(run.reason).toBe('validation_failed')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
