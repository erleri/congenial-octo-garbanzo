import type { ReportCurrency, ReportHistoryQuery, ReportPeriod } from '../types/currencyReport'
import { REPORT_CURRENCIES } from './currencyReportAccess'
export const PUBLIC_REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
export function validReportDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(value + 'T00:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value
}
export function validReportPeriod(p: ReportPeriod) {
  return (p.year === undefined || Number.isInteger(p.year) && p.year >= 1900 && p.year <= 9999) &&
    (p.month === undefined || p.year !== undefined && Number.isInteger(p.month) && p.month >= 1 && p.month <= 12)
}
export function periodBounds(p: ReportPeriod) {
  if (!validReportPeriod(p)) throw Error('invalid_period')
  const start = p.year === undefined ? null : `${p.year}-${String(p.month ?? 1).padStart(2,'0')}-01`
  const end = p.year === undefined ? null : p.month === undefined ? `${p.year}-12-31` :
    `${p.year}-${String(p.month).padStart(2,'0')}-${new Date(Date.UTC(p.year,p.month,0)).getUTCDate()}`
  return { start,end }
}
export function reportHistoryHash(currency: ReportCurrency, p: ReportPeriod = {}, includeTest = false) {
  const params = new URLSearchParams()
  if (p.year !== undefined) params.set('year',String(p.year))
  if (p.month !== undefined) params.set('month',String(p.month))
  if (includeTest) params.set('test','1')
  return `#report/${currency}/history${params.size?'?'+params:''}`
}
export function historyRoute(hash: string) {
  const [path,search=''] = hash.split('?')
  const m = /^#report\/(BRL|MXN|CLP|COP|PEN|ARS)\/history$/.exec(path)
  if (!m || hash.split('?').length > 2) return null
  const p = new URLSearchParams(search)
  if ([...p.keys()].some(k=>!['year','month','test'].includes(k)||p.getAll(k).length!==1)) return null
  if (p.has('year') && !/^\d{4}$/.test(p.get('year')!) || p.has('month') && !/^\d{1,2}$/.test(p.get('month')!) || p.has('test') && p.get('test')!=='1') return null
  const result: ReportHistoryQuery = {currency:m[1] as ReportCurrency,year:p.has('year')?Number(p.get('year')):undefined,month:p.has('month')?Number(p.get('month')):undefined,includeTest:p.get('test')==='1'}
  return validReportPeriod(result) ? result : null
}
export function cursorKey(q: ReportHistoryQuery) { return [q.currency,q.year??'',q.month??'',q.includeTest?'test':'public'].join(':') }
export function encodeReportCursor(q: ReportHistoryQuery, date: string) { return `${cursorKey(q)}|${date}` }
export function decodeReportCursor(q: ReportHistoryQuery) {
  if (!REPORT_CURRENCIES.includes(q.currency) || !validReportPeriod(q)) throw Error('invalid_query')
  if (!q.cursor) return null
  const [key,date,...extra] = q.cursor.split('|'), {start,end} = periodBounds(q)
  if (extra.length || key!==cursorKey(q) || !validReportDate(date) || start && date<start || end && date>end) throw Error('invalid_cursor')
  return date
}
