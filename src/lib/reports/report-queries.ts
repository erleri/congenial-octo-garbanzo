import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrencyReportSummary, ReportCurrency, ReportHistoryQuery, ReportPage, ReportPeriod, ReportResolution } from '../../types/currencyReport'
import { REPORT_CURRENCIES } from '../currencyReportAccess'
import { decodeReportCursor, encodeReportCursor, periodBounds, PUBLIC_REPORT_ID, validReportDate } from '../reportHistory'

export const CURRENCY_SUMMARY_SELECT='id:public_id,currency,baseDate:base_date,publishedAt:published_at,observedDate:observed_date,generationMode:generation_mode,purpose,historicalReview:historical_review,testOnly:test_only,title,summary,revisionKind:revision_kind,reportKind:report_kind,stateVersion:state_version'
function summaries(rows: unknown): CurrencyReportSummary[] {
  return ((rows ?? []) as CurrencyReportSummary[]).map(r=>({...r,status:'approved',revisionKind:r.revisionKind==='correction'?'correction':undefined}))
}
function baseQuery(client: SupabaseClient,q: ReportHistoryQuery) {
  const {start,end}=periodBounds(q)
  let query=client.from('currency_report_summaries').select(CURRENCY_SUMMARY_SELECT).eq('currency',q.currency)
  if(!q.includeTest)query=query.eq('test_only',false)
  if(start)query=query.gte('base_date',start)
  if(end)query=query.lte('base_date',end)
  return query
}
export async function latestCurrencySummary(client:SupabaseClient,currency:ReportCurrency,signal?:AbortSignal,includeHistorical=false) {
  let query=baseQuery(client,{currency})
  if(!includeHistorical)query=query.or('historical_review.is.null,historical_review.eq.false')
  query=query.order('base_date',{ascending:false}).limit(1)
  if(signal)query=query.abortSignal(signal)
  const result=await query
  if(result.error)throw Error('unavailable')
  return summaries(result.data)[0]??null
}
export async function listPublishedCurrencySummaries(client:SupabaseClient,signal?:AbortSignal):Promise<CurrencyReportSummary[]> {
  const results=await Promise.all(REPORT_CURRENCIES.map(c=>latestCurrencySummary(client,c,signal)))
  return results.filter((r):r is CurrencyReportSummary=>!!r)
}
export async function currencyReportPage(client:SupabaseClient,q:ReportHistoryQuery,signal?:AbortSignal):Promise<ReportPage> {
  const date=decodeReportCursor(q)
  let query=baseQuery(client,q).order('base_date',{ascending:false}).limit(31)
  if(date)query=query.lt('base_date',date)
  if(signal)query=query.abortSignal(signal)
  const result=await query
  if(result.error)throw Error('unavailable')
  const items=summaries(result.data),page=items.slice(0,30)
  return {items:page,nextCursor:items.length>30?encodeReportCursor(q,page.at(-1)!.baseDate):null}
}
export async function currencyReportPeriods(client:SupabaseClient,currency:ReportCurrency,includeTest=false,signal?:AbortSignal) {
  let query=client.rpc('currency_report_periods',{p_currency:currency,p_include_test:includeTest})
  if(signal)query=query.abortSignal(signal)
  const result=await query
  if(result.error)throw Error('unavailable')
  return (result.data as {period:string}[]).map(r=>r.period)
}
export async function resolveCurrencyReport(client:SupabaseClient,currency:ReportCurrency,date?:string,id?:string,includeTest=false,signal?:AbortSignal):Promise<ReportResolution> {
  if(!REPORT_CURRENCIES.includes(currency)||date!==undefined&&!validReportDate(date)||id!==undefined&&!PUBLIC_REPORT_ID.test(id))throw Error('invalid_route')
  let query=client.rpc('resolve_currency_report',{p_currency:currency,p_date:date??null,p_public_id:id??null,p_include_test:includeTest})
  if(signal)query=query.abortSignal(signal)
  const r=await query
  if(r.error)throw Error('unavailable')
  const data=r.data as ReportResolution
  if(!['active','not_found','superseded','withdrawn'].includes(data?.state))throw Error('invalid_state')
  if(data.state!=='not_found'&&(data.currency!==currency||date&&data.baseDate!==date||id&&data.id!==id))throw Error('identity_mismatch')
  if(data.state==='active'&&(!data.report||data.report.id!==data.id||data.report.currency!==currency||data.report.baseDate!==data.baseDate))throw Error('identity_mismatch')
  return data
}
export async function currencyReportNeighbors(client:SupabaseClient,currency:ReportCurrency,date:string,p:ReportPeriod={},includeTest=false,signal?:AbortSignal) {
  if(!validReportDate(date))throw Error('invalid_date')
  const results=await Promise.all([false,true].map(async newer=>{
    let query=baseQuery(client,{currency,...p,includeTest}).order('base_date',{ascending:newer}).limit(1)
    query=newer?query.gt('base_date',date):query.lt('base_date',date)
    const r=await (signal?query.abortSignal(signal):query)
    if(r.error)throw Error('unavailable')
    return summaries(r.data)[0]??null
  }))
  return {older:results[0],newer:results[1]}
}
