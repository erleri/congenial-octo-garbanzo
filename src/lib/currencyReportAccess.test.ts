import { describe, expect, it } from 'vitest'
import { approvedReport, approvedSelection, approvedSummary, approvedHistory, reportRoute } from './currencyReportAccess'
import type { CurrencyReport, CurrencyReportSummary } from '../types/currencyReport'

const item = (id: string, date: string, status: CurrencyReportSummary['status'] = 'approved'): CurrencyReportSummary => ({
  id, baseDate: date, observedDate: date, currency: 'CLP', status, generationMode: 'ai_enhanced', title: id, summary: id,
})
describe('product approved-report boundary and routes', () => {
  it('does not let future synthetic fixtures displace a real approved report', () => {
    const fixture = { ...item('fixture', '2098-12-30'), testOnly: true }
    expect(approvedHistory([fixture], 'CLP').map(r => r.id)).toEqual(['fixture'])
    const rows = [fixture, item('real', '2026-10-09')]
    expect(approvedSelection(rows, '#report/CLP')?.id).toBe('real')
    expect(approvedSelection(rows, '#report/CLP', 'fixture')).toBeUndefined()
    expect(rows).toHaveLength(2)
  })
  it('never selects a private, rejected, blocked, wrong-date or wrong-currency run', () => {
    const rows = [item('published', '2026-10-09'), item('draft', '2026-10-10', 'pending_review'), item('rejected', '2026-10-11', 'rejected')]
    expect(approvedSelection(rows, '#report/CLP')?.id).toBe('published')
    for (const run of ['draft', 'rejected', 'unknown']) expect(approvedSelection(rows, '#report/CLP', run)).toBeUndefined()
    expect(approvedSelection(rows, '#report/CLP/2026-10-08', 'published')).toBeUndefined()
    expect(approvedSelection(rows, '#report/BRL', 'published')).toBeUndefined()
    expect(approvedSummary({ ...rows[0], comparison: { publicationBlocked: true } as CurrencyReportSummary['comparison'] })).toBe(false)
    expect(approvedReport({ ...rows[0], schemaVersion: 'currency-report/1', publishedAt: null } as unknown as CurrencyReport)).toBe(false)
    expect(approvedReport({ ...rows[0], schemaVersion: 'currency-report/1', publishedAt: '2026-10-12T00:00:00Z' } as unknown as CurrencyReport)).toBe(true)
  })
  it('keeps 30 distinct issuance dates and handles direct/invalid routes explicitly', () => {
    const rows = Array.from({ length: 31 }, (_, i) => item(String(i), `2026-10-${String(i + 1).padStart(2, '0')}`))
    expect(approvedHistory([...rows, item('dup', rows[0].baseDate)], 'CLP')).toHaveLength(30)
    expect(reportRoute('#report/CLP/2026-10-09')).toEqual({ currency: 'CLP', date: '2026-10-09' })
    expect(reportRoute('#report')).toEqual({ currency: undefined, date: undefined })
    for (const hash of ['#report/ARP', '#report/CLP/private', '#report/CLP/2026-10-09/extra']) expect(reportRoute(hash)).toBeNull()
  })
})
