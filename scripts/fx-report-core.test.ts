import { describe, expect, it } from 'vitest'
import {
  buildDeterministicReport,
  buildFxReportEvidence,
  normalizeNewsEvidence,
  validateAiReport,
} from './fx-report-core.js'

function dataset() {
  const currencies = ['BRL', 'MXN', 'CLP', 'COP', 'ARS', 'PEN', 'GTQ', 'PYG', 'UYU', 'CNY', 'USD']
  const dailyRates = []
  const start = new Date('2025-08-01T00:00:00Z')
  for (let day = 0; day < 407; day += 1) {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + day)
    const iso = date.toISOString().slice(0, 10)
    for (const [index, currency] of currencies.entries()) {
      const isUsd = currency === 'USD'
      const value = isUsd ? 1 : 5 + index + day * 0.002
      dailyRates.push({ currency, rateType: 'LOCAL_PER_USD', date: iso, value })
      if (isUsd) dailyRates.push({ currency: 'USD', rateType: 'KRW', date: iso, value: 1300 + day * 0.1 })
    }
  }
  // Make CNY an anomaly on the final observation.
  dailyRates.findLast((row) => row.currency === 'CNY' && row.rateType === 'LOCAL_PER_USD').value *= 1.08
  return { baseDate: '2026-09-11', fetchedAt: '2026-09-11T00:00:00Z', dailyRates, monthlyRates: [], movingComparison: [] }
}

const articles = [{
  title: '<b>Brazil market update</b>\u0000',
  summary: 'Brazil and the Federal Reserve were discussed.',
  source: 'Example News',
  url: 'https://example.com/fx',
  time_published: '20260911T010203',
}]

describe('FX report evidence', () => {
  it('calculates required horizons, plan deltas, USD/KRW, and anomaly currencies', () => {
    const evidence = buildFxReportEvidence(dataset(), { leading: { BRL: 5 }, moving: { BRL: 5 } }, articles)
    const brl = evidence.metrics.find((row) => row.currency === 'BRL')
    expect(brl?.dayPct).not.toBeNull()
    expect(brl?.fiveDayPct).not.toBeNull()
    expect(brl?.mtdPct).not.toBeNull()
    expect(brl?.thirtyDayPct).not.toBeNull()
    expect(brl?.percentile52w).not.toBeNull()
    expect(brl?.movingPlanDeltaPct).not.toBeNull()
    expect(evidence.metrics.some((row) => row.currency === 'USD/KRW')).toBe(true)
    expect(evidence.metrics.some((row) => row.currency === 'CNY')).toBe(true)
  })

  it('sanitizes and deduplicates public news evidence', () => {
    const rows = normalizeNewsEvidence([...articles, ...articles, { title: 'bad', url: 'http://example.com' }])
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('Brazil market update')
    expect(rows[0].currencies).toEqual(expect.arrayContaining(['BRL', 'USD']))
  })

  it('builds a complete deterministic report without news or plan data', () => {
    const evidence = buildFxReportEvidence(dataset())
    const report = buildDeterministicReport(evidence)
    expect(report.executiveSummary).toHaveLength(3)
    expect(report.keyMoves.length).toBeGreaterThan(0)
    expect(report.planObservations[0].text).toContain('생략')
    expect(report.limitations.join(' ')).toContain('전망이나 투자 권고가 아닙니다')
    expect(report.headline).toMatch(/현지통화|USD\/KRW/)
  })

  it('excludes forward-filled weekend rows from previous-observation changes', () => {
    const rows = [
      { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-04', value: 5, source: 'API', imputationMethod: 'NONE' },
      { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-05', value: 5, source: 'IMPUTED', imputationMethod: 'FFILL' },
      { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-06', value: 5, source: 'IMPUTED', imputationMethod: 'FFILL' },
      { currency: 'BRL', rateType: 'LOCAL_PER_USD', date: '2026-09-07', value: 5.5, source: 'API', imputationMethod: 'NONE' },
    ]
    const evidence = buildFxReportEvidence({ baseDate: '2026-09-07', fetchedAt: '', dailyRates: rows })
    expect(evidence.metrics.find((row) => row.currency === 'BRL')?.dayPct).toBe(10)
  })
})

describe('AI report validation', () => {
  const evidence = buildFxReportEvidence(dataset(), {}, articles)
  const validCandidate = {
    headline: '중남미 통화 흐름은 혼조로 관찰됩니다.',
    executiveSummary: ['주요 통화의 방향성이 엇갈렸습니다.'],
    keyMoves: [{ currency: 'BRL', text: '헤알 움직임을 우선 확인합니다.', factIds: ['fact-brl-day'], evidenceIds: ['news-1'] }],
    planObservations: [],
    scenarios: ['다음 영업일에도 방향성과 변동성 범위를 함께 확인합니다.'],
    confidence: 'medium',
    limitations: ['뉴스는 가능한 배경으로만 해석했습니다.'],
  }

  it('accepts grounded qualitative output and rejects numeric or unknown claims', () => {
    expect(validateAiReport(validCandidate, evidence).valid).toBe(true)
    expect(validateAiReport({ ...validCandidate, headline: 'BRL 3% 상승' }, evidence)).toMatchObject({ valid: false })
    const unknown = { ...validCandidate, keyMoves: [{ ...validCandidate.keyMoves[0], factIds: ['fact-made-up'] }] }
    expect(validateAiReport(unknown, evidence).errors).toContain('fact_id')
    const crossCurrency = { ...validCandidate, keyMoves: [{ ...validCandidate.keyMoves[0], factIds: ['fact-mxn-day'] }] }
    expect(validateAiReport(crossCurrency, evidence).errors).toContain('fact_currency')
    const malformed = { ...validCandidate, keyMoves: [{ currency: 'BRL', factIds: [], evidenceIds: [] }] }
    expect(validateAiReport(malformed, evidence).errors).toContain('schema')
  })

})
