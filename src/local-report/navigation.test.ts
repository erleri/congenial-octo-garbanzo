import { describe, it, expect } from 'vitest'
import { historyFor, selectReport, latestReports } from './navigation'
import type { CurrencyReportSummary } from '../types/currencyReport'
const item = (id: string, status: CurrencyReportSummary['status'], preferred: boolean): CurrencyReportSummary => ({ id, currency: 'CLP', baseDate: '2026-09-11', observedDate: '2026-09-11', generationMode: 'ai_enhanced', status, title: id, summary: '', comparison: { label: id, model: 'model', inputHash: 'hash', preferred, costUsd: null, average: 4, provisional: true, publicationBlocked: true } })
const rows = [item('CLP-2026-09-11-1', 'pending_review', true), item('CLP-2026-09-11-2', 'rejected', false)]
describe('explicit local comparison run selection', () => {
  it('retains the previous report when a newer common-rule draft has no content approval', () => {
    const draft = item('CLP-2026-09-12-99', 'pending_review', true)
    draft.baseDate = '2026-09-12'; draft.comparison!.rulesReviewOnly = true
    expect(historyFor([...rows, draft], 'CLP')).toEqual([rows[0]])
    expect(selectReport([draft], 'CLP', draft.baseDate, draft.id)).toEqual(draft)
  })
  it('defaults to the preferred qualified report, not the newest rejected attempt', () => expect(historyFor(rows, 'CLP').map(r => r.id)).toEqual([rows[0].id]))
  it('allows a rejected draft only as an explicit matching run', () => expect(selectReport(rows, 'CLP', '2026-09-11', rows[1].id)).toEqual(rows[1]))
  it('never substitutes a different currency, date or unknown run', () => {
    expect(selectReport(rows, 'BRL', '2026-09-11', rows[0].id)).toBeUndefined()
    expect(selectReport(rows, 'CLP', '2026-09-10', rows[0].id)).toBeUndefined()
    expect(selectReport(rows, 'CLP', '2026-09-11', 'unknown')).toBeUndefined()
  })
  it('does not expose rejected-only dates in normal history', () => expect(historyFor([rows[1]], 'CLP')).toEqual([]))
  it('shows an authored reference only by explicit run, never as latest or history', () => {
    const reference = item('CLP-2026-09-11-3', 'sample', true)
    reference.comparison!.referenceOnly = true
    expect(historyFor([reference], 'CLP')).toEqual([])
    expect(historyFor([...rows, reference], 'CLP')).toEqual([rows[0]])
    expect(selectReport([reference], 'CLP', '2026-09-11', reference.id)).toEqual(reference)
  })
})

describe('issuance-date navigation', () => {
  const item = (date: string, attempt: number, currency: 'BRL' | 'MXN' | 'CLP' = 'BRL') => ({ id: `${currency}-${date}-${attempt}`, currency, baseDate: date }) as CurrencyReportSummary
  it('keeps thirty distinct dates even with multiple attempts on one date', () => {
    const items = Array.from({ length: 31 }, (_, n) => item(`2025-05-${String(n + 1).padStart(2, '0')}`, 1))
    items.push(item('2025-05-31', 2))
    const history = historyFor(items, 'BRL')
    expect(history).toHaveLength(30); expect(history[0].id).toContain('-2'); expect(history[29].baseDate).toBe('2025-05-02')
  })
  it('lists only the latest report per currency', () => {
    const items = [item('2025-05-01', 1), item('2025-05-02', 1), item('2025-05-01', 1, 'MXN'), item('2026-09-11', 1, 'CLP')]
    expect(latestReports(items).map(i => i.baseDate)).toEqual(['2025-05-02', '2025-05-01', '2026-09-11'])
  })
})
