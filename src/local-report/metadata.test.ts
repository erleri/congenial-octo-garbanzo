import { describe, expect, it } from 'vitest'
import { reportMetadata, evidenceMetadata } from './metadata'
import type { CurrencyReport, ReportEvidence } from '../types/currencyReport'
import { sourcePublicationTiming } from '../lib/report-source-timing.js'

describe('report reference metadata presentation owner', () => {
  it('labels publication relative to a verified price cutoff without inventing an event time or a close quote', () => {
    const report = { currency: 'CLP', observedDate: '2026-09-10', observationAt: null,
      marketData: { reportPriceBasis: { provider: 'Banco Central de Chile', seriesId: 'F073.TCO.PRE.Z.D',
        dateBasis: 'underlying_local_transaction_day', priceKind: 'official_transaction_weighted_average', timeZone: 'America/Santiago',
        observations: [{ localSessionDate: '2026-09-10', observationWindow: { endAt: '2026-09-10T19:00:00Z' } }] } } } as unknown as CurrencyReport
    const e = { id: 'news-yahoo', publishedAt: '2026-09-10T21:04:00Z' } as ReportEvidence
    expect(evidenceMetadata(e, report).sourceTiming).toEqual({ relation: 'published_after_reference', referenceKind: 'aggregation_cutoff',
      referenceAt: '2026-09-10T19:00:00Z', label: '환율 집계 이후 발행' })
    expect(sourcePublicationTiming({ ...e, publishedAt: '2026-09-10T19:00:00Z' }, report)?.relation).toBe('published_by_reference')
    expect(sourcePublicationTiming({ ...e, publishedAt: '2026-09-10' }, report)).toBeNull()
    expect(sourcePublicationTiming(e, { ...report, observedDate: '2026-09-09' })).toBeNull()
    expect(sourcePublicationTiming(e, { observationAt: null })).toBeNull()
    expect(sourcePublicationTiming(e, { currency: 'BRL', observationAt: '2026-09-10T18:00:00Z' })?.referenceKind).toBe('price_observation')
  })
  it('keeps a legacy collection timestamp distinct from unknown observation and source', () => {
    const r = { currency: 'CLP', observedDate: '2026-10-05', comparison: { datasetFetchedAt: '2026-10-05T05:44:59.792Z' } } as CurrencyReport
    expect(reportMetadata(r)).toEqual({ observedDate: '2026-10-05', observationAt: null, fetchedAt: '2026-10-05T05:44:59.792Z', source: '제공 경로 미기록', unit: 'CLP / 1 USD' })
    r.marketData = { fetchedAt: null, source: 'API', rateType: 'LOCAL_PER_USD' }
    expect(reportMetadata(r).source).toBe('API 수집값')
    r.observationAt = '2026-10-05'
    expect(reportMetadata(r).observationAt).toBeNull()
  })
  it('labels market reporting separately from official material and undated general principles', () => {
    const e = { id: 'df-close', provenance: 'market_reporting', publishedAt: '2026-10-05', period: '기사 판 마감' } as ReportEvidence
    expect(evidenceMetadata(e)).toEqual({ source: '시장 보도', publishedAt: '2026-10-05', period: '기사 판 마감' })
    expect(evidenceMetadata({ ...e, provenance: 'official' }).source).toBe('공식 자료')
    expect(evidenceMetadata({ ...e, provenance: undefined }).source).toBe('출처 유형 미기록')
    expect(evidenceMetadata({ ...e, id: 'principle-usd-payment-conversion', publishedAt: '', period: '일반 원리 — 당일 사건 아님' })).toEqual({ source: '일반 원리', publishedAt: '미제공', period: '일반 원리 — 당일 사건 아님' })
  })
})
