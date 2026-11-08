// Server generation only. First selected values and known sources are retained;
// a new provider history response is an offer, not permission to rewrite them.
import {createHash} from 'node:crypto'
import type {DailyRate,ExchangeRateDataset,DashboardReferenceArchive,DashboardReferenceRecovery,FxPriceProvenance,FxPriceSource} from '../src/types/exchangeRate'
import {CURRENCIES} from '../src/types/exchangeRate'
import {applyForwardFillToDaily} from '../src/lib/imputation'
import {buildMonthlyRates,buildRawSheets} from '../src/lib/merger'
import {buildMovingComparisonRows} from '../src/lib/moving'
import {prunePriceProvenance} from '../src/lib/price-provenance'
import {referenceRowOrigin} from './currency-report/dashboard-reference-state.js'
import {readDashboardPriceLineage} from './currency-report/shared-price-contract.js'
import {referenceDigest as hash,verifyReferenceRecovery} from './dashboard-reference-recovery'

type Archive=DashboardReferenceArchive
const date=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
const stamp=(v:string)=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const positive=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>0
const key=(d:string,c:string,t:string)=>`${d}|${c}|${t}`
const body=<T extends {id:string}>(value:T)=>{const {id,...b}=value;void id;return b}
const sourceIdentity=(source:FxPriceSource|null)=>source?JSON.stringify([source.provider,source.endpoint,source.dateMeaning,source.priceKind]):null
const offerId=(r:Archive['revisionOffers'][number])=>hash({date:r.date,currency:r.currency,rateType:r.rateType,selectedValue:r.selectedValue,offeredValue:r.offeredValue,offeredIdentity:r.offeredIdentity})
function rawSource(data:ExchangeRateDataset,row:DailyRate):FxPriceSource|null {
  if(readDashboardPriceLineage(data,row).status!=='recorded')return null
  const book=data.priceProvenance!,s=book.sources[book.quotesByDate[row.date][row.currency].sourceId]
  // Never copy arbitrary extensions or credentials into the durable archive.
  return Object.fromEntries(['provider','endpoint','capturedAt','responseSha256','digestMeaning','providerUpdatedAt','providerTimestampLocal',
    'providerDate','dateMeaning','priceKind','providerTimeZone','observedAt','localSessionDate','origin','transport'].map(k=>[k,s[k as keyof FxPriceSource]])) as unknown as FxPriceSource
}
function sourceId(archive:Archive,source:FxPriceSource|null){
  if(!source)return null
  const id='r'+hash(source);archive.sources[id]??=structuredClone(source);return id
}
const seal=(a:Archive)=>{const {digest,...b}=a;void digest;return {...b,digest:hash(b)}}
function rowMap(data:ExchangeRateDataset){
  const rows=new Map<string,DailyRate>()
  for(const r of data.dailyRates){const k=key(r.date,r.currency,r.rateType);if(rows.has(k))throw Error('duplicate_daily_reference_row');rows.set(k,r)}
  return rows
}
export function validateReferenceArchive(data:ExchangeRateDataset,requireFull=false):void {
  const a=data.referenceArchive;if(!a)return
  const {digest,...b}=a
  if(a.version!=='dashboard-reference-archive/1'||!['full','window'].includes(a.scope)||requireFull&&a.scope!=='full'
    ||!Array.isArray(a.entries)||a.entries.length>100000||!Array.isArray(a.revisionOffers)||a.revisionOffers.length>1000000||digest!==hash(b))throw Error('reference_archive_integrity_invalid')
  const rows=rowMap(data),keys=new Set<string>(),ids=new Set<string>()
  for(const [id,receipt] of Object.entries(a.recoveries??{})){
    verifyReferenceRecovery(receipt)
    if(id!==receipt.id)throw Error('reference_recovery_identity_invalid')
  }
  for(const [id,s] of Object.entries(a.sources)){
    if(id!=='r'+hash(s)||s.origin!=='response'||!stamp(s.capturedAt??''))throw Error('reference_archive_source_invalid')
    const endpoint=new URL(s.endpoint??'')
    if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('reference_archive_source_invalid')
  }
  for(const e of a.entries){
    if(e.id!==hash(body(e))||ids.has(e.id)||!date(e.date)||!date(e.selectedForDate)||e.date>e.selectedForDate
      ||!stamp(e.selectedAt)||!stamp(e.recordedAt)||Date.parse(e.selectedAt)>Date.parse(e.recordedAt)
      ||!['legacy_dataset_bootstrap','generated_dashboard_selection','verified_stored_selection'].includes(e.basis)||!Array.isArray(e.rows)||!e.rows.length||e.rows.length>CURRENCIES.length*2
      ||e.basis==='verified_stored_selection'&&!a.recoveries?.[e.recoveryId??''])throw Error('reference_archive_entry_invalid')
    ids.add(e.id)
    for(const [currency,type,value] of e.rows){
      const k=key(e.date,currency,type),r=rows.get(k)
      if(!CURRENCIES.includes(currency)||!['LOCAL_PER_USD','KRW'].includes(type)||!positive(value)||keys.has(k)
        ||r?.value!==value||r.source!=='API'||r.imputationMethod!=='NONE'||r.status!=='ok')throw Error('saved_reference_selection_changed')
      keys.add(k)
      const sid=e.sourceIds[currency]
      if(type==='LOCAL_PER_USD'&&sid!=null&&!a.sources[sid])throw Error('reference_archive_source_missing')
    }
  }
  for(const r of a.revisionOffers)if(r.id!==offerId(r)||!date(r.date)||!keys.has(key(r.date,r.currency,r.rateType))
    ||!positive(r.selectedValue)||r.offeredValue!==null&&!positive(r.offeredValue)||!stamp(r.firstSeenAt)
    ||r.offeredSourceId!==null&&!a.sources[r.offeredSourceId])throw Error('reference_archive_revision_invalid')
  for(const receipt of Object.values(a.recoveries??{}))for(const s of receipt.selections)for(const r of [s.origin,s.conversion,s.conversionBasis].filter((r):r is DailyRate=>r!==null)){
    if(rows.get(key(r.date,r.currency,r.rateType))?.value!==r.value||!keys.has(key(r.date,r.currency,r.rateType)))throw Error('recovered_reference_selection_changed')
  }
}
function captureSelections(archive:Archive,data:ExchangeRateDataset,now:string,basis:Archive['entries'][number]['basis']) {
  const existing=new Set(archive.entries.flatMap(e=>e.rows.map(([c,t])=>key(e.date,c,t)))),groups=new Map<string,DailyRate[]>()
  for(const currency of CURRENCIES)for(const type of ['LOCAL_PER_USD','KRW'] as const){
    const selected=data.dailyRates.find(r=>r.date===data.baseDate&&r.currency===currency&&r.rateType===type)
    const origin=referenceRowOrigin(data.dailyRates,selected) as DailyRate|null
    if(!origin||existing.has(key(origin.date,currency,type)))continue
    const raw=data.priceProvenance?.quotesByDate[origin.date]?.[currency]
    if(type==='LOCAL_PER_USD'&&raw&&data.priceProvenance?.sources[raw.sourceId]?.origin==='manual_input')continue
    const rows=groups.get(origin.date)??[];rows.push(origin);groups.set(origin.date,rows)
  }
  for(const [day,rows] of groups){
    const sourceIds:Archive['entries'][number]['sourceIds']={}
    for(const r of rows.filter(r=>r.rateType==='LOCAL_PER_USD'))sourceIds[r.currency]=sourceId(archive,rawSource(data,r))
    const b={date:day,selectedForDate:data.baseDate,selectedAt:data.fetchedAt,recordedAt:now,basis,
      rows:rows.map(r=>[r.currency,r.rateType,r.value!] as Archive['entries'][number]['rows'][number]).sort(([a,t],[b,u])=>a.localeCompare(b)||t.localeCompare(u)),sourceIds}
    archive.entries.push({id:hash(b),...b})
  }
}
export function retainDashboardReferences(incoming:ExchangeRateDataset,previous:ExchangeRateDataset,now=new Date().toISOString(),recoveries:DashboardReferenceRecovery[]=[]) {
  if(!date(incoming.baseDate)||!date(previous.baseDate)||incoming.baseDate<previous.baseDate||!stamp(now)||incoming.baseDate>now.slice(0,10)||!stamp(incoming.fetchedAt)||!stamp(previous.fetchedAt)
    ||Date.parse(incoming.fetchedAt)>Date.parse(now)||Date.parse(previous.fetchedAt)>Date.parse(now))throw Error('reference_generation_clock_or_date_invalid')
  if(previous.coverage?.limitedDailyHistory)throw Error('full_previous_reference_dataset_required')
  validateReferenceArchive(previous,true)
  if(previous.coverage?.dataVersion){
    const {coverage,...content}=previous;void coverage
    if(createHash('sha256').update(JSON.stringify(content)).digest('hex')!==previous.coverage.dataVersion)throw Error('previous_reference_dataset_version_mismatch')
  }
  const archive:Archive=previous.referenceArchive?structuredClone(previous.referenceArchive):{version:'dashboard-reference-archive/1',scope:'full',entries:[],sources:{},revisionOffers:[],digest:''}
  if(!previous.referenceArchive)captureSelections(archive,previous,now,'legacy_dataset_bootstrap')
  if(!Array.isArray(recoveries)||recoveries.length>100||new Set(recoveries.map(r=>r.id)).size!==recoveries.length)throw Error('invalid_reference_recovery_set')
  for(const receipt of recoveries){
    verifyReferenceRecovery(receipt)
    if(Date.parse(receipt.preparedAt)>Date.parse(now)||receipt.artifact.baseDate>incoming.baseDate)throw Error('reference_recovery_clock_invalid')
    if(archive.recoveries?.[receipt.id])continue
    const locked=new Map(archive.entries.flatMap(e=>e.rows.map(([c,t,v])=>[key(e.date,c,t),v])))
    for(const s of receipt.selections){
      const recovered=[s.origin,s.conversion,s.conversionBasis].filter((r):r is DailyRate=>r!==null),missing:DailyRate[]=[]
      for(const r of recovered){
        const k=key(r.date,r.currency,r.rateType)
        if(locked.has(k)&&locked.get(k)!==r.value)throw Error('recovery_conflicts_with_locked_selection')
        if(!locked.has(k)){missing.push(r);locked.set(k,r.value!)}
      }
      // Different currencies may share the same USD conversion input. Preserve
      // that row once, without assigning the currency's LOCAL source to USD.
      if(missing.length){
        const b={date:s.origin.date,selectedForDate:receipt.artifact.baseDate,selectedAt:receipt.artifact.fetchedAt,recordedAt:now,
          basis:'verified_stored_selection' as const,recoveryId:receipt.id,
          rows:missing.map(r=>[r.currency,r.rateType,r.value!] as Archive['entries'][number]['rows'][number]),
          sourceIds:{[s.currency]:sourceId(archive,s.provider)}}
        archive.entries.push({id:hash(b),...b})
      }
    }
    ;(archive.recoveries??={})[receipt.id]=structuredClone(receipt)
  }
  const freshRows=rowMap(incoming),rows=new Map(freshRows),offers=new Set(archive.revisionOffers.map(r=>r.id))
  const provenance:FxPriceProvenance=structuredClone(incoming.priceProvenance??{version:'fx-price-provenance/1',sources:{},quotesByDate:{},selectionAudit:{}})
  let retainedRows=0,newOffers=0
  const lockedKeys=new Set<string>(),lockedDays=new Set<string>()
  for(const e of archive.entries)for(const [currency,type,value] of e.rows){
    const k=key(e.date,currency,type),offered=freshRows.get(k),offeredValue=positive(offered?.value)?offered.value:null
    const source=type==='LOCAL_PER_USD'&&offered?rawSource(incoming,offered):null
    if(offeredValue!==value){
      const r:Archive['revisionOffers'][number]={id:'',date:e.date,currency,rateType:type,selectedValue:value,offeredValue,
        offeredIdentity:sourceIdentity(source),offeredSourceId:null,firstSeenAt:now}
      r.id=offerId(r)
      if(!offers.has(r.id)){r.offeredSourceId=sourceId(archive,source);archive.revisionOffers.push(r);offers.add(r.id);newOffers++}
    }
    const [year,month,day]=e.date.split('-').map(Number)
    rows.set(k,{date:e.date,year,month,day,currency,rateType:type,value,status:'ok',source:'API',imputationMethod:'NONE'});retainedRows++;lockedKeys.add(k);lockedDays.add(e.date)
    if(type==='LOCAL_PER_USD'){
      const id=e.sourceIds[currency]
      if(id){provenance.sources[id]=structuredClone(archive.sources[id]);(provenance.quotesByDate[e.date]??={})[currency]={sourceId:id,value}}
      else if(provenance.quotesByDate[e.date])delete provenance.quotesByDate[e.date][currency]
    }
  }
  // Recompute only a not-yet-fixed KRW cell when one of its inputs was restored.
  // Already adopted KRW values are exact saved results, not re-rounded ratios.
  for(const r of rows.values())if(r.rateType==='KRW'&&r.currency!=='USD'&&lockedDays.has(r.date)&&!lockedKeys.has(key(r.date,r.currency,'KRW'))&&r.source==='API'&&r.imputationMethod==='NONE'){
    const local=rows.get(key(r.date,r.currency,'LOCAL_PER_USD')),usd=rows.get(key(r.date,'USD','KRW'))
    const ready=local?.source==='API'&&local.imputationMethod==='NONE'&&positive(local.value)&&usd?.source==='API'&&usd.imputationMethod==='NONE'&&positive(usd.value)
    rows.set(key(r.date,r.currency,'KRW'),{...r,value:ready?usd.value!/local.value!:null,status:ready?'ok':'empty'})
  }
  // Existing FFILL semantics are reapplied after restoring their real origins.
  // A carried holiday value is not minted as a new observed quote.
  const observed=[...rows.values()].map(r=>r.source==='IMPUTED'&&r.imputationMethod==='FFILL'
    ?{...r,value:null,status:'empty' as const,source:'API' as const,imputationMethod:'NONE' as const}:r)
  const dailyRates=applyForwardFillToDaily(observed,incoming.baseDate)
  const dataset:ExchangeRateDataset={...incoming,dailyRates,monthlyRates:buildMonthlyRates(dailyRates),movingComparison:[],rawSheets:[],
    priceProvenance:prunePriceProvenance(provenance,dailyRates)}
  captureSelections(archive,dataset,now,'generated_dashboard_selection')
  dataset.referenceArchive=seal(archive)
  const [year,month]=dataset.baseDate.split('-').map(Number)
  dataset.movingComparison=buildMovingComparisonRows(dataset,year,month);dataset.rawSheets=buildRawSheets(dataset)
  validateReferenceArchive(dataset,true)
  return {dataset,review:{retainedRows,newRevisionOffers:newOffers,totalRevisionOffers:archive.revisionOffers.length,
    entries:archive.entries.length,unknownSourceSelections:archive.entries.reduce((n,e)=>n+e.rows.filter(([c,t])=>t==='LOCAL_PER_USD'&&e.sourceIds[c]==null).length,0),
    recoveryReceipts:Object.keys(archive.recoveries??{}).length,numericCorrectionsApplied:0,sourceDatesAreLocalCloses:false}}
}
