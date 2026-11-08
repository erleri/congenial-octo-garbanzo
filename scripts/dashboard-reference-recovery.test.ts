import {describe,it,expect} from 'vitest'
import {createHash} from 'node:crypto'
import {prepareReferenceRecovery,verifyReferenceRecovery,referenceDigest} from './dashboard-reference-recovery'
import {retainDashboardReferences,validateReferenceArchive} from './dashboard-reference-archive'
import {buildDatasetFiles} from './dataset-files'
import type {DailyRate,ExchangeRateDataset,DashboardReferenceRecovery} from '../src/types/exchangeRate'

// Synthetic contracts, distinct from the real six-report recovery evidence.
const at='2026-11-08T04:00:00Z',sha=(raw:string)=>createHash('sha256').update(raw).digest('hex')
const row=(date:string,currency:DailyRate['currency'],rateType:DailyRate['rateType'],value:number):DailyRate=>{
 const [year,month,day]=date.split('-').map(Number);return {date,currency,rateType,value,year,month,day,status:'ok',source:'API',imputationMethod:'NONE'}
}
function data(baseDate='2026-11-02',price=5):ExchangeRateDataset{
 return {baseDate,fetchedAt:baseDate+'T03:00:00Z',monthlyRates:[],movingComparison:[],dailyRates:['2026-11-01','2026-11-02',...(baseDate>'2026-11-02'?[baseDate]:[])].flatMap(day=>
  [row(day,'BRL','LOCAL_PER_USD',day==='2026-11-01'?4:price),row(day,'BRL','KRW',1500/(day==='2026-11-01'?4:price)),row(day,'USD','LOCAL_PER_USD',1),row(day,'USD','KRW',1500)] )}
}
function fixture(){
 const full=buildDatasetFiles(data()).fullDataset,raw=JSON.stringify(full)
 const reports=[{currency:'BRL',resolved:{id:'BRL-synthetic',state:'active',baseDate:full.baseDate,publishedAt:'2026-11-08T02:00:00Z',report:{
  id:'BRL-synthetic',currency:'BRL',baseDate:full.baseDate,observedDate:full.baseDate,marketData:{source:'API',rateType:'LOCAL_PER_USD',fetchedAt:full.fetchedAt},
  facts:[{id:'spot',label:'5 BRL_per_USD',value:5},{id:'previous',label:'4 BRL_per_USD',value:4},{id:'day',label:'+25%',value:25}],
  series:[{date:'2026-11-01',value:4},{date:'2026-11-02',value:5}]}}}]
 return {raw,artifact:{commit:'a'.repeat(40),productionCommit:'b'.repeat(40),path:'data/fx-full-history.json' as const,blob:'c'.repeat(40),sha256:sha(raw)},reports,preparedAt:at}
}
const reseal=(r:DashboardReferenceRecovery)=>{const {id,...body}=r;void id;return {...body,id:referenceDigest(body)}}
describe('evidence-based recovery of adopted references',()=>{
 it('requires an intact full historical dataset, not a report value alone or a bounded browser copy',()=>{
  const input=fixture(),receipt=prepareReferenceRecovery(input)
  expect(receipt.selections[0]).toMatchObject({unit:'BRL_per_USD',matchedChartPoints:2,provider:null,origin:{value:5},conversion:{value:300},conversionBasis:{currency:'USD',value:1500}})
  expect(()=>prepareReferenceRecovery({...input,raw:input.raw+' '})).toThrow('artifact_hash')
  const partial=JSON.stringify(buildDatasetFiles(data()).staticFallback)
  expect(()=>prepareReferenceRecovery({...input,raw:partial,artifact:{...input.artifact,sha256:sha(partial)}})).toThrow('full_dataset')
 })
 it.each(['price','unit','date','clock','previous','change','chart','source','withdrawn'] as const)('rejects the independent public-report mismatch: %s',kind=>{
  const input=fixture(),resolved=input.reports[0].resolved,r=resolved.report
  if(kind==='price')r.facts[0].value=6
  if(kind==='unit')r.facts[0].label='5 USD_per_BRL'
  if(kind==='date')r.observedDate='2026-11-01'
  if(kind==='clock')r.marketData.fetchedAt='2026-11-02T04:00:00Z'
  if(kind==='previous')r.facts[1].value=4.1
  if(kind==='change')r.facts[2].value=-25
  if(kind==='chart')r.series[0].value=3
  if(kind==='source')r.marketData.source='EXCEL'
  if(kind==='withdrawn')resolved.state='withdrawn'
  expect(()=>prepareReferenceRecovery(input)).toThrow('public_report_historical_selection_mismatch')
 })
 it('uses the shared retention/calculation path, preserves other currencies and the latest date, and is idempotent',()=>{
  const input=fixture(),receipt=prepareReferenceRecovery(input),current=data('2026-11-07',6)
  current.dailyRates.push(row('2026-11-02','CNY','LOCAL_PER_USD',7))
  const before=structuredClone(current),result=retainDashboardReferences(current,current,at,[receipt]),full=buildDatasetFiles({...result.dataset,rawSheets:undefined}).fullDataset
  const recovered=(c:string,t='LOCAL_PER_USD')=>full.dailyRates.find(r=>r.date==='2026-11-02'&&r.currency===c&&r.rateType===t)?.value
  expect(recovered('BRL')).toBe(5);expect(recovered('BRL','KRW')).toBe(300);expect(recovered('CNY')).toBe(7)
  expect(full.dailyRates.find(r=>r.date==='2026-11-07'&&r.currency==='BRL'&&r.rateType==='LOCAL_PER_USD')?.value).toBe(6)
  expect(full.referenceArchive!.recoveries![receipt.id]).toEqual(receipt)
  const repeat=retainDashboardReferences(current,full,'2026-11-08T05:00:00Z',[receipt])
  expect(repeat.dataset.referenceArchive).toEqual(full.referenceArchive)
  expect(repeat.review.newRevisionOffers).toBe(0);expect(current).toEqual(before)
  expect(buildDatasetFiles(full).staticFallback.referenceArchive).toBeUndefined()
 })
 it('does not overwrite a conflicting adopted selection or accept a modified receipt/conversion',()=>{
  const receipt=prepareReferenceRecovery(fixture()),wrong=retainDashboardReferences(data('2026-11-07',6),data('2026-11-02',6),at).dataset
  expect(()=>retainDashboardReferences(wrong,wrong,at,[receipt])).toThrow('conflicts_with_locked')
  const bad=structuredClone(receipt);bad.selections[0].conversion!.value=301
  expect(()=>verifyReferenceRecovery(reseal(bad))).toThrow('selection_invalid')
  expect(()=>verifyReferenceRecovery({...receipt,id:'0'.repeat(64)})).toThrow('receipt_invalid')
  const result=retainDashboardReferences(data('2026-11-07',6),data('2026-11-07',6),at,[receipt]).dataset
  const tampered=structuredClone(result);delete tampered.referenceArchive!.recoveries
  expect(()=>validateReferenceArchive(tampered)).toThrow('integrity')
 })
 it('rejects duplicate currency receipts and future-dated recovery rather than restarting history',()=>{
  const input=fixture();input.reports.push(structuredClone(input.reports[0]))
  expect(()=>prepareReferenceRecovery(input)).toThrow('selection_invalid')
  const receipt=prepareReferenceRecovery(fixture())
  expect(()=>retainDashboardReferences(data('2026-11-07'),data('2026-11-07'),'2026-11-08T03:00:00Z',[receipt])).toThrow('clock_invalid')
 })
})
