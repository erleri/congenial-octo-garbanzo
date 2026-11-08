import type { CurrencyReport, CurrencyReportSummary, ReportCurrency } from '../types/currencyReport'

export const REPORT_CURRENCIES: ReportCurrency[] = ['BRL', 'MXN', 'CLP', 'COP', 'PEN', 'ARS']
export function approvedSummary(item: Pick<CurrencyReportSummary, 'status' | 'comparison' | 'currency'>) {
  return item.status === 'approved' && !item.comparison?.publicationBlocked &&
    !item.comparison?.referenceOnly && !item.comparison?.rulesReviewOnly &&
    REPORT_CURRENCIES.includes(item.currency)
}
export function approvedReport(report: CurrencyReport) {
  return approvedSummary(report) && report.schemaVersion === 'currency-report/1' &&
    typeof report.publishedAt === 'string' && Number.isFinite(Date.parse(report.publishedAt))
}
export function reportRoute(hash: string) {
  const match = /^#report(?:\/(BRL|MXN|CLP|COP|PEN|ARS)(?:\/(\d{4}-\d{2}-\d{2}))?)?$/.exec(hash)
  if(!match)return null
  if(match[2]){const value=new Date(match[2]+'T00:00:00Z');if(!Number.isFinite(value.getTime())||value.toISOString().slice(0,10)!==match[2])return null}
  return { currency: match[1] as ReportCurrency | undefined, date: match[2] }
}
export function approvedHistory(items: CurrencyReportSummary[], currency: ReportCurrency) {
  const candidates = items.filter(i => approvedSummary(i) && i.currency === currency)
  // Preserve fixtures in storage, but never let their future dates displace real reports.
  const sorted = candidates.filter(i => !candidates.some(x => !x.testOnly) || !i.testOnly)
    .sort((a, b) => b.baseDate.localeCompare(a.baseDate) || b.id.localeCompare(a.id))
  return sorted.filter((i, n) => sorted.findIndex(x => x.baseDate === i.baseDate) === n).slice(0, 30)
}
export function approvedSelection(items: CurrencyReportSummary[], hash: string, run?: string | null) {
  const route = reportRoute(hash)
  if (!route?.currency) return undefined
  const history = approvedHistory(items, route.currency)
  // Explicit invalid/private runs never fall back to a different public report.
  if (run) return history.find(i => i.id === run && (!route.date || i.baseDate === route.date))
  return history.find(i => !route.date || i.baseDate === route.date)
}
export function reportLink(currency: string, date?: string) {
  return `#report/${currency}${date ? `/${date}` : ''}`
}
