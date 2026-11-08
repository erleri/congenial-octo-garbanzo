import {describe,it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {retainDashboardReferences,validateReferenceArchive} from './dashboard-reference-archive'
import {buildDatasetFiles} from './dataset-files'
import {readDashboardPriceLineage} from './currency-report/shared-price-contract.js'
import type {DailyRate,ExchangeRateDataset,FxPriceSource} from '../src/types/exchangeRate'

// Synthetic vendor editions test storage/calculation contracts, not actual rates.
const currencies=['BRL','MXN','COP','PEN','CLP','ARS','USD'] as const
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex')
const point=(day:string,currency:DailyRate['currency'],rateType:DailyRate['rateType'],value:number):DailyRate=>{
 const [year,month,date]=day.split('-').map(Number)
 return {date:day,year,month,day:date,currency,rateType,value,status:'ok',source:'API',imputationMethod:'NONE'}
}
const source=(provider:'exchange_rate_api'|'frankfurter_v1',day:string):FxPriceSource=>({provider,
 endpoint:provider==='exchange_rate_api'?'https://v6.exchangerate-api.com/v6':'https://api.frankfurter.dev/v1',capturedAt:day+'T02:00:00Z',
 responseSha256:sha({provider,day}),digestMeaning:'parsed_json',providerUpdatedAt:null,providerTimestampLocal:null,providerDate:day,
 dateMeaning:provider==='exchange_rate_api'?'utc_update_date':'provider_series_date',priceKind:'conversion_reference',providerTimeZone:null,
 observedAt:null,localSessionDate:null,origin:'response',transport:'direct'})
function dataset(baseDate:string,days:Record<string,number>,withSources=true):ExchangeRateDataset{
 const dailyRates=Object.entries(days).flatMap(([day,value])=>currencies.flatMap(currency=>{
  const v=currency==='USD'?1:value
  return [point(day,currency,'LOCAL_PER_USD',v),point(day,currency,'KRW',1500/v)]
 }))
 const book={version:'fx-price-provenance/1' as const,sources:{},quotesByDate:{},selectionAudit:{}}
 for(const [i,day] of Object.keys(days).entries()){
  const id='s'+i;book.sources[id]=source(day===baseDate?'exchange_rate_api':'frankfurter_v1',day)
  book.quotesByDate[day]=Object.fromEntries(currencies.map(c=>[c,{sourceId:id,value:days[day]*(c==='USD'?0:1)+(c==='USD'?1:0)}]))
 }
 return {baseDate,fetchedAt:baseDate+'T03:00:00Z',dailyRates,monthlyRates:[],movingComparison:[],...(withSources?{priceProvenance:book}:{})}
}
const value=(data:ExchangeRateDataset,day:string,currency='BRL',type='LOCAL_PER_USD')=>data.dailyRates.find(r=>r.date===day&&r.currency===currency&&r.rateType===type)?.value

describe('adopted dashboard reference archive',()=>{
 it('keeps an adopted current-day quote and its exact original provider when that date becomes a different vendors historical series',()=>{
  const old=dataset('2026-11-02',{'2026-11-02':5}),fresh=dataset('2026-11-03',{'2026-11-02':5.1,'2026-11-03':5.2})
  const before=[structuredClone(old),structuredClone(fresh)]
  const result=retainDashboardReferences(fresh,old,'2026-11-03T04:00:00Z')
  expect(value(result.dataset,'2026-11-02')).toBe(5)
  expect(value(result.dataset,'2026-11-02','BRL','KRW')).toBe(300)
  expect(value(result.dataset,'2026-11-03')).toBe(5.2)
  expect(readDashboardPriceLineage(result.dataset,result.dataset.dailyRates.find(r=>r.date==='2026-11-02'&&r.currency==='BRL'&&r.rateType==='LOCAL_PER_USD')).provider).toBe('exchange_rate_api')
  expect(result.dataset.referenceArchive!.revisionOffers).toContainEqual(expect.objectContaining({date:'2026-11-02',currency:'BRL',selectedValue:5,offeredValue:5.1}))
  expect(result.dataset.monthlyRates.find(r=>r.currency==='BRL'&&r.year===2026&&r.month===11&&r.rateType==='LOCAL_PER_USD')?.value).toBeCloseTo(5.1)
  expect([old,fresh]).toEqual(before)
  expect(result.review.numericCorrectionsApplied).toBe(0)
 })
 it('does not replace a fixed same-day value on rerun, and deduplicates an identical revision offer rather than growing per fetch timestamp',()=>{
  const old=dataset('2026-11-02',{'2026-11-02':5})
  const first=retainDashboardReferences(dataset('2026-11-03',{'2026-11-02':5.1,'2026-11-03':5.2}),old,'2026-11-03T04:00:00Z').dataset
  const changed=dataset('2026-11-03',{'2026-11-02':5.1,'2026-11-03':5.3})
  const second=retainDashboardReferences(changed,first,'2026-11-03T05:00:00Z')
  const third=retainDashboardReferences(changed,second.dataset,'2026-11-03T06:00:00Z')
  expect(value(second.dataset,'2026-11-03')).toBe(5.2)
  expect(second.review.newRevisionOffers).toBeGreaterThan(0)
  expect(third.review.newRevisionOffers).toBe(0)
  expect(third.dataset.referenceArchive).toEqual(second.dataset.referenceArchive)
 })
 it('traces and reapplies existing weekend carry-forward without claiming an observed holiday quote',()=>{
  const old=dataset('2026-11-06',{'2026-11-06':5}),incoming=dataset('2026-11-07',{'2026-11-06':5.1,'2026-11-07':5.1})
  incoming.dailyRates=incoming.dailyRates.map(r=>r.date==='2026-11-07'?{...r,source:'IMPUTED',imputationMethod:'FFILL'}:r)
  const result=retainDashboardReferences(incoming,old,'2026-11-07T04:00:00Z')
  expect(result.dataset.dailyRates.find(r=>r.date==='2026-11-07'&&r.currency==='BRL'&&r.rateType==='LOCAL_PER_USD')).toMatchObject({value:5,source:'IMPUTED',imputationMethod:'FFILL'})
  expect(result.dataset.referenceArchive!.entries.some(e=>e.date==='2026-11-07')).toBe(false)
  expect(result.review.sourceDatesAreLocalCloses).toBe(false)
 })
 it('bootstraps only the previously selected stored date and preserves unknown provenance instead of borrowing a convenient new provider label',()=>{
  const old=dataset('2026-11-02',{'2026-10-30':4.9,'2026-11-02':5},false)
  const result=retainDashboardReferences(dataset('2026-11-03',{'2026-10-30':4.8,'2026-11-02':5.1,'2026-11-03':5.2}),old,'2026-11-03T04:00:00Z')
  expect(value(result.dataset,'2026-10-30')).toBe(4.8)
  expect(value(result.dataset,'2026-11-02')).toBe(5)
  const selected=result.dataset.dailyRates.find(r=>r.date==='2026-11-02'&&r.currency==='BRL'&&r.rateType==='LOCAL_PER_USD')
  expect(readDashboardPriceLineage(result.dataset,selected)).toMatchObject({status:'unverified',provider:null})
  expect(result.review.unknownSourceSelections).toBeGreaterThan(0)
 })
 it('refuses a corrupted archive, a missing adopted row, duplicate keys, a partial prior dataset and a backwards generation',()=>{
  const old=dataset('2026-11-02',{'2026-11-02':5})
  const stored=retainDashboardReferences(dataset('2026-11-03',{'2026-11-02':5.1,'2026-11-03':5.2}),old,'2026-11-03T04:00:00Z').dataset
  const bad=structuredClone(stored);bad.referenceArchive!.digest='0'.repeat(64)
  expect(()=>retainDashboardReferences(stored,bad,'2026-11-03T05:00:00Z')).toThrow('integrity')
  const missing=structuredClone(stored);missing.dailyRates=missing.dailyRates.filter(r=>!(r.date==='2026-11-02'&&r.currency==='BRL'))
  expect(()=>validateReferenceArchive(missing)).toThrow('saved_reference_selection_changed')
  expect(()=>retainDashboardReferences({...stored,dailyRates:[...stored.dailyRates,stored.dailyRates[0]]},stored,'2026-11-03T05:00:00Z')).toThrow('duplicate')
  const partial=buildDatasetFiles(stored).staticFallback
  expect(()=>retainDashboardReferences(stored,partial,'2026-11-03T05:00:00Z')).toThrow('full_previous')
  const erased=buildDatasetFiles(stored).fullDataset;delete erased.referenceArchive
  expect(()=>retainDashboardReferences(stored,erased,'2026-11-03T05:00:00Z')).toThrow('dataset_version_mismatch')
  expect(()=>retainDashboardReferences(old,stored,'2026-11-03T05:00:00Z')).toThrow('clock_or_date')
 })
 it('keeps the journal in the full dataset and sends only retained prices/provenance in the bounded browser fallback',()=>{
  const old=dataset('2025-01-01',{'2025-01-01':5})
  const stored=retainDashboardReferences(dataset('2026-11-03',{'2025-01-01':5.1,'2026-11-03':5.2}),old,'2026-11-03T04:00:00Z').dataset
  const {fullDataset,staticFallback}=buildDatasetFiles(stored)
  expect(fullDataset.referenceArchive!.entries.some(e=>e.date==='2025-01-01')).toBe(true)
  expect(staticFallback.referenceArchive).toBeUndefined()
  expect(staticFallback.priceProvenance?.quotesByDate['2025-01-01']).toBeUndefined()
  expect(staticFallback.priceProvenance?.quotesByDate['2026-11-03']).toBeDefined()
  expect(()=>validateReferenceArchive(staticFallback)).not.toThrow()
  expect(value(staticFallback,'2026-11-03')).toBe(value(fullDataset,'2026-11-03'))
 })
 it('derives a newly recovered KRW cell from the retained local quote without changing already fixed conversion values',()=>{
  const old=dataset('2026-11-02',{'2026-11-02':5});old.dailyRates=old.dailyRates.filter(r=>!(r.currency==='BRL'&&r.rateType==='KRW'))
  const fresh=dataset('2026-11-03',{'2026-11-02':6,'2026-11-03':7})
  const result=retainDashboardReferences(fresh,old,'2026-11-03T04:00:00Z')
  expect(value(result.dataset,'2026-11-02','BRL','KRW')).toBe(300)
 })
})
