// Server coordinator. No credentials/network/activation at import. Execution
// requires service-owned policy and costs; publishing remains administrator-only.
import {randomUUID} from 'node:crypto'
import {inspectOriginalPlanEndpoint,inspectNewsModelEndpoint} from './news-model-review.js'
import {endpointDiagnostic} from './endpoint-metadata.js'
import {fingerprint} from './research-harness.js'
import {assertOperatingPolicy,operatingConfigurationHolds} from './operating-policy.js'
import {planAutomaticSupply} from './automatic-supply-plan.js'
import {runOperationalReportBatch} from './runtime-batch.js'
import {restoreOperatingPayload,runtimePublications,assertStagedRuntimeInput,isTemporaryRuntimeReadError} from './runtime-store.js'
import {buildSharedDashboardPriceSnapshot,referenceEdition} from './shared-price-contract.js'
import {evaluatePublicationCadence} from './publication-cadence.js'
import {recoverOperatingCalls} from './operating-recovery.js'
import {runtimeMode} from './runtime.js'
import {acquireRuntimeResearch} from './runtime-supply.js'
import {reuseOperatingSources,operatingSourceRecords,operatingMaterialHash,persistDeferredSources} from './operating-source-cache.js'
import {researchFeedback} from './research-continuation.js'
import {classifyCountryRefresh,frozenSourceReviewHolds} from './operating-refresh.js'
import {operatingCheckpoint} from './operating-checkpoint.js'
import {retainRegisteredResearch} from './retained-research.js'
import {currentSourceAdmissionHold} from './source-admission-catalog.js'
import {encodeOperatingInput,inspectOperatingStorage,storeOperatingInput,restoreFrozenInput} from './operating-storage.js'
export {operatingMaterialHash} from './operating-source-cache.js'

const safeReason=error=>/^[a-z0-9_]+$/.test(error?.message??'')?error.message:'operating_execution_hold'
const stopsCycle=result=>result.modelCalls===null||['cost_reconciliation_required','operating_batch_busy',
 'operating_lease_expired','operating_execution_hold','operating_storage_failure','source_endpoint_preflight_hold'].includes(result.status)
