// One common operational path for all configured countries. The caller owns
// explicit activation/budget and durable DB access. No file/env/key loading,
// prompt editing, original replacement, retries, fallback or publication here.
import {REPORT_CURRENCIES} from './shared-price-contract.js'
import {runtimeMode} from './runtime.js'
import {runtimePublications} from './runtime-store.js'
import {runtimeSourceTransport} from './runtime-source-transport.js'
import {reviewRuntimeSources} from './runtime-source-review.js'
import {supplyRuntimeInput} from './runtime-supply.js'
import {runRuntimeWorker} from './runtime-worker.js'
import {fingerprint} from './research-harness.js'
import {countryContinuation} from './research-continuation.js'
import {buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {evaluatePublicationCadence} from './publication-cadence.js'

// Scheduling hint only; supply still validates every date, use decision and
// claim. Do not let an optional pending source precede ready initial drafts.
export function countryWorkOrder(countries){
 const ready=country=>{
  const groups=new Map()
  for(const review of country.savedSourceReviews??[])if(!review.heldStatus&&review.receipt)
   for(const {record} of review.materialInput?.materials??[]){
    const key=record.sessionDate??(record.marketPeriod?fingerprint(record.marketPeriod):null)
    if(!key)continue
    if(!groups.has(key))groups.set(key,new Set())
    for(const role of Object.values(record.claimRoles??{}))groups.get(key).add(role)
   }
  return [...groups.values()].some(roles=>roles.has('market_observation')&&roles.has('attributed_fx_explanation'))
 }
 return [...countries].sort((a,b)=>Number(ready(b))-Number(ready(a)))
}

export async function runOperationalReportBatch({dataset,countries,asOf,store,env,approval,sourcePlan,sourceRegister,registry,processingRules,
 preflightSource,preflightWriter,send,reconcile,checkpoint=async()=>{},beforeCountry,afterCountry,excludedCountries=[],testOnly=false,writer='sol'}) {
 if(!Array.isArray(countries)||countries.length!==REPORT_CURRENCIES.length
  ||new Set(countries.map(c=>c.currency)).size!==REPORT_CURRENCIES.length
  ||REPORT_CURRENCIES.some(c=>!countries.some(r=>r.currency===c)))throw Error('complete_registered_country_batch_required')
 if(!Array.isArray(excludedCountries)||excludedCountries.some(c=>!REPORT_CURRENCIES.includes(c)))throw Error('registered_country_exclusions_required')
 if(runtimeMode(env)!=='currency')return {status:'runtime_disabled',modelCalls:0,publicationApproved:false}
 const control=await store.control()
 if(!['sol','sol-us'].includes(writer)||!control.enabled||!control.review_enabled||control.writer!==writer)return {status:'runtime_disabled',modelCalls:0,publicationApproved:false}
 if(approval?.version!=='operational-report-batch-approval/1'||approval.authorized!==true||approval.maxReports!==6
  ||!Number.isFinite(approval.budgetUsd)||approval.budgetUsd<=0||!Number.isInteger(approval.maxCalls)||approval.maxCalls<12
  ||approval.datasetBinding!==fingerprint(dataset)||approval.rulesBinding!==fingerprint(processingRules)
  ||approval.countriesBinding!==fingerprint(countries)||approval.asOf!==asOf
  ||!Array.isArray(approval.sourcePlanBindings)||!Number.isFinite(approval.sourceBudgetUsd)
  ||approval.sourceBudgetUsd+6*.5>approval.budgetUsd)throw Error('bound_operational_batch_budget_required')
 let calls=0,confirmedUsd=0,unknownCost=false
 const guardedSend=async args=>{
  if(unknownCost||calls>=approval.maxCalls)throw Error('batch_stopped_before_dispatch')
  calls++
  // A thrown transport leaves a durable unknown DB reservation. No other
  // country may continue spending under a new task/case/request identity.
  try{return await send(args)}catch(error){unknownCost=true;throw error}
 }
 const accountingStore={...store,
  reserve:async request=>{
   if(unknownCost||calls>=approval.maxCalls)return {reserved:false,reason:'batch_stopped_before_dispatch'}
   if(confirmedUsd+request.reservedNano/1e9>approval.budgetUsd)return {reserved:false,reason:'batch_budget_hold'}
   return store.reserve(request)
  },
  receive:async(id,response,actual)=>{
   try{await store.receive(id,response,actual)}catch(error){unknownCost=true;throw error}
   if(actual===null){unknownCost=true;return}
   confirmedUsd+=actual/1e9
  }}
 const sourceTransport=runtimeSourceTransport({store:accountingStore,env,
  approval:{version:'runtime-source-approval/1',planBindings:approval.sourcePlanBindings,
   budgetUsd:approval.sourceBudgetUsd,maxCalls:approval.maxCalls-12},preflight:preflightSource,send:guardedSend,reconcile})
 const rows=[]
 for(const {currency} of countryWorkOrder(REPORT_CURRENCIES.map(c=>countries.find(r=>r.currency===c)))){
  if(unknownCost){rows.push({currency,status:'batch_cost_unresolved_no_call',modelCalls:0});continue}
  if(excludedCountries.includes(currency)){rows.push({currency,status:'country_owned_by_prior_batch',modelCalls:0,publicationApproved:false});continue}
  const country=countries.find(c=>c.currency===currency),beforeCalls=calls,beforeCost=confirmedUsd
  // Preserve the bound planning decision before case claims, source calls or
  // cached-input staging. A valid old receipt cannot override a current hold.
  if(country.acquisitionError||country.preparation&&country.preparation.status!=='planned'){
   rows.push({currency,status:country.preparation?.status??'country_preparation_hold',
    holds:country.preparation?.holds??['source_acquisition_failed'],runId:null,modelCalls:0,publicationApproved:false})
   continue
  }
  if(beforeCountry){
   const eligibility=await beforeCountry(country)
   if(!eligibility.claimed){rows.push({currency,status:eligibility.reason??'existing_case_update',
    ...(eligibility.holds?.length?{holds:eligibility.holds}:{}),runId:null,modelCalls:0,publicationApproved:false});continue}
  }
  try{
   const publications=runtimePublications(await store.history(currency),currency)
   const supplyWith=onlySaved=>supplyRuntimeInput({dataset,currency,asOf,calendar:country.calendar,
    commentaryTarget:country.commentaryTarget,publications,handoff:country.handoff,
    claimTypingReview:country.claimTypingReview,periodicInput:country.periodicInput,eventCandidateIds:country.eventCandidateIds??[],sourcePlan,sourceRegister,processingRules,store:accountingStore,writer,
    acquire:async()=>({collection:country.collection,officialBackground:country.officialBackground,sources:[...new Set(country.collection.reviewQueue.map(c=>c.sourceId))],networkCalls:0}),
    review:async args=>{
     const reviewed=await reviewRuntimeSources({...args,registry,processingRules,saved:country.savedSourceReviews??[],onlySaved,
      extract:sourceTransport.extract,compare:sourceTransport.compare})
     await checkpoint(currency,'source-review',reviewed)
     return reviewed
    }})
   const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf,calendar:country.calendar})
   const cadence=evaluatePublicationCadence({snapshot,asOf,calendar:country.calendar,publications,eventCandidateIds:country.eventCandidateIds??[]})
   let supply=cadence.triggers?.includes('bootstrap')?await supplyWith(true):null
   const reusedInitial=!!supply?.staged&&supply.task?.purpose==='initial'
   if(!reusedInitial)supply=await supplyWith(false)
   await checkpoint(currency,'supply',supply)
   let generated={status:supply.status,modelCalls:0,publicationApproved:false}
   if(supply.staged&&!unknownCost)generated=await runRuntimeWorker({env,currency,asOf,store:accountingStore,
    loadDataset:async()=>dataset,preflight:preflightWriter,send:guardedSend,reconcile,testOnly})
   await checkpoint(currency,'generation',generated)
   rows.push({currency,status:generated.status,sourceStatus:supply.status,purpose:supply.task?.purpose??null,
    runId:generated.runId??null,modelCalls:calls-beforeCalls,confirmedUsd:confirmedUsd-beforeCost,
    reason:generated.reason??generated.cost?.reviewReason??null,waitingStage:generated.waitingStage??null,
    sourceHolds:supply.holds,sourceIssues:[...(supply.collectionIssues??[]),...(supply.sourceReviewIssues??[])],
    researchAssessment:supply.researchAssessment,sourceWorkMode:reusedInitial?'initial_from_independently_reviewed_evidence':'original_review_required',
    pendingOriginalReviews:(supply.sourceReviewIssues??[]).filter(i=>i.status==='pending_original_review_not_admitted').length,
    ...(testOnly?{testOnly:true}:{}),publicationApproved:false})
  }catch(error){
   const reason=/^[a-z0-9_]+$/.test(error.message??'')?error.message:'runtime_batch_country_failed'
   const row={currency,status:'country_execution_hold',reason,runId:null,modelCalls:calls-beforeCalls,confirmedUsd:confirmedUsd-beforeCost,publicationApproved:false}
   rows.push(row);await checkpoint(currency,'failure',row)
  }
  rows.at(-1).continuation=countryContinuation(rows.at(-1))
  if(afterCountry)await afterCountry(country,rows.at(-1))
  await checkpoint(currency,'progress',{rows,modelCalls:calls,confirmedUsd,unknownCost,publicationApproved:false})
 }
 return {version:'operational-report-batch/1',status:unknownCost?'batch_cost_unresolved':'completed_with_country_results',
  rows:[...rows].sort((a,b)=>REPORT_CURRENCIES.indexOf(a.currency)-REPORT_CURRENCIES.indexOf(b.currency)).map(row=>({...row,continuation:row.continuation??countryContinuation(row)})),
  modelCalls:calls,confirmedUsd,costUsd:unknownCost?null:confirmedUsd,unknownCost,publicationApproved:false,manualEdits:0,
  productionChanges:0,sourceReviewMeaning:'actual_original_extraction_and_comparison_then_bound_note_and_manuscript_review'}
}
