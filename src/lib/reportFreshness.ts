import { approvedSummary } from './currencyReportAccess'
import type { CurrencyReportSummary } from '../types/currencyReport'

export function seoulDay(time: number) {
  return new Date(time + 9*60*60*1000).toISOString().slice(0,10)
}
export function reportBadge(item: CurrencyReportSummary | undefined, now: number, verified: boolean): '새 리포트' | '정정' | null {
  if (!item || !verified || !approvedSummary(item) || item.testOnly) return null
  if (item.revisionKind === 'correction') return '정정'
  if (item.historicalReview || item.comparison?.editorialRevision || item.comparison?.citationRevision) return null
  const stamp = item.publishedAt
  // Require an actual timestamp with timezone, never a date-only report/evidence date.
  if (!stamp || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(stamp)) return null
  const published = Date.parse(stamp)
  if (!Number.isFinite(published) || published > now || !Number.isFinite(now)) return null
  return seoulDay(published) === seoulDay(now) ? '새 리포트' : null
}
