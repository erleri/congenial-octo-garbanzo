// Free change detection, not semantic entailment or permission to edit/publish.
import {fingerprint} from './research-harness.js'
import {reviewClaims} from './claim-review.js'
import {newsEdition} from './operating-source-cache.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {unsafeSourceText} from './source-text-safety.js'
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {officialCountryProfiles,countryDefinitionId,OFFICIAL_COUNTRY_VERSION} from './official-country-statistics.js'
import {INEGI_REPORT_INDICATORS,INEGI_DEFINITION_VERSION,inegiDefinitionId} from './inegi-report-indicators.js'

export const CORRECTION_VERSION='published-correction/1'
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)
const same=(a,b)=>canonical(a)===canonical(b)
const iso=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))
const urlOK=v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!/[?&](?:token|api_?key|password)=/i.test(v)}catch{return false}}
function snapshotOf(row){
 if(!row.runtimeContext)return null
 const {serializedRuntimeContext,...projection}=row.runtimeContext
 if(typeof serializedRuntimeContext!=='string')throw Error('correction_snapshot_binding_missing')
 const original=JSON.parse(serializedRuntimeContext)
 if(!same(original,projection))throw Error('correction_snapshot_changed')
 return original.task??null
}
function links(report){
 return reviewClaims(report.content).map(claim=>{
  const [section,index]=claim.target.split('.'),block=report.content[section]?.[Number(index)]
  return {...claim,evidenceIds:Array.isArray(block?.evidenceIds)?block.evidenceIds:[],factIds:Array.isArray(block?.factIds)?block.factIds:[]}
 })
}
const view=s=>({value:s.value,period:s.period,seriesId:s.seriesId,definitionId:s.definitionId,scope:s.scope,
 edition:s.release?.editionHash??s.release?.sha256??s.editionHash??s.releaseHash??null})
