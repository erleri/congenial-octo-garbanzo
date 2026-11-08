import {createHash} from 'node:crypto'
import type {DailyRate,DashboardReferenceRecovery,ExchangeRateDataset,FxPriceSource} from '../src/types/exchangeRate'
import {CURRENCIES} from '../src/types/exchangeRate'
import {readDashboardPriceLineage} from './currency-report/shared-price-contract.js'
import {referenceRowOrigin} from './currency-report/dashboard-reference-state.js'
import {getDashboardPreviousDaily} from '../src/lib/dashboard-price.js'

const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'
 ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,value])=>[k,canonical(value)])):v
export const referenceDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')
const rawHash=(s:string)=>createHash('sha256').update(s).digest('hex')
const day=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
const stamp=(v:string)=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const hex=(s:string,n=64)=>typeof s==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(s)
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0
const clean=(r:DailyRate|null)=>r&&CURRENCIES.includes(r.currency)&&day(r.date)&&positive(r.value)&&r.status==='ok'
 &&r.source==='API'&&r.imputationMethod==='NONE'&&r.year===Number(r.date.slice(0,4))&&r.month===Number(r.date.slice(5,7))&&r.day===Number(r.date.slice(8,10))
const project=(r:DailyRate):DailyRate=>Object.fromEntries(['currency','date','year','month','day','rateType','value','status','source','imputationMethod'].map(k=>[k,r[k as keyof DailyRate]])) as unknown as DailyRate
export function verifyReferenceRecovery(receipt:DashboardReferenceRecovery):void {
 const {id,...body}=receipt,a=receipt.artifact
 if(receipt.version!=='dashboard-reference-recovery/1'||id!==referenceDigest(body)||!stamp(receipt.preparedAt)
  ||!a||!hex(a.commit,40)||!hex(a.productionCommit,40)||!hex(a.blob,40)||!hex(a.sha256)||!hex(a.dataVersion)
  ||a.path!=='data/fx-full-history.json'||!day(a.baseDate)||!stamp(a.fetchedAt)||Date.parse(a.fetchedAt)>Date.parse(receipt.preparedAt)
  ||!Array.isArray(receipt.selections)||!receipt.selections.length||receipt.selections.length>CURRENCIES.length)throw Error('reference_recovery_receipt_invalid')
 const currencies=new Set<string>(),reports=new Set<string>()
 for(const s of receipt.selections){
  if(!CURRENCIES.includes(s.currency)||currencies.has(s.currency)||!s.reportId||s.reportId.length>160||reports.has(s.reportId)
   ||s.unit!==s.currency+'_per_USD'||!hex(s.reportSha256)||!stamp(s.publishedAt)||Date.parse(s.publishedAt)>Date.parse(receipt.preparedAt)
   ||!Number.isInteger(s.matchedChartPoints)||s.matchedChartPoints<1||!clean(s.origin)||s.origin.currency!==s.currency||s.origin.rateType!=='LOCAL_PER_USD'
   ||s.selected.currency!==s.currency||s.selected.rateType!=='LOCAL_PER_USD'||s.selected.date!==a.baseDate||s.selected.value!==s.origin.value
   ||!day(s.selected.date)||s.selected.date<s.origin.date||s.selected.status!=='ok'
   ||!(s.selected.source==='API'&&s.selected.imputationMethod==='NONE'&&s.selected.date===s.origin.date
     ||s.selected.source==='IMPUTED'&&s.selected.imputationMethod==='FFILL')
   ||s.conversion!==null&&(!clean(s.conversion)||s.conversion.currency!==s.currency||s.conversion.rateType!=='KRW'||s.conversion.date!==s.origin.date
     ||!s.conversionBasis||!clean(s.conversionBasis)||s.conversionBasis.currency!=='USD'||s.conversionBasis.rateType!=='KRW'||s.conversionBasis.date!==s.origin.date
     ||Math.abs(s.conversion.value!-s.conversionBasis.value!/s.origin.value!)>1e-10*Math.max(1,s.conversion.value!))
   ||s.conversion===null&&s.conversionBasis!==null)throw Error('reference_recovery_selection_invalid')
  if(s.provider){
   const data={fetchedAt:a.fetchedAt,priceProvenance:{version:'fx-price-provenance/1',sources:{recovered:s.provider},quotesByDate:{[s.origin.date]:{[s.currency]:{sourceId:'recovered',value:s.origin.value}}}}}
   if(readDashboardPriceLineage(data,s.origin).status!=='recorded')throw Error('reference_recovery_provider_unverified')
  }
  currencies.add(s.currency);reports.add(s.reportId)
 }
}
type PublicReport={currency:string;resolved:{id:string;state:string;baseDate:string;publishedAt:string;report:{id:string;currency:string;baseDate:string;observedDate:string;marketData:{source:string;rateType:string;fetchedAt:string};facts:Array<{id:string;label:string;value:number}>;series:Array<{date:string;value:number}>}}}
export function prepareReferenceRecovery({raw,artifact,reports,preparedAt}:{raw:string;artifact:Pick<DashboardReferenceRecovery['artifact'],'commit'|'productionCommit'|'path'|'blob'|'sha256'>;reports:PublicReport[];preparedAt:string}) {
 if(rawHash(raw)!==artifact.sha256)throw Error('historical_artifact_hash_mismatch')
 const data=JSON.parse(raw) as ExchangeRateDataset,{coverage,...content}=data
 if(!coverage||coverage.limitedDailyHistory||rawHash(JSON.stringify(content))!==coverage.dataVersion)throw Error('historical_full_dataset_receipt_invalid')
 const rows=new Map<string,DailyRate>()
 for(const r of data.dailyRates){const key=[r.date,r.currency,r.rateType].join('|');if(rows.has(key))throw Error('historical_duplicate_price');rows.set(key,r)}
 const select=(date:string,currency:string,type='LOCAL_PER_USD')=>rows.get([date,currency,type].join('|'))
 const selections:DashboardReferenceRecovery['selections']=reports.map(({currency,resolved})=>{
  const r=resolved.report,spot=r.facts.find(f=>f.id==='spot'),previous=r.facts.find(f=>f.id==='previous'),change=r.facts.find(f=>f.id==='day')
  const current=select(data.baseDate,currency),origin=referenceRowOrigin(data.dailyRates,current) as DailyRate|null
  const prior=current?getDashboardPreviousDaily(data.dailyRates,current.currency,data.baseDate) as DailyRate|undefined:undefined
  const expectedChange=prior&&positive(prior.value)&&origin?(origin.value!-prior.value)/prior.value*100:null
  if(resolved.state!=='active'||resolved.id!==r.id||resolved.baseDate!==data.baseDate||r.baseDate!==data.baseDate||r.observedDate!==data.baseDate
   ||r.currency!==currency||r.marketData?.source!=='API'||r.marketData.rateType!=='LOCAL_PER_USD'||r.marketData.fetchedAt!==data.fetchedAt
   ||!origin||!spot||spot.value!==origin.value||!spot.label.endsWith(' '+currency+'_per_USD')
   ||!prior||previous?.value!==prior.value||!positive(previous?.value)||!previous.label.endsWith(' '+currency+'_per_USD')
   ||expectedChange===null||change?.value===undefined||Math.abs(change.value-expectedChange)>1e-10
   ||!Array.isArray(r.series)||!r.series.length||new Set(r.series.map(p=>p.date)).size!==r.series.length
   ||r.series.some(p=>!day(p.date)||p.date>data.baseDate||select(p.date,currency)?.value!==p.value)
   ||r.series.at(-1)?.date!==data.baseDate||r.series.at(-1)?.value!==spot.value)throw Error('public_report_historical_selection_mismatch:'+currency)
  const conversion=select(origin.date,currency,'KRW')??null
  const conversionBasis=conversion?select(origin.date,'USD','KRW')??null:null
  if(conversion&&!clean(conversion))throw Error('historical_conversion_unverified:'+currency)
  let provider:FxPriceSource|null=null
  if(readDashboardPriceLineage(data,origin).status==='recorded'){
   const book=data.priceProvenance!,s=book.sources[book.quotesByDate[origin.date][currency].sourceId]
   provider=Object.fromEntries(['provider','endpoint','capturedAt','responseSha256','digestMeaning','providerUpdatedAt','providerTimestampLocal','providerDate','dateMeaning','priceKind','providerTimeZone','observedAt','localSessionDate','origin','transport'].map(k=>[k,s[k as keyof FxPriceSource]])) as unknown as FxPriceSource
  }
  return {currency:origin.currency,unit:currency+'_per_USD',reportId:r.id,reportSha256:referenceDigest(r),publishedAt:resolved.publishedAt,
   matchedChartPoints:r.series.length,selected:project(current!),origin:project(origin),conversion:conversion?project(conversion):null,
   conversionBasis:conversionBasis?project(conversionBasis):null,provider}
 })
 const body={version:'dashboard-reference-recovery/1' as const,preparedAt,
  artifact:{...artifact,dataVersion:coverage.dataVersion,baseDate:data.baseDate,fetchedAt:data.fetchedAt},selections}
 const receipt={id:referenceDigest(body),...body};verifyReferenceRecovery(receipt);return receipt
}
