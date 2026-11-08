import type { CurrencyReportSummary } from '../types/currencyReport'
import { REPORT_CURRENCIES } from '../lib/currencyReportAccess'

/** One entry per issuance date; later local attempts do not duplicate the history menu. */
export function historyFor(items: CurrencyReportSummary[], currency: string) {
  const sorted = items.filter(i => i.currency === currency && i.status !== 'rejected' && !i.comparison?.referenceOnly && !i.comparison?.rulesReviewOnly).sort((a, b) => b.baseDate.localeCompare(a.baseDate) || Number(!!b.comparison?.preferred) - Number(!!a.comparison?.preferred) || b.id.localeCompare(a.id))
  return sorted.filter((i, n) => sorted.findIndex(x => x.baseDate === i.baseDate) === n).slice(0, 30)
}
export function selectReport(items: CurrencyReportSummary[], currency: string, date?: string, run?: string | null) {
  if (run) return items.find(i => i.id === run && i.currency === currency && (!date || i.baseDate === date))
  return historyFor(items, currency).find(i => !date || i.baseDate === date)
}
export function latestReports(items: CurrencyReportSummary[]) {
  return REPORT_CURRENCIES.flatMap(c => historyFor(items, c).slice(0, 1))
}
export function setLocalQuery(key: 'design' | 'mode', value: string) {
  const url = new URL(location.href)
  url.searchParams.set(key, value)
  if (key === 'mode') url.searchParams.delete('run')
  history.replaceState(null, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
