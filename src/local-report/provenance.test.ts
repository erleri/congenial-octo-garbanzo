import { expect, it } from 'vitest'
import { comparisonIncludesRun, isHistoricalComparison } from './provenance'
import type { CurrencyReportSummary } from '../types/currencyReport'

it('labels legacy comparisons as historical but never labels an explicit current-date draft as a past case', () => {
  const comparison: NonNullable<CurrencyReportSummary['comparison']> = {
    inputHash: 'synthetic', label: 'test', model: 'model', costUsd: null, average: null,
    preferred: false, provisional: true, publicationBlocked: true,
  }
  expect(isHistoricalComparison({ comparison })).toBe(true)
  expect(isHistoricalComparison({ comparison: { ...comparison, historicalReview: false } })).toBe(false)
  expect(isHistoricalComparison({})).toBe(false)
})

it('only shows a comparison manifest for its own explicit report run', () => {
  const rows = [{ reportId: 'CLP-2026-09-11-1' }, { reportId: 'CLP-2026-09-11-2' }, {}]
  expect(comparisonIncludesRun(rows, 'CLP-2026-09-11-2')).toBe(true)
  expect(comparisonIncludesRun(rows, 'CLP-2026-10-05-3')).toBe(false)
  expect(comparisonIncludesRun(rows)).toBe(false)
  expect(comparisonIncludesRun([], 'CLP-2026-09-11-1')).toBe(false)
})