async function storageState(store,stage,error,stats,record){
 if(!record)return {recorded:false}
 try{
  await store.storageIncident({stage,reason:error?safeReason(error):'verified',healthy:!error,stats})
  return {recorded:true}
 }catch{return {recorded:false,recordFailure:'operating_incident_record_failed'}}
}
const executionRows=result=>{
 const seen=new Set()
 while(result&&!result.rows&&!seen.has(result)){seen.add(result);result=result.previousResult}
 return result?.rows??[]
}
export function operatingReferenceIdentity(dataset,countries,asOf) {
 return fingerprint(countries.map(c=>{
  return referenceEdition(buildSharedDashboardPriceSnapshot({dataset,currency:c.currency,asOf,calendar:c.calendar}))
 }))
}
// A new fetch timestamp is not new material. Edition/content/period changes are.
export async function runOperatingCycle({dataset,asOf,calendarByCurrency,store,sourcePlan,sourceRegister,registry,processingRules,
 env={},mode='saved',capturesByCurrency={},acquire,execute=false,verifyStorage=false,preflightSource,preflightWriter,send,reconcile,dispatchHolds=[],
 clock=()=>Date.now(),deadlineMs=Date.now()+138*60*1000,owner=randomUUID(),testOnly=false}={}) {
 const configured=await store.operatingPolicy()
 if(!configured)return {status:'operating_configuration_missing',modelCalls:0,publicationApproved:false}
 const policy=assertOperatingPolicy(configured.policy),control=await store.control()
 const configurationHolds=operatingConfigurationHolds(policy,control)
 // Refresh free material before checking paid idempotency. An identical FX
 // snapshot must not hide a weekend release, revised body or recovered source.
 const prepared=await planAutomaticSupply({dataset,asOf,calendarByCurrency,store,policy,sourcePlan,sourceRegister,registry,processingRules,
  mode,capturesByCurrency,acquire:async args=>{
   const cached=store.sourceCache?await store.sourceCache(args.snapshot.currency,policy.processingRulesBinding):[]
   const feedback=researchFeedback(cached)
   const acquired=await (acquire??acquireRuntimeResearch)({...args,researchNeeds:feedback})
   if(!acquired.collection)return acquired
   const collection=retainRegisteredResearch({collection:acquired.collection,cache:cached,asOf:acquired.completedAt??asOf,sourcePlan:args.sourcePlan,sourceRegister:args.sourceRegister,
    requestedPeriods:acquired.researchWindow?.dates})
   return {...acquired,...reuseOperatingSources(collection,cached,policy.processingRulesBinding),researchFeedback:feedback}
  }})
 // Country history/correction/status availability holds are already bound to
 // that country's preparation. Shared policy/accounting errors remain global.
 const correctionHolds=[]
 const freshKey=fingerprint({version:'operating-cycle/2',reference:operatingReferenceIdentity(dataset,prepared.privateCountries,asOf),policy:policy.binding,
  countries:prepared.privateCountries.map(c=>({currency:c.currency,material:operatingMaterialHash(c)})),
  // A recovered preparation hold is new eligibility, even when neither FX nor
  // article bytes changed. Country case locks still prevent duplicate writing.
  decisions:prepared.rows.map(r=>({currency:r.currency,caseId:r.caseId,status:r.status,holds:[...r.holds].sort(),
   dispatch:prepared.privateCountries.find(c=>c.currency===r.currency)?.preparation?.dispatchBinding??null}))})
 // Accounting recovery is independent from a usable new article/price. It is
 // still opt-in execution under the configured policy, never part of plan.
 const recovery=execute&&!configurationHolds.length&&!dispatchHolds.length?await recoverOperatingCalls({store,reconcile}):null
 if(store.runtimeDocumentCapability){
  try{if((await store.runtimeDocumentCapability())?.version!=='runtime-document/2')throw Error('runtime_document_capability_missing')}
  catch(error){return {status:'operating_storage_failure',reason:safeReason(error),modelCalls:0,publicationApproved:false,
   incident:await storageState(store,'runtime',error,null,execute||verifyStorage)}}
 }
 // Shared recovery is part of the authorized worker. It never edits requests,
 // material, responses or costs and leaves a durable audit before re-queuing.
 if(execute&&!configurationHolds.length&&!dispatchHolds.length&&store.recoverTechnicalHolds){
  try{await store.recoverTechnicalHolds(configured.revision)}catch(error){
   return {status:'operating_storage_failure',stage:'runtime_recovery',reason:safeReason(error),modelCalls:0,publicationApproved:false,
    incident:await storageState(store,'runtime',error,null,true)}
  }
 }
 const current=await store.operatingBatch(freshKey)
 const pending=store.pendingBatches?await store.pendingBatches(configured.revision):[]
 if(pending.length>16)return {status:'operating_queue_capacity_hold',modelCalls:0,publicationApproved:false,collectionResults:prepared.collectionResults}
 const queue=[],seen=new Set(),recoveredCountries=new Set()
 for(const candidate of [...pending,...(current&&current.state!=='completed'?[current]:[])]){
  if(seen.has(candidate.batch_key))continue
  let frozen
  try{frozen=await restoreFrozenInput(candidate.payload,store,restoreOperatingPayload)}catch(error){
   return {status:'operating_storage_failure',stage:'restore',reason:safeReason(error),modelCalls:0,publicationApproved:false,
    incident:await storageState(store,'restore',error,null,execute||verifyStorage)}
  }
  if(Boolean(frozen.testOnly)!==Boolean(testOnly)||frozen.policyBinding!==policy.binding)continue
  if(frozen.resumeIdentity!==candidate.batch_key||fingerprint(frozen.dataset)!==frozen.datasetBinding)throw Error('operating_frozen_batch_changed')
  for(const row of frozen.prepared.rows)if(row.status!=='planned'
   &&prepared.rows.some(fresh=>fresh.currency===row.currency&&fresh.status==='planned'))recoveredCountries.add(row.currency)
  seen.add(candidate.batch_key);queue.push({...candidate,restoredInput:frozen})
 }
 // A single invocation keeps one shared spending/call ceiling across original
 // accounting envelopes. DB monthly, per-envelope and one-time gates still apply.
 const spending={calls:0,confirmedNano:0,unknown:false}
 const budgetedStore={...store,reserve:async request=>{
  if(spending.unknown)return {reserved:false,reason:'unresolved_or_inflight_call'}
  if(spending.calls>=policy.limits.maxCalls||spending.confirmedNano+request.reservedNano>Math.round(policy.limits.batchUsd*1e9))
   return {reserved:false,reason:'batch_budget_hold'}
  return store.reserve(request)
 },receive:async(...args)=>{
  try{await store.receive(...args)}catch(error){spending.unknown=true;throw error}
  const actual=args[2]
  if(!Number.isSafeInteger(actual)||actual<0)spending.unknown=true
  else spending.confirmedNano+=actual
 }}
 const guardedSend=typeof send==='function'?async args=>{
  spending.calls++
  try{return await send(args)}catch(error){spending.unknown=true;throw error}
 }:send
 const common={dataset,asOf,freshKey,refreshed:prepared,policy,configured,configurationHolds,correctionHolds,recovery,
  store:budgetedStore,spending,sourcePlan,sourceRegister,registry,processingRules,env,execute,verifyStorage,preflightSource,preflightWriter,
  send:guardedSend,reconcile,dispatchHolds,clock,deadlineMs,owner,testOnly}
 const results=[],owned=new Map(),freshCandidates=new Set(recoveredCountries)
 for(const previous of queue){
  const result=await executeOperatingEnvelope({...common,key:previous.batch_key,previous,owned})
  results.push(result)
  for(const row of result.rows??[])if(row.continuation?.resumeExact)owned.set(row.currency,previous.batch_key)
  for(const row of result.deferredCountries??[])if(/_superseded$/.test(row.reason))freshCandidates.add(row.currency)
  // A missing checkpoint cannot prove which countries are free to continue.
  if(spending.unknown||stopsCycle(result))break
 }
 const unresolved=spending.unknown||results.some(stopsCycle)
 const hasWaiting=results.some(r=>r.status==='paused')
 const availableFresh=[...freshCandidates].some(currency=>!owned.has(currency))
 // An unfinished country owns only its original envelope. A positively changed
 // country, or a recovered preparation, can progress under the recurring policy.
 // One-time policies never acquire a second envelope in this coordinator.
 if(!results.length||execute&&hasWaiting&&availableFresh&&!seen.has(freshKey)&&!unresolved&&policy.state==='operator_configured'){
  results.push(await executeOperatingEnvelope({...common,key:freshKey,previous:current,owned}))
 }
 if(results.length===1)return {...results[0],collectionResults:prepared.collectionResults}
 const rows=new Map()
 for(const result of results)for(const row of executionRows(result)){
  if(rows.has(row.currency)&&(row.status==='country_owned_by_prior_batch'||owned.has(row.currency)&&owned.get(row.currency)!==result.batchKey))continue
  rows.set(row.currency,row)
 }
 const recoveryRequired=spending.unknown||results.some(stopsCycle)
 return {version:'operational-report-cycle/2',status:recoveryRequired?'cost_or_execution_recovery_required':results.some(r=>r.status==='paused')?'paused':'completed_with_country_results',
  batchKey:results[0]?.batchKey??freshKey,rows:[...rows.values()],executionBatches:results,
  collectionResults:prepared.collectionResults,modelCalls:spending.calls,confirmedUsd:spending.confirmedNano/1e9,
  costUsd:spending.unknown?null:spending.confirmedNano/1e9,unknownCost:spending.unknown,
  publicationApproved:false,manualEdits:0,productionChanges:0}
}