function storedScope(stat,old,currency){
 if(stat.scope&&typeof stat.scope==='object')return stat.scope
 if(old.scope&&typeof old.scope==='object')return old.scope
 // Older snapshots stored the full definition ID but not scope fields. Only
 // an exact registered ID/version match can recover that definition, not a
 // guessed country default or an unversioned inference from a source title.
 const profile=officialCountryProfiles().find(p=>p.currency===currency&&p.seriesId===stat.seriesId)
 if(profile&&stat.definitionVersion===OFFICIAL_COUNTRY_VERSION&&stat.definitionId===countryDefinitionId(profile))return profile.scope
 const inegi=currency==='MXN'&&INEGI_REPORT_INDICATORS.find(p=>p.indicatorId===stat.seriesId)
 if(inegi&&stat.definitionVersion===INEGI_DEFINITION_VERSION&&stat.definitionId===inegiDefinitionId(inegi))return inegi.scope
 return null
}
export function scanPublishedCorrections({currency,history,collection,admission,asOf,includeTest=false}){
 if(!REPORT_CURRENCIES.includes(currency)||!iso(asOf)||!Array.isArray(history)||history.length>1000)
  throw Error('correction_scan_context_required')
 const candidates=[],issues=[],seen=new Set(),originals=[]
 for(const card of collection?.reviewQueue??[]){
  try{const {original}=validateSelectedReviewCard(collection,card)
   if(original.kind==='article'&&iso(original.collectedAt)&&Date.parse(original.collectedAt)<=Date.parse(asOf))originals.push(original)
  }catch{issues.push('current_article_binding_unverified')}
 }
 let statistics=[]
 if(admission){const {binding,...body}=admission
  if(admission.version==='official-statistic-admission/1'&&binding===fingerprint(body)&&admission.currency===currency&&iso(admission.asOf)&&Date.parse(admission.asOf)<=Date.parse(asOf))statistics=admission.admitted??[]
  else issues.push('current_statistics_binding_unverified')
 }
 let reports=0,missingBasis=0,unmapped=0
 for(const row of history){
  const report=row.report
  if(report?.currency!==currency||report.historicalReview||report.testOnly&&!includeTest||row.withdrawnAt||!iso(row.publishedAt)||Date.parse(row.publishedAt)>Date.parse(asOf))continue
  if(!report.id||!report.content)continue
  reports++
  let task=null
  try{task=snapshotOf(row)}catch{issues.push('published_snapshot_binding_unverified')}
  const packet=task?.plan?.packet
  if(!packet)missingBasis++
  const evidence=report.evidence??[],claims=links(report)
  const add=(claim,e,kind,before,after,reason)=>{
   if(!urlOK(e.url)||claim.quote.length>2000||unsafeSourceText(claim.quote)){issues.push('candidate_display_safety_hold');return}
   const identity={version:CORRECTION_VERSION,currency,reportId:report.id,claimId:claim.id,claimHash:claim.claimHash,
    evidenceId:e.id,sourceUrl:e.url,kind,before,after}
   const key=fingerprint(JSON.parse(canonical(identity)))
   if(seen.has(key))return
   seen.add(key)
   if(candidates.length>=100){issues.push('candidate_capacity_review_required');return}
   candidates.push({...identity,key,baseDate:report.baseDate,quote:claim.quote,detectedAt:asOf,reason,
    contentReview:'not_performed',publicationApproved:false,testOnly:report.testOnly===true})
  }
  for(const e of evidence){
   const old=packet?.evidence?.find(p=>p.id===e.id),stat=old?.officialStatistic
   const affected=claims.filter(c=>c.evidenceIds.includes(e.id)||stat&&c.factIds.includes(stat.fact?.id))
   if(!affected.length){unmapped++;continue}
   const scope=stat?storedScope(stat,old,currency):null
   if(stat&&!scope)issues.push('published_indicator_definition_unavailable')
   if(stat&&scope&&old.period){
    for(const fresh of statistics.filter(s=>s.seriesId===stat.seriesId&&s.period===old.period)){
     const previous={...stat,value:stat.fact.value,period:old.period,scope}
     if(fresh.definitionId!==stat.definitionId||fresh.definitionVersion!==stat.definitionVersion||!same(fresh.scope,scope)){
      affected.forEach(c=>add(c,e,'official_definition_changed',view(previous),view(fresh),'같은 대상 월·계열의 정의가 달라 직접 수치 비교를 보류합니다.'))
     }else if(Math.abs(fresh.value-stat.fact.value)>1e-9*Math.max(1,Math.abs(stat.fact.value))){
      affected.forEach(c=>add(c,e,'official_value_revised',view(previous),view(fresh),'같은 정의·대상 월의 최신 값이 발행 당시 값과 다릅니다. 당시 오류인지 사후 수정인지 내용 검토가 필요합니다.'))
     }
    }
   }
   const oldIdentity=old?.originalCapture?.contentIdentity??task?.materialEditions?.find(p=>p.url===e.url)?.identity
   if(!oldIdentity)continue
   for(const fresh of originals.filter(o=>o.url===e.url)){
    const current=newsEdition(fresh)
    if(current.identity!==oldIdentity)affected.forEach(c=>add(c,e,'cited_source_edition_changed',
     {edition:oldIdentity},{edition:current.identity},'인용한 같은 URL의 본문·발표/수정 정보가 달라졌습니다. 해당 문장의 지지가 바뀌었는지는 별도 내용 대조가 필요합니다.'))
   }
  }
 }
 return {version:CORRECTION_VERSION,currency,checkedAt:asOf,candidates,
  coverage:{reportsChecked:reports,missingSnapshotReports:missingBasis,unmappedEvidence:unmapped,
   currentArticles:originals.length,admittedStatistics:statistics.length,
   semanticComparison:'not_performed',differentSourceContradictions:'not_evaluated',historyWindowLimited:history.length===1000,issues:[...new Set(issues)]},
  status:issues.length||missingBasis||unmapped||history.length===1000?'partial_check':!reports?'no_eligible_publication':candidates.length?'candidates_pending_review':'no_structural_candidate',
  modelCalls:0,costUsd:0,publicationApproved:false}
}

export async function recordPublishedCorrections(args,store){
 let scan
 try{scan=scanPublishedCorrections(args)}catch{return {status:'correction_input_check_failed',candidates:0}}
 if(!store.recordCorrections)return {status:'correction_storage_unavailable',candidates:scan.candidates.length,coverage:scan.coverage}
 try{
  const result=await store.recordCorrections({currency:args.currency,checkedAt:args.asOf,candidates:scan.candidates,coverage:scan.coverage})
  return {status:scan.status,candidates:scan.candidates.length,stored:result.inserted,duplicates:result.duplicates,coverage:scan.coverage}
 }catch{return {status:'correction_storage_failed',candidates:scan.candidates.length,coverage:scan.coverage}}
}
