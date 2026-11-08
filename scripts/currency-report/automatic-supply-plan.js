// Automatic collection + offline operating plan. No model send, spending
// reservation, credential loading, DB activation or publication. Live public
// acquisition is an explicit caller choice; saved mode is the default.
import {REPORT_CURRENCIES,buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {evaluatePublicationCadence} from './publication-cadence.js'
import {runtimePublications,isFatalRuntimeStoreError} from './runtime-store.js'
import {acquireRuntimeResearch,previousWeekdayTarget,emptySupplyCache,latestCollectedCommentaryTarget} from './runtime-supply.js'
import {operatingMaterialHash,newMaterialCandidates,newOfficialMaterialCandidates} from './operating-source-cache.js'
import {prepareOperatingBatch} from './operating-batch-plan.js'
import {recordPublishedCorrections} from './published-corrections.js'
import {collectionDiagnostics} from './collection-diagnostics.js'
import {fingerprint} from './research-harness.js'
import {compileResearchSourceCatalog} from './research-source-selection.js'
import {isolateUnregisteredArticles} from './registered-collection.js'
import {updateSourceMonitor} from './source-candidates.js'
import {probeSourceCandidates} from './source-candidate-probe.js'
import {admittedSourceCatalog} from './source-admission-catalog.js'
import {inspectSourceAdmission,sourceAdmissionHash} from './source-admission.js'
import {matchingProcessingRestrictions} from './material-processing.js'
import {refreshSourceTerms} from './source-scope-policy.js'

export async function planAutomaticSupply({dataset,asOf,calendarByCurrency,store,policy,sourcePlan,sourceRegister,registry,processingRules,
 cachedByCurrency={},mode='saved',capturesByCurrency={},acquire=acquireRuntimeResearch,checkpoint=async()=>{},probeCandidates=probeSourceCandidates}) {
 if(!['saved','live'].includes(mode)||!store?.history||!calendarByCurrency)throw Error('automatic_supply_configuration_required')
 const countries=[],publicationsByCurrency={},collectionResults=[]
 let sourceAdmissionState=null,sourceAdmissionLoadFailed=false
 if(store.sourceAdmissions)try{sourceAdmissionState=await store.sourceAdmissions()}catch{sourceAdmissionLoadFailed=true}
 let sourceTermsResults=[]
 let expanded=null
 if(sourceAdmissionState)try{
  // Validate bounds before free checks. A broken optional configuration must
  // neither expand network work nor block the registered country pipeline.
  admittedSourceCatalog({sourcePlan,sourceRegister,state:sourceAdmissionState,asOf})
  const refreshed=await refreshSourceTerms({state:sourceAdmissionState,store,asOf,mode,capturesByCurrency})
  sourceAdmissionState=refreshed.state;sourceTermsResults=refreshed.results
  expanded=admittedSourceCatalog({sourcePlan,sourceRegister,state:sourceAdmissionState,asOf})
 }
 catch{sourceAdmissionState=null;sourceAdmissionLoadFailed=true}
 const effectivePlan=expanded?.sourcePlan??sourcePlan,effectiveRegister=expanded?.sourceRegister??sourceRegister
 const catalog=compileResearchSourceCatalog(effectivePlan,effectiveRegister)
 let cutoff=asOf
 for(const currency of REPORT_CURRENCIES){
  const calendar=calendarByCurrency[currency]??{status:'unverified'}
  let target=previousWeekdayTarget(dataset.baseDate)
  const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf,calendar})
  const cached=cachedByCurrency[currency]??{}
  const empty={version:'selected-source-collection/1',currency,asOf,originals:[],reviewQueue:[],outcomes:[]}
  let monitorCollection=empty
  let collection=empty,status='not_due_or_reference_hold',acquisitionError=null,savedSourceReviews=cached.savedSourceReviews??[],eventCandidateIds=[],officialBackground=null,researchWindow=null,researchFeedback=null,historyRows=null,sourceMonitor=null,sourceMonitorStatus='not_recorded'
  try{
   historyRows=await store.history(currency)
   try{publicationsByCurrency[currency]=runtimePublications(historyRows,currency)}catch{acquisitionError='published_anchor_snapshot_unavailable'}
  }catch(error){
   if(isFatalRuntimeStoreError(error))throw error
   acquisitionError='published_history_unavailable'
  }
  try{
   // Free discovery is independent of price/cadence eligibility. Failed or old
   // reference data still blocks paid writing, not collection of new evidence.
   {
    const acquired=await acquire({snapshot,asOf,commentaryTarget:target,sourcePlan:effectivePlan,sourceRegister:effectiveRegister,mode,
     captures:capturesByCurrency[currency]??[],checkpoint:(stage,value)=>checkpoint(currency,stage,value)})
    if(acquired.collection){monitorCollection=acquired.collection;collection=isolateUnregisteredArticles(acquired.collection,catalog).collection}
    officialBackground=acquired.officialBackground??null;researchWindow=acquired.researchWindow??null;researchFeedback=acquired.researchFeedback??null
    target=acquired.commentaryTarget??latestCollectedCommentaryTarget(collection,target,acquired.completedAt??asOf)
    if(acquired.savedSourceReviews)savedSourceReviews=acquired.savedSourceReviews
    if(acquired.completedAt){
     if(!Number.isFinite(Date.parse(acquired.completedAt))||Date.parse(acquired.completedAt)<Date.parse(asOf))throw Error('acquisition_completion_time_invalid')
     if(Date.parse(acquired.completedAt)>Date.parse(cutoff))cutoff=acquired.completedAt
    }
    status=acquired.collection?'collection_returned_not_approved':acquired.reason??'no_collection_returned'
    const newOriginals=newMaterialCandidates(collection,publicationsByCurrency[currency]??[])
    const newStatistics=newOfficialMaterialCandidates(officialBackground?.admission,publicationsByCurrency[currency]??[])
    if(newOriginals.length||newStatistics.length)eventCandidateIds=[`material-${operatingMaterialHash({collection:{originals:newOriginals},
     ...(newStatistics.length?{officialBackground}:{} )}).slice(0,40)}`]
   }
  }catch(error){
   if(isFatalRuntimeStoreError(error))throw error
   acquisitionError=/^[a-z0-9_]+$/.test(error.message??'')?error.message:'automatic_collection_failed'
   status='collection_or_history_failed'
  }
  // Candidate diagnostics remain independent of acquisition/writing success.
  // A failed monitor never turns registered evidence into an approval or hold.
  try{
   const previous=store.sourceMonitor?await store.sourceMonitor(currency):cached.sourceMonitor??null
   sourceMonitor=updateSourceMonitor({currency,collection:monitorCollection,catalog,previous,researchFeedback,asOf:cutoff,captures:capturesByCurrency[currency]??[]})
   const observe=async observation=>{
    if(!store.saveSourceProof)return
    const checkedAt=new Date(Math.max(Date.parse(cutoff),Date.parse(observation.collectedAt))).toISOString()
    const restrictions=['all_external_text','full_article'].flatMap(target=>matchingProcessingRestrictions({rules:processingRules,url:observation.url,target,evaluatedOn:checkedAt.slice(0,10)}))
    const u=new URL(observation.url)
    restrictions.push(...(registry?.policies??[]).filter(p=>p.origin===u.origin&&u.pathname.startsWith(p.pathPrefix)
     &&p.reviewedUse?.uses?.external_model?.status==='denied'))
    const proof=inspectSourceAdmission({...observation,currency,asOf:checkedAt,restrictions})
    if(await store.saveSourceProof(proof)===false)throw Error('source_proof_capacity_or_concurrency')
   }
   if(mode==='saved'&&sourceMonitor.gaps.length){
    const captures=capturesByCurrency[currency]??[]
    const candidate=sourceMonitor.candidates.find(c=>!c.nextCheckAt||c.lastCheckedAt===sourceMonitor.checkedAt)
    if(candidate){
     const latest=url=>{
      const rows=captures.filter(c=>c.url===url&&c.httpStatus===200&&Date.parse(c.collectedAt)<=Date.parse(cutoff)&&typeof c.text==='string'&&sourceAdmissionHash(c.text)===c.sha256)
       .sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt))
      if(rows[0]&&rows.some(r=>r.collectedAt===rows[0].collectedAt&&r.sha256!==rows[0].sha256))throw Error('candidate_capture_conflict')
      return rows[0]
     }
     const capture=latest(candidate.sampleUrl),robots=latest(new URL('/robots.txt',candidate.sampleUrl).href)
     if(capture&&robots)await observe({url:capture.url,html:capture.text,robotsText:robots.text,collectedAt:capture.collectedAt})
    }
   }
   sourceMonitor=await probeCandidates(sourceMonitor,{mode,observe})
   if(store.saveSourceMonitor){
    const saved=await store.saveSourceMonitor(sourceMonitor,previous?.binding??null)
    sourceMonitorStatus=saved===false?'concurrent_update_deferred':'recorded'
   }else sourceMonitorStatus='inspection_only'
  }catch{sourceMonitorStatus='storage_or_validation_failed'}
  const correctionCheck=historyRows?await recordPublishedCorrections({currency,history:historyRows,collection,
   admission:officialBackground?.admission,asOf:cutoff},store):{status:'correction_history_unavailable'}
  const handoff=cached.handoff??emptySupplyCache({snapshot,commentaryTarget:target,asOf})
  if(['correction_storage_failed','correction_storage_unavailable','correction_history_unavailable','correction_input_check_failed'].includes(correctionCheck.status))
   acquisitionError??=correctionCheck.status
  const cadence=publicationsByCurrency[currency]?evaluatePublicationCadence({snapshot,asOf:cutoff,calendar,publications:publicationsByCurrency[currency],eventCandidateIds}):null
  const publicationDecision=cadence?{status:cadence.status,cumulativePct:cadence.cumulativePct,thresholdPct:cadence.thresholdPct,
   periodicDueDate:cadence.periodicDueDate,dataHolds:cadence.dataHolds,comparisonHolds:cadence.comparisonHolds,comparisonDetails:cadence.comparisonDetails}:null
  const row={currency,status,acquisitionError,correctionCheck,candidates:collection.reviewQueue.length,cadenceStatus:cadence?.status??'history_unavailable',publicationDecision,researchWindow,researchFeedback,sourceMonitor,sourceMonitorStatus,
   referenceStatus:calendar.reason??calendar.referenceState?.status??calendar.status,
   sourceStates:[...(collection.outcomes??[]).map(o=>({sourceId:o.sourceId,status:o.status})),
    ...(sourceAdmissionLoadFailed?[{sourceId:'source-admission',status:'source_admission_settings_unavailable'}]:[])],
   ...collectionDiagnostics(collection),
   sourceMonitorNetworkCalls:sourceMonitor?.networkCalls??0,
   officialBackground:officialBackground?{status:officialBackground.status,states:officialBackground.states,admissionStatus:officialBackground.admissionStatus,
    inputState:officialBackground.inputState??null,inputIssues:officialBackground.inputIssues??[],
    releaseLookups:officialBackground.releaseLookups??[],
    cache:officialBackground.cache??null,coverage:officialBackground.coverage??null,
    admittedStatistics:officialBackground.admission?.admitted.length??0,
    admissionReasons:[...new Set((officialBackground.admission?.rows??[]).map(r=>r.reason).filter(Boolean))]}:null,
   newMaterialMeaning:'research_candidate_not_verified_important_event'}
  row.newMaterialCandidates=eventCandidateIds.length
  if(store.supplyCheck){
   const sources=new Map()
   if(sourceMonitorStatus==='storage_or_validation_failed')sources.set('source-monitor',new Set(['source_monitor_storage_failed']))
   if(sourceMonitorStatus==='concurrent_update_deferred')sources.set('source-monitor',new Set(['source_monitor_update_deferred']))
   for(const item of [...row.sourceStates,...(row.officialBackground?.states??[]).flatMap(s=>s.sourceStates??[])]){
    if(!sources.has(item.sourceId))sources.set(item.sourceId,new Set())
    sources.get(item.sourceId).add(item.status)
   }
   const result={status:row.status,baseDate:dataset.baseDate,
    dataStatus:row.publicationDecision?.comparisonHolds.length?'published_reference_conflict':row.referenceStatus,
    qualityStatus:'not_evaluated',candidates:row.candidates,officialAdmission:row.officialBackground?.admissionStatus??'not_attempted',
    sources:[...sources].slice(0,24).map(([sourceId,statuses])=>({sourceId,statuses:[...statuses].slice(0,6)}))}
   try{await store.supplyCheck({key:fingerprint({currency,checkedAt:cutoff,result}),currency,checkedAt:cutoff,result})}
   catch(error){if(isFatalRuntimeStoreError(error))throw error
    acquisitionError??='supply_status_storage_failed';row.supplyStatus='storage_failed'}
  }
  row.acquisitionError=acquisitionError
  countries.push({currency,calendar,commentaryTarget:target,handoff,collection,eventCandidateIds,officialBackground,
   ...(cached.claimTypingReview?{claimTypingReview:cached.claimTypingReview}:{}),
   ...(savedSourceReviews.length?{savedSourceReviews}:{}),...(acquisitionError?{acquisitionError}:{})})
  collectionResults.push(row);await checkpoint(currency,'collection-state',row)
 }
 const prepared=prepareOperatingBatch({policy,dataset,countries,asOf:cutoff,publicationsByCurrency,sourcePlan,sourceRegister,registry,processingRules,
  control:await store.control(),...(sourceAdmissionState?{sourceAdmissionState}:{})})
 return {...prepared,collectionResults,sourceTermsResults,asOf:cutoff,acquisitionMode:mode,
  modelCalls:0,publicationApproved:false,standingPolicyActivated:false}
}
