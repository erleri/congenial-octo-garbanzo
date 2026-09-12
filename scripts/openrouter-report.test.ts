import { describe, expect, it, vi } from 'vitest'
import { enhanceReportWithOpenRouter } from './openrouter-report.js'

const evidence = {
  baseDate: '2026-09-11',
  confidence: 'medium',
  facts: [
    { id: 'fact-brl-day', currency: 'BRL', horizon: 'day', value: 1.2, label: 'BRL 일간 +1.20%' },
    { id: 'fact-brl-five_day', currency: 'BRL', horizon: 'five_day', value: 2.1, label: 'BRL 5영업일 +2.10%' },
  ],
  news: [{ id: 'news-1', title: 'Brazil market update', source: 'Example', publishedAt: null, currencies: ['BRL'], summary: 'Brazil market context.' }],
  metrics: [{ currency: 'BRL', dayPct: 1.2, fiveDayPct: 2.1, volatilityZ: 0.2 }],
}

const decision = {
  leadFactIds: ['fact-brl-day'],
  keyMoves: [{
    currency: 'BRL',
    factIds: ['fact-brl-day', 'fact-brl-five_day'],
    evidenceIds: ['news-1'],
    contextTag: 'local_factor_possible',
  }],
  planSelections: [],
  scenarioTags: ['direction_persistence', 'volatility_range'],
  editorNote: '가격 변동폭과 뉴스 근거를 함께 검토했습니다.',
}

describe('OpenRouter constrained FX editor', () => {
  it('uses strict structured output, renders code-owned prose, and records the selected model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'example/free-model:free', choices: [{ message: { content: JSON.stringify(decision) } }] }),
    })
    const result = await enhanceReportWithOpenRouter({ apiKey: 'test', evidence, fetchImpl, timeoutMs: 100 })
    expect(result.model).toBe('example/free-model:free')
    expect(result.decision).toEqual(decision)
    expect(result.candidate.keyMoves[0].text).toContain('+1.20%')
    expect(result.validation.quality).toMatchObject({ passed: true, threshold: 80 })
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.model).toBe('openrouter/free')
    expect(request.provider).toMatchObject({ require_parameters: true, data_collection: 'deny', zdr: true })
    expect(request.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'latam_fx_editorial_decision', strict: true },
    })
  })

  it('retries one transient failure and then stops', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) })
    await expect(enhanceReportWithOpenRouter({ apiKey: 'test', evidence, fetchImpl, timeoutMs: 100 })).rejects.toThrow('rate limited')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('preserves the actual model and raw response when the hard gate rejects a decision', async () => {
    const invalidDecision = { ...decision, editorNote: 'BRL은 상승했습니다.' }
    const raw = JSON.stringify(invalidDecision)
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'example/rejected-free-model:free', choices: [{ message: { content: raw } }] }),
    })
    await expect(enhanceReportWithOpenRouter({ apiKey: 'test', evidence, fetchImpl, timeoutMs: 100 })).rejects.toMatchObject({
      model: 'example/rejected-free-model:free',
      raw,
      validation: { valid: false },
    })
  })

  it('rejects a valid but low-value repetitive selection at the quality gate', async () => {
    const repetitive = {
      ...decision,
      keyMoves: [decision.keyMoves[0], decision.keyMoves[0]],
      scenarioTags: ['direction_persistence'],
    }
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'example/low-quality:free', choices: [{ message: { content: JSON.stringify(repetitive) } }] }),
    })
    await expect(enhanceReportWithOpenRouter({ apiKey: 'test', evidence, fetchImpl, timeoutMs: 100 })).rejects.toMatchObject({
      validation: { valid: false, errors: ['quality_score'] },
    })
  })

  it('classifies malformed structured output without retrying', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'example/free-model:free', choices: [{ message: { content: '{not-json' } }] }),
    })
    await expect(enhanceReportWithOpenRouter({ apiKey: 'test', evidence, fetchImpl, timeoutMs: 100 })).rejects.toMatchObject({
      model: 'example/free-model:free',
      raw: '{not-json',
      validation: { valid: false, errors: ['invalid_json'] },
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
