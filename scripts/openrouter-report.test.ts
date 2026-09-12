import { describe, expect, it, vi } from 'vitest'
import { enhanceReportWithOpenRouter } from './openrouter-report.js'

const evidence = {
  baseDate: '2026-09-11',
  confidence: 'medium',
  facts: [{ id: 'fact-brl-day', currency: 'BRL', horizon: 'day', label: 'BRL 일간 변동' }],
  news: [{ id: 'news-1', title: 'Brazil market update', source: 'Example', publishedAt: null, currencies: ['BRL'], summary: 'Brazil market context.' }],
  metrics: [{ currency: 'BRL' }],
}

const candidate = {
  headline: '중남미 통화 흐름은 혼조로 관찰됩니다.',
  executiveSummary: ['주요 통화의 방향성이 엇갈렸습니다.'],
  keyMoves: [{ currency: 'BRL', text: '헤알 움직임을 우선 확인합니다.', factIds: ['fact-brl-day'], evidenceIds: ['news-1'] }],
  planObservations: [],
  scenarios: ['다음 영업일에도 방향성과 변동성 범위를 함께 확인합니다.'],
  confidence: 'medium',
  limitations: ['뉴스는 가능한 배경으로만 해석했습니다.'],
}

describe('OpenRouter FX report enhancement', () => {
  it('uses strict structured output and records the selected free model', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'example/free-model:free', choices: [{ message: { content: JSON.stringify(candidate) } }] }),
    })
    const result = await enhanceReportWithOpenRouter({ apiKey: 'test', evidence, fetchImpl, timeoutMs: 100 })
    expect(result.model).toBe('example/free-model:free')
    const request = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(request.model).toBe('openrouter/free')
    expect(request.provider).toMatchObject({ require_parameters: true, data_collection: 'deny', zdr: true })
    expect(request.response_format.type).toBe('json_schema')
  })

  it('retries one transient failure and then stops', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) })
    await expect(enhanceReportWithOpenRouter({ apiKey: 'test', evidence, fetchImpl, timeoutMs: 100 })).rejects.toThrow('rate limited')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('preserves the actual model and raw response when validation rejects a candidate', async () => {
    const invalidCandidate = { ...candidate, headline: 'BRL은 상승했습니다.' }
    const raw = JSON.stringify(invalidCandidate)
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