async function executeOperatingEnvelope({dataset,asOf,freshKey,refreshed,policy,configured,configurationHolds,correctionHolds,recovery,
 store,spending,sourcePlan,sourceRegister,registry,processingRules,env,execute,verifyStorage,preflightSource,preflightWriter,send,reconcile,
 dispatchHolds,clock,deadlineMs,owner,testOnly,key,previous,owned}) {
 let prepared=refreshed,executionDataset=dataset
 const deferredFreshMaterial=!!previous&&key!==freshKey
 if(previous){
  if(previous.state==='completed')return {status:correctionHolds.length?'correction_recording_required':recovery?.status==='action_required'?'cost_reconciliation_required':'completed',batchKey:key,recovery,modelCalls:0,previousResult:previous.result,
   collectionResults:prepared.collectionResults,publicationApproved:false}
  if(previous.state==='cost_unresolved'){
   if(recovery?.status!=='clear')return {status:'cost_reconciliation_required',recovery,collectionResults:prepared.collectionResults,modelCalls:0,publicationApproved:false}
  }
  const saved=previous.restoredInput??await restoreFrozenInput(previous.payload,store,restoreOperatingPayload)
  if(saved.policyBinding!==policy.binding||saved.resumeIdentity!==key||!saved.dataset||fingerprint(saved.dataset)!==saved.datasetBinding)
   throw Error('operating_frozen_batch_changed')
  executionDataset=saved.dataset
  prepared=saved.prepared
  // Resume the exact old cutoff, rather than relabeling frozen evidence as new.
 }
 const holds=[...new Set([...configurationHolds,...prepared.holds,...dispatchHolds])]
 // A batch is an accounting envelope, not a reason to close every country's
 // unfinished work. Supersede only the changed country's exact old case after
 // reclaiming its original lease; unaffected countries finish in that envelope.
 const countryChanges=new Map()
 const countryRefresh=(old,materialEditions)=>{
  const fresh=refreshed.privateCountries.find(c=>c.currency===old.currency)
  const current=fresh?buildSharedDashboardPriceSnapshot({dataset,currency:old.currency,asOf:refreshed.asOf,calendar:fresh.calendar}):null
  return classifyCountryRefresh(old,fresh,{materialEditions,referenceUsable:current?.numericStatus==='pass'&&current.referenceBasis.status==='pass'&&fresh.calendar?.status==='confirmed',
   referenceChanged:!!fresh&&operatingReferenceIdentity(executionDataset,[old],prepared.asOf)!==operatingReferenceIdentity(dataset,[fresh],refreshed.asOf)})
 }
 if(previous)for(const old of prepared.privateCountries){
  const change=countryRefresh(old)
  if(change)countryChanges.set(old.currency,change)
 }
 const summary={status:holds.length?'configuration_or_input_hold':'prepared_not_executed',batchKey:key,
  holds,rows:prepared.rows.map(r=>({currency:r.currency,status:r.status,holds:r.holds,purpose:r.purpose,
   articles:r.sources.filter(s=>s.status==='request_prepared_not_dispatched').length,maximumUsd:r.maximumUsd})),
  collectionResults:refreshed.collectionResults,maximumUsd:prepared.maximumUsd,maxCalls:prepared.maxCalls,modelCalls:0,publicationApproved:false}
 if(recovery?.status==='action_required')return {...summary,status:'cost_reconciliation_required',recovery}
 if(prepared.rows.every(r=>r.status==='no_report_due'))return {...summary,status:'no_report_due',maximumUsd:0,maxCalls:0}
 const payload={version:'operating-frozen-input/1',datasetBinding:fingerprint(executionDataset),policyBinding:policy.binding,prepared,
  dataset:executionDataset,resumeIdentity:key,...(testOnly?{testOnly:true}:{} )}
 let encoded,storage
 try{
  encoded=encodeOperatingInput(payload)
  storage=await inspectOperatingStorage(encoded,store)
  }catch(error){const stats=encoded?.stats??error.storageStats??null
   return {...summary,status:'operating_storage_failure',stage:'preflight',reason:safeReason(error),storage:stats,
    incident:await storageState(store,'preflight',error,stats,execute||verifyStorage)}}
 summary.storage=storage
 // Inspect the immutable source requests, before claims/reservations. A failed
 // common endpoint is a technical hold, not six independent evidence failures.
 // A resumed envelope must first consult durable stage receipts. Its transport
 // rechecks only unsent stages; an outage must not block reuse of paid results.
 if(!verifyStorage&&!(execute&&previous)&&typeof preflightSource==='function'){
  const checks=[]
  for(const plan of prepared.sourcePlans??[]){
   let metadata
   try{
    metadata=await preflightSource(plan.extraction)
    inspectOriginalPlanEndpoint(plan,metadata.catalog,metadata.zdr)
    checks.push({status:'passed',stage:'extract',requestHash:plan.extraction.requestHash,
     checkedAt:metadata.checkedAt??new Date(clock()).toISOString(),metadataHash:metadata.metadataHash??fingerprint(metadata)})
   }catch(error){
    return {...summary,status:'source_endpoint_preflight_hold',holds:['model_processing_technical_hold'],
     endpointChecks:[...checks,{status:'held',...endpointDiagnostic(error,plan.extraction,metadata,clock)}],modelCalls:0,
     incident:await storageState(store,'endpoint',Error(error.endpointCategory?`source_endpoint_${error.endpointCategory}`:'source_endpoint_metadata_unavailable'),endpointDiagnostic(error,plan.extraction,metadata,clock),execute)}
   }
  }
  summary.endpointChecks=checks
 }
 if(verifyStorage){
  try{
   await storeOperatingInput(encoded,store)
   const incidents=await Promise.all(['preflight','write','restore'].map(stage=>storageState(store,stage,null,storage,true)))
   return {...summary,status:incidents.every(i=>i.recorded)?'storage_verified':'operating_storage_failure',
    verifiedInputHash:encoded.manifest.payloadHash,incidents,modelCalls:0,locksAcquired:false,budgetReserved:false}
  }catch(error){return {...summary,status:'operating_storage_failure',stage:'write',reason:safeReason(error),
   incident:await storageState(store,'write',error,storage,true)}}
 }
 if(!execute||holds.length)return summary
 if(runtimeMode(env)!=='currency')return {...summary,status:'runtime_disabled'}
 if(testOnly&&store.environment!=='local')throw Error('isolated_operating_fixture_required')
 if(typeof send!=='function'||typeof preflightSource!=='function'||typeof preflightWriter!=='function')throw Error('explicit_operating_adapters_required')
 const approval={...prepared.authorizationCandidate,authorized:true}
 let storedPayload
 try{
  if(previous){storedPayload=restoreOperatingPayload(previous.payload)}
  else {await storeOperatingInput(encoded,store);storedPayload=encoded.manifest}
  const incidents=await Promise.all(['preflight','write','restore'].map(stage=>storageState(store,stage,null,storage,true)))
  if(incidents.some(i=>!i.recorded))return {...summary,status:'operating_storage_failure',reason:'operating_incident_record_failed'}
 }catch(error){return {...summary,status:'operating_storage_failure',stage:'write',reason:safeReason(error),
  incident:await storageState(store,'write',error,storage,true)}}
 let batch
 try{batch=await store.claimBatch({key,owner,revision:configured.revision,payload:storedPayload,
  budgetNano:Math.round(policy.limits.batchUsd*1e9),maxCalls:policy.limits.maxCalls})}
 catch(error){return {...summary,status:'operating_storage_failure',stage:'link',reason:safeReason(error),
  incident:await storageState(store,'link',error,storage,true)}}
 if(!batch.claimed)return {...summary,status:batch.reason}
 const linked=await storageState(store,'link',null,storage,true)
 if(!linked.recorded){
  const result={...summary,status:'operating_storage_failure',reason:'operating_incident_record_failed'}
  await store.batchCheckpoint({key,owner,state:'paused',result:operatingCheckpoint(result,key)})
  return result
 }
 let currentCase=null,currentCountry=null,deadlineHeld=false
 const callsBefore=spending.calls,costBefore=spending.confirmedNano
 const heartbeat=async result=>store.batchCheckpoint({key,owner,state:'running',result:operatingCheckpoint(result,key)})
 const scoped={...store,reserve:async request=>{
  if(clock()+125000>=deadlineMs){deadlineHeld=true;return {reserved:false,reason:'execution_time_budget_wait'}}
  if(currentCountry){
   const hold=await currentSourceAdmissionHold({country:currentCountry,store,sourcePlan,sourceRegister,asOf:new Date(clock()).toISOString()})
   if(hold)return {reserved:false,reason:hold}
  }
  return store.reserve({...request,context:{...request.context,operatingBatchKey:key,operatingOwner:owner,operatingCaseKey:currentCase,
   ...(testOnly?{testOnly:true}:{} )}})
 }}
 let endpointChecked=false,endpointFailed=false
 const checkedSource=async request=>{
  let metadata
  try{metadata=await preflightSource(request);inspectNewsModelEndpoint(request,metadata.catalog,metadata.zdr);endpointChecked=true}
  catch(error){
   endpointFailed=true
   const recorded=await storageState(store,'endpoint',Error(error.endpointCategory?`source_endpoint_${error.endpointCategory}`:'source_endpoint_metadata_unavailable'),endpointDiagnostic(error,request,metadata,clock),true)
   if(!recorded.recorded)throw Error('operating_incident_record_failed')
   throw error
  }
  return metadata
 }
 try{
  const result=await runOperationalReportBatch({dataset:executionDataset,countries:prepared.privateCountries,asOf:prepared.asOf,store:scoped,env,approval,writer:policy.writer,reviewer:policy.destination.reviewProvider==='azure'?'sol':'sol-us',
   sourcePlan,sourceRegister,registry,processingRules,preflightSource:checkedSource,preflightWriter,send,reconcile,testOnly,sourceAdmissionState:prepared.sourceAdmissionState,
   excludedCountries:[...owned].filter(([,batchKey])=>batchKey!==key).map(([currency])=>currency),
   beforeCountry:async country=>{
    if(owned.has(country.currency)&&owned.get(country.currency)!==key)return {claimed:false,reason:'country_owned_by_prior_batch'}
    // Also cover frozen batches created before preparation was copied onto
    // each country. Resume must honour the original recorded country holds.
    const planned=prepared.rows.find(row=>row.currency===country.currency)
    if(!planned||planned.status!=='planned')return {claimed:false,reason:planned?.status??'country_preparation_hold'}
    currentCountry=country
    const admissionHold=await currentSourceAdmissionHold({country,store,sourcePlan,sourceRegister,asOf:new Date(clock()).toISOString()})
    if(admissionHold)return {claimed:false,reason:admissionHold}
    if(clock()+125000>=deadlineMs){deadlineHeld=true;return {claimed:false,reason:'execution_time_budget_wait'}}
    // Store private unreviewed backlog before this country's first POST.
    // A temporary write failure pauses this country through beforeCountry's
    // availability guard; it must not block other countries' valid work.
    await persistDeferredSources([country],store,policy.processingRulesBinding)
    const publications=runtimePublications(await store.history(country.currency),country.currency)
    if(publications.some(p=>Date.parse(p.publishedAt)>Date.parse(prepared.asOf)))return {claimed:false,reason:'new_publication_superseded_frozen_input'}
    const snapshot=buildSharedDashboardPriceSnapshot({dataset:executionDataset,currency:country.currency,asOf:prepared.asOf,calendar:country.calendar})
    const cadence=evaluatePublicationCadence({snapshot,asOf:prepared.asOf,calendar:country.calendar,publications,eventCandidateIds:country.eventCandidateIds??[]})
    if(cadence.status!=='research_candidate'||cadence.dataHolds.length||cadence.comparisonHolds.length)return {claimed:false,reason:'cadence_hold'}
    let reviewHolds=[],reviewLookupFailed=false
    if(previous&&store.sourceCache){
     let cached,task
     try{
      cached=await store.sourceCache(country.currency,policy.processingRulesBinding)
      task=store.input?await store.input(country.currency,snapshot.snapshotId):null
     }catch(error){
      if(!isTemporaryRuntimeReadError(error))throw error
      reviewLookupFailed=true
     }
     if(!reviewLookupFailed){
      if(task)assertStagedRuntimeInput(task)
      const exactTask=task?.currency===country.currency&&task.snapshot.snapshotId===snapshot.snapshotId&&task.cadence.caseId===cadence.caseId
      reviewHolds=frozenSourceReviewHolds(country,cached,policy.processingRulesBinding,
       exactTask?{materialEditions:task.materialEditions}:undefined)
      if(exactTask){
       const change=countryRefresh(country,task.materialEditions)
       if(change)countryChanges.set(country.currency,change)
       else countryChanges.delete(country.currency)
      }
     }
    }
    const materialHash=operatingMaterialHash(country)
    currentCase=fingerprint({caseId:cadence.caseId,materialHash,rules:policy.processingRulesBinding,authorization:policy.binding,
     ...(country.preparation?.dispatchBinding?{dispatch:country.preparation.dispatchBinding}:{}),
     reference:operatingReferenceIdentity(executionDataset,[country],prepared.asOf),
     ...(testOnly?{syntheticBatch:key}:{} )})
    await heartbeat({status:'checking_country',currency:country.currency})
    const claim=await store.claimCase({batchKey:key,owner,key:currentCase,caseId:cadence.caseId,currency:country.currency,materialHash})
    const change=reviewLookupFailed?'frozen_source_refresh_wait':reviewHolds.length
     ?reviewHolds.includes('source_review_withdrawn')?'frozen_source_review_withdrawn'
      :reviewHolds.includes('source_review_conflict')?'frozen_source_review_conflict':'frozen_source_review_revalidation_required'
     :countryChanges.get(country.currency)
    if(claim.claimed&&change){
     await store.finishCase({batchKey:key,owner,key:currentCase,state:/_refresh_wait$/.test(change)?'paused':'held',
      result:{status:change,holds:reviewHolds,publicationApproved:false,newInputDeferred:true}})
     return {claimed:false,reason:change,holds:reviewHolds}
    }
    return claim
   },
   afterCountry:async(country,row)=>store.finishCase({batchKey:key,owner,key:currentCase,
    state:deadlineHeld||row.continuation?.resumeExact?'paused':row.status==='pending_admin_review'?'pending_admin_review':'held',result:row}),
   checkpoint:async(currency,stage,value)=>{
    if(stage==='source-review'&&store.saveSourceReview){
     const country=prepared.privateCountries.find(c=>c.currency===currency)
     for(const record of operatingSourceRecords(country.collection,value,policy.processingRulesBinding))await store.saveSourceReview(record)
    }
    await heartbeat({status:stage,currency,resultStatus:value.status??null,runId:value.runId??null})
   }})
  const runtimeFaults=result.rows.filter(row=>[row.reason,...(row.sourceHolds??[]),...(row.holds??[])]
   .some(code=>/runtime_document_|unsafe_or_oversized_runtime_payload|unsafe_supply_payload/.test(code??'')))
  for(const row of runtimeFaults){
   const code=[row.reason,...(row.sourceHolds??[]),...(row.holds??[])].find(code=>/runtime_document_|unsafe_or_oversized_runtime_payload|unsafe_supply_payload/.test(code??''))
   const recorded=await storageState(store,'runtime',Error(`${code}_${row.currency.toLowerCase()}`),null,true)
   if(!recorded.recorded)throw Error('operating_incident_record_failed')
  }
  if(!runtimeFaults.length&&result.rows.some(row=>row.purpose)){
   const recorded=await storageState(store,'runtime',null,null,true)
   if(!recorded.recorded)throw Error('operating_incident_record_failed')
  }
  // One successful request cannot resolve another failed stage in the same run.
  if(endpointChecked&&!endpointFailed){
   const recorded=await storageState(store,'endpoint',null,null,true)
   if(!recorded.recorded)throw Error('operating_incident_record_failed')
  }
  // A temporary pre-dispatch wait preserves the exact batch/case for resume.
  const state=result.unknownCost?'cost_unresolved':deadlineHeld||result.rows.some(r=>r.continuation?.resumeExact)?'paused':'completed'
  const outcome={...result,collectionResults:refreshed.collectionResults}
  await store.batchCheckpoint({key,owner,state,result:operatingCheckpoint(outcome,key)})
  return {...outcome,status:state==='completed'?result.status:state,batchKey:key,deferredFreshMaterial,
   deferredCountries:[...countryChanges].map(([currency,reason])=>({currency,reason})),manualEdits:0}
 }catch(error){
  const accounted=!spending.unknown
  const result={status:'operating_execution_hold',reason:safeReason(error),holds:[safeReason(error)],
   modelCalls:accounted?spending.calls-callsBefore:null,costUsd:accounted?(spending.confirmedNano-costBefore)/1e9:null,
   collectionResults:refreshed.collectionResults,publicationApproved:false}
  await store.batchCheckpoint({key,owner,state:'paused',result:operatingCheckpoint(result,key)})
  return {...result,batchKey:key}
 }
}
