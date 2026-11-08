import type { CurrencyReportSummary } from '../../types/currencyReport'

// Missing metadata retains the label of preserved legacy comparisons.
export function isHistoricalComparison(report: Pick<CurrencyReportSummary, 'comparison'> & { historicalReview?: boolean }) {
  return report.historicalReview === true || !!report.comparison && report.comparison.historicalReview !== false
}

// A preserved experiment manifest must not label an unrelated report run.
export function comparisonIncludesRun(rows: { reportId?: string }[], run?: string) {
  return !!run && rows.some(row => row.reportId === run)
}
