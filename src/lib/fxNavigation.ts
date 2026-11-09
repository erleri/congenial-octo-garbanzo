import { CURRENCIES, type CurrencyCode, type CurrencyFilter } from '../types/exchangeRate'

export type FxScreen = 'dashboard' | 'trends' | 'reports' | 'admin' | 'plan'
export type TrendView = 'daily' | 'monthly' | 'comparison'
export interface FxNavigation {
  screen: FxScreen
  view: TrendView
  currency: CurrencyCode
  monthlyCurrency: CurrencyFilter
  from: string
  to: string
  yearFrom: number | null
  yearTo: number | null
}
export const initialFxNavigation: FxNavigation = {
  screen:'dashboard',view:'daily',currency:'BRL',monthlyCurrency:'BRL',from:'',to:'',yearFrom:null,yearTo:null,
}
function isCurrency(value: string | null): value is CurrencyCode { return CURRENCIES.includes(value as CurrencyCode) }
function month(value: string | null) { return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : '' }
function year(value: string | null) { return value && /^(19|20)\d{2}$/.test(value) ? Number(value) : null }

export function parseFxNavigation(hash: string, previous = initialFxNavigation): FxNavigation {
  const [path,query=''] = hash.split('?')
  if (path === '#trends') {
    const p = new URLSearchParams(query)
    return {
      screen:'trends',
      view:p.get('view')==='monthly'?'monthly':p.get('view')==='comparison'?'comparison':'daily',
      currency:isCurrency(p.get('currency'))?p.get('currency') as CurrencyCode:previous.currency,
      monthlyCurrency:p.get('monthly')==='ALL'?'ALL':isCurrency(p.get('monthly'))?p.get('monthly') as CurrencyCode:isCurrency(p.get('currency'))?p.get('currency') as CurrencyCode:previous.monthlyCurrency,
      from:month(p.get('from')),to:month(p.get('to')),yearFrom:year(p.get('yearFrom')),yearTo:year(p.get('yearTo')),
    }
  }
  if (path === '#admin/plan') return {...previous,screen:'plan'}
  if (path === '#admin' || path === '#mailing') return {...previous,screen:'admin'}
  // Let the existing report renderer handle valid/missing/private report IDs.
  if (hash === '#report' || hash.startsWith('#report/')) return {...previous,screen:'reports'}
  return {...previous,screen:'dashboard'}
}
export function trendHash(state: FxNavigation) {
  const p = new URLSearchParams({view:state.view,currency:state.currency,monthly:state.monthlyCurrency})
  if(state.from)p.set('from',state.from)
  if(state.to)p.set('to',state.to)
  if(state.yearFrom!==null)p.set('yearFrom',String(state.yearFrom))
  if(state.yearTo!==null)p.set('yearTo',String(state.yearTo))
  return `#trends?${p}`
}
export function selectTrendCurrency(state: FxNavigation, currency: CurrencyFilter): FxNavigation {
  return currency==='ALL' ? {...state,monthlyCurrency:'ALL'} : {...state,currency,monthlyCurrency:currency}
}
export function safeTrendReturn(value: unknown): string | null {
  return typeof value==='string' && value.startsWith('#trends?') && value.length<=512 ? value : null
}
