import type {ExchangeRateDataset,HanaComparisonQuote} from '../src/types/exchangeRate'
import {fetchHanaRates} from './hana-rates'
import {hanaComparison} from '../src/lib/hana-comparison'
export {HANA_EFFECTIVE_FROM} from '../src/lib/hana-comparison'

// Only publicly released report dates are needed. Pagination must finish before collection.
export async function publishedHanaComparisonDates(url:string,key:string,fetchImpl=fetch) {
 const dates=new Set<string>()
 for(let offset=0;;){
  const target=new URL('/rest/v1/currency_reports',url)
  target.search=new URLSearchParams({select:'date:report->>observedDate',currency:'in.(BRL,MXN,CLP,COP,PEN,ARS)',withdrawn_at:'is.null',order:'currency,base_date',offset:String(offset),limit:'1000'}).toString()
  const r=await fetchImpl(target,{headers:{apikey:key,Authorization:`Bearer ${key}`,Prefer:'count=exact'},signal:AbortSignal.timeout(20000)})
  if(!r.ok)throw Error('hana_comparison_history_unavailable')
  const rows=await r.json() as {date:string}[]
  if(!Array.isArray(rows)||rows.some(row=>!/^\d{4}-\d{2}-\d{2}$/.test(row.date)))throw Error('hana_comparison_history_invalid')
  for(const row of rows)dates.add(row.date)
  offset+=rows.length
  const total=r.headers.get('content-range')?.match(/\/(\d+)$/)?.[1]
  if(!rows.length||total!==undefined&&offset>=Number(total))break
 }
 return [...dates].sort()
}

export async function prepareHanaTransition(previous:ExchangeRateDataset,dates:string[],effectiveFrom:string,
 collect=fetchHanaRates,now=()=>new Date().toISOString()) {
 if(previous.hanaTransition&&previous.hanaTransition.effectiveFrom!==effectiveFrom)throw Error('hana_cutover_date_changed')
 const quotes:HanaComparisonQuote[]=structuredClone(previous.hanaTransition?.quotes??[])
 for(const requestedDate of [...new Set(dates)].sort()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)||new Date(requestedDate).toISOString().slice(0,10)!==requestedDate)throw Error('hana_comparison_date_invalid')
  const probe={hanaTransition:{version:'hana-transition/1' as const,effectiveFrom,quotes},fetchedAt:now()}
  if(['BRL','MXN','CLP','COP','PEN','ARS'].every(currency=>hanaComparison(probe,currency as HanaComparisonQuote['currency'],requestedDate)))continue
  const fresh=await collect(requestedDate)
  for(const q of fresh){
   if(quotes.some(prior=>prior.requestedDate===requestedDate&&prior.currency===q.currency))throw Error('hana_comparison_cache_invalid')
   quotes.push({...q,requestedDate})
  }
  const complete={hanaTransition:{version:'hana-transition/1' as const,effectiveFrom,quotes},fetchedAt:now()}
  if(!['BRL','MXN','CLP','COP','PEN','ARS'].every(currency=>hanaComparison(complete,currency as HanaComparisonQuote['currency'],requestedDate)))throw Error('hana_comparison_incomplete')
 }
 const transition={version:'hana-transition/1' as const,effectiveFrom,quotes}
 for(const q of quotes)if(!hanaComparison({hanaTransition:transition,fetchedAt:now()},q.currency,q.requestedDate))throw Error('hana_comparison_quote_invalid')
 return transition
}
