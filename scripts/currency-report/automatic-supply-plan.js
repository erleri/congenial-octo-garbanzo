// Automatic collection + offline operating plan. No model send, spending
// reservation, credential loading, DB activation or publication. Live public
// acquisition is an explicit caller choice; saved mode is the default.
import {REPORT_CURRENCIES,buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {evaluatePublicationCadence} from './publication-cadence.js'
import {runtimePublications} from './runtime-store.js'
import {acquireRuntimeResearch,previousWeekdayTarget,emptySupplyCache,latestCollectedCommentaryTarget} from './runtime-supply.js'
import {operatingMaterialHash,newMaterialCandidates,newOfficialMaterialCandidates} from './operating-source-cache.js'
import {prepareOperatingBatch} from './operating-batch-plan.js'
import {recordPublishedCorrections} from './published-corrections.js'

export async function planAutomaticSupply({dataset,asOf,calendarByCurrency,store,policy,sourcePlan,sourceRegister,registry,processingRules,
 cachedByCurrency={},mode='saved',capturesByCurrency={},acquire=acquireRuntimeResearch,checkpoint=async()=>{}}) {
 if(!['saved','live'].includes(mode)||!store?.history||!calendarByCurrency)throw Error('automatic_supply_configuration_required')
 const countries=[],publicationsByCurrency={},collectionResults=[]
 let cutoff=asOf
 for(const currency of REPORT_CURRENCIES){
  const calendar=calendarByCurrency[currency]??{status:'unverified'}
  let target=previousWeekdayTarget(dataset.baseDate)
  const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf,calendar})
  const cached=cachedByCurrency[currency]??{}
  const empty={version:'selected-source-collection/1',currency,asOf,originals:[],reviewQueue:[],outcomes:[]}
  let collection=empty,status='not_due_or_reference_hold',acquisitionError=null,savedSourceReviews=cached.savedSourceReviews??[],eventCandidateIds=[],officialBackground=null,researchWindow=null,researchFeedback=null,historyRows=null
  try{
   historyRows=await store.history(currency)
   try{publicationsByCurrency[currency]=runtimePublications(historyRows,currency)}catch{acquisitionError='published_anchor_snapshot_unavailable'}
   // Free discovery is independent of price/cadence eligibility. Failed or old
   // reference data still blocks paid writing, not collection of new evidence.
   {
    const acquired=await acquire({snapshot,asOf,commentaryTarget:target,sourcePlan,sourceRegister,mode,
     captures:capturesByCurrency[currency]??[],checkpoint:(stage,value)=>checkpoint(currency,stage,value)})
    if(acquired.collection)collection=acquired.collection
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
   acquisitionError=/^[a-z0-9_]+$/.test(error.message??'')?error.message:'automatic_collection_failed'
   status='collection_or_history_failed'
  }
  const correctionCheck=historyRows?await recordPublishedCorrections({currency,history:historyRows,collection,
   admission:officialBackground?.admission,asOf:cutoff},store):{status:'correction_history_unavailable'}
  const handoff=cached.handoff??emptySupplyCache({snapshot,commentaryTarget:target,asOf})
  countries.push({currency,calendar,commentaryTarget:target,handoff,collection,eventCandidateIds,officialBackground,
   ...(cached.claimTypingReview?{claimTypingReview:cached.claimTypingReview}:{}),
   ...(savedSourceReviews.length?{savedSourceReviews}:{}),...(acquisitionError?{acquisitionError}:{})})
  const cadence=publicationsByCurrency[currency]?evaluatePublicationCadence({snapshot,asOf:cutoff,calendar,publications:publicationsByCurrency[currency],eventCandidateIds}):null
  const publicationDecision=cadence?{status:cadence.status,cumulativePct:cadence.cumulativePct,thresholdPct:cadence.thresholdPct,
   periodicDueDate:cadence.periodicDueDate,dataHolds:cadence.dataHolds,comparisonHolds:cadence.comparisonHolds,comparisonDetails:cadence.comparisonDetails}:null
  const row={currency,status,acquisitionError,correctionCheck,candidates:collection.reviewQueue.length,cadenceStatus:cadence?.status??'history_unavailable',publicationDecision,researchWindow,researchFeedback,
   referenceStatus:calendar.reason??calendar.referenceState?.status??calendar.status,
   sourceStates:(collection.outcomes??[]).map(o=>({sourceId:o.sourceId,status:o.status})),
   lookupFailures:(collection.outcomes??[]).filter(o=>['access_failed','extraction_failed','discovery_incomplete'].includes(o.status))
    .map(o=>({sourceId:o.sourceId,status:o.status,reason:o.reason??null})),
   officialBackground:officialBackground?{status:officialBackground.status,states:officialBackground.states,admissionStatus:officialBackground.admissionStatus,
    inputState:officialBackground.inputState??null,inputIssues:officialBackground.inputIssues??[],
    cache:officialBackground.cache??null,coverage:officialBackground.coverage??null,
    admittedStatistics:officialBackground.admission?.admitted.length??0,
    admissionReasons:[...new Set((officialBackground.admission?.rows??[]).map(r=>r.reason).filter(Boolean))]}:null,
   newMaterialMeaning:'research_candidate_not_verified_important_event'}
  row.newMaterialCandidates=eventCandidateIds.length
  collectionResults.push(row);await checkpoint(currency,'collection-state',row)
 }
 const prepared=prepareOperatingBatch({policy,dataset,countries,asOf:cutoff,publicationsByCurrency,sourcePlan,sourceRegister,registry,processingRules,
  control:await store.control()})
 return {...prepared,collectionResults,asOf:cutoff,acquisitionMode:mode,
  modelCalls:0,publicationApproved:false,standingPolicyActivated:false}
}
