// Offline batch handoff over the existing country and writer validators.
// A saved case, an acquisition probe and publication approval are independent.
import {validDate} from './core.js'
import {fingerprint} from './research-harness.js'
import {prepareCountryMaterials,PREPARATION_CURRENCIES} from './country-material-preparation.js'
import {assessFxCauseInput} from './fx-cause-input.js'
import {prepareEventTrial} from './lifecycle-control.js'
import {projectFxWritingBackground} from './fx-writing-background.js'
import {prepareSelectedReviewBatch} from './selected-review-batch.js'
import {buildSharedDashboardPriceSnapshot,assessSharedReportContract,SHARED_REPORT_RULE_VERSION,COUNTRY_REPORT_PROFILES,
 REPORT_REFERENCE_POLICY,SHARED_REFERENCE_WRITING_GUIDE} from './shared-price-contract.js'
import {reconnectReferenceMaterials} from './reference-materials.js'

export const SIX_CURRENCY_PREPARATION_VERSION='six-currency-preparation/1'
const safeError=e=>/^[a-z0-9_]+$/i.test(e?.message??'')?e.message:'saved_case_validation_failed'

export const SIX_CURRENCY_CURRENT_VERSION='six-currency-preparation/2'

// Default new preparation requires a shared dataset. Old price paths remain
// available only through an explicit replay mode; never silently fall back.
export function prepareSixCurrencyInputs({asOf,cases,dataset,mode='shared_dashboard'}) {
 if(mode==='historical_replay')return {...replaySavedSixCurrencyInputs({asOf,cases}),mode,activePolicyEligible:false}
 if(mode!=='shared_dashboard'||!dataset)throw new Error('shared_dashboard_dataset_required')
 const replay=replaySavedSixCurrencyInputs({asOf,cases})
 const results=[],handoffs=[]
 for(const legacy of replay.results) {
  try {
   const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency:legacy.currency,asOf})
   const assessment=assessSharedReportContract({snapshot,legacyResult:legacy})
   const sourceCase=cases.find(c=>c.currency===legacy.currency)
   let materialConnection={status:'commentary_target_required',reason:'select_market_commentary_date_without_inferring_a_reference_rate_session'}
   if(sourceCase.commentaryDate){
    try{
     if(sourceCase.materialReviewReadFailed)throw new Error('saved_material_review_unreadable')
     materialConnection=reconnectReferenceMaterials({input:sourceCase.input,kind:sourceCase.kind,snapshot,
      commentaryDate:sourceCase.commentaryDate,asOf,review:sourceCase.materialReview})}
    catch(error){materialConnection={status:'saved_material_invalid',reason:safeError(error)}}
   }
   if(materialConnection.version){
    const set=(id,status,reason)=>Object.assign(assessment.checks.find(c=>c.id===id),{status,reason})
    const rows=Object.values(materialConnection.sections).flat()
    set('evidence_period_and_scope',materialConnection.sections.market_observation.length?'pass':'hold',
     'explicit_commentary_session_preserved_older_market_claims_archived_reference_date_not_relabelled')
    set('source_use_and_attribution',rows.length&&rows.every(r=>r.sourceUses.external_model.status==='allowed')
     &&!materialConnection.held.length?'pass':'hold','saved_use_decisions_and_exact_delivery_conditions_rechecked_public_approval_separate')
    set('consumer_context_separate','pass','reviewed_background_keeps_its_actual_period_and_cannot_be_a_market_driver')
    assessment.materialPreparation=materialConnection.status
    assessment.holds=assessment.checks.filter(c=>c.status!=='pass').map(c=>c.id)
   }
   results.push({currency:legacy.currency,status:'shared_price_connected_writer_held',
    ruleVersion:SHARED_REPORT_RULE_VERSION,price:{snapshotId:snapshot.snapshotId,baseDate:snapshot.baseDate,
     value:snapshot.current?.value??null,previousValue:snapshot.previous?.value??null,
     changePct:snapshot.changePct,numericStatus:snapshot.numericStatus,numericHolds:snapshot.numericHolds,
     referenceBasis:snapshot.referenceBasis,basis:snapshot.basis},
    assessment,legacyCase:{status:legacy.status,date:legacy.caseDate??null,holds:legacy.holds??[],
     reason:legacy.reason??null,consumer:legacy.consumer??null,notApprovalForSharedBasis:true},
    acquisition:legacy.acquisition,materials:{status:materialConnection.status,reason:materialConnection.reason??null,
     commentaryDate:materialConnection.commentaryDate??null,
     counts:materialConnection.sections?Object.fromEntries(Object.entries(materialConnection.sections).map(([role,rows])=>[role,rows.length])):null,
     archiveCount:materialConnection.archive?.length??0,heldCount:materialConnection.held?.length??0,
     holds:materialConnection.holds??[],contentReview:materialConnection.contentReview??null,
     preparationReview:materialConnection.preparationReview??null},
    paidCallAuthorized:false,publicationApproved:false})
   handoffs.push({currency:legacy.currency,handoff:{version:SIX_CURRENCY_CURRENT_VERSION,
    ruleVersion:SHARED_REPORT_RULE_VERSION,profile:COUNTRY_REPORT_PROFILES[legacy.currency],
    reportPriceSnapshot:snapshot,referencePolicy:REPORT_REFERENCE_POLICY,priceWritingGuide:SHARED_REFERENCE_WRITING_GUIDE,
    assessment,materialConnection,evidenceReuse:'existing_cards_require_new_period_and_claim_binding',
    // Old packet facts/series/priceBasis and spent approvals are deliberately absent.
    request:null,paidCallAuthorized:false,publicationApproved:false}})
  }catch(error){results.push({currency:legacy.currency,status:'shared_price_invalid',reason:safeError(error),
   legacyCase:{status:legacy.status},paidCallAuthorized:false,publicationApproved:false})}
 }
 return {version:SIX_CURRENCY_CURRENT_VERSION,ruleVersion:SHARED_REPORT_RULE_VERSION,asOf,mode,results,handoffs,
  networkCalls:0,modelCalls:0,newPaidCostUsd:0,paidCallAuthorized:false,publicationApproved:false}
}

function replaySavedSixCurrencyInputs({asOf,cases}) {
 if(!validDate(asOf?.slice(0,10))||!Number.isFinite(Date.parse(asOf))||!/(Z|[+-]\d{2}:\d{2})$/.test(asOf)
  ||!Array.isArray(cases)||cases.length!==6||new Set(cases.map(c=>c.currency)).size!==6
  ||cases.some(c=>!PREPARATION_CURRENCIES.includes(c.currency)||!['reviewed_fx','country_materials'].includes(c.kind)))
  throw new Error('six_currency_manifest_required')
 const before=fingerprint(cases),results=[],handoffs=[]
 for(const c of cases) {
  let acquisition={status:c.collectionReadFailed?'collection_replay_failed':'not_replayed',
   ...(c.collectionReadFailed?{reason:'saved_collection_unreadable'}:{}),automaticContentReviewPerformed:false}
  if(c.collection) {
   try {
    if(c.collection.currency!==c.currency)throw new Error('collection_currency_mismatch')
    const review=prepareSelectedReviewBatch({collection:c.collection,receipts:c.receipts??[],newsResponses:c.newsResponses??[]})
    acquisition={status:'saved_collection_replayed',automaticContentReviewPerformed:false,
     collectionStartedAt:c.collection.startedAt??null,collectionTargetDate:c.collection.baseDate??null,
     outcomes:review.collectionOutcomes,
     reviewItems:review.items.map(({evidence:_evidence,...item})=>item),
     caseEvidenceAutomaticallyReplaced:false}
   }catch(error){acquisition={status:'collection_replay_failed',reason:safeError(error),automaticContentReviewPerformed:false}}
  }
  try {
   const input=c.input,packet=input?.packet
   if(packet?.currency!==c.currency||!validDate(packet.baseDate)||!validDate(packet.observedDate)
    ||packet.observedDate>packet.baseDate||packet.baseDate>asOf.slice(0,10))throw new Error('case_currency_date_mismatch')
   let handoff,holds,consumer,price,status
   if(c.kind==='reviewed_fx') {
    // Never inherit a spent approval, stored plan, cached assessment or score.
    const data=structuredClone(Object.fromEntries(['packet','dossier','fxCauseInput','decision','writer']
     .filter(k=>input[k]!==undefined).map(k=>[k,input[k]])))
    if(!data.fxCauseInput)throw new Error('explicit_fx_purpose_review_required')
    data.fxCauseInput={review:data.fxCauseInput.review,sourceUse:data.fxCauseInput.sourceUse}
    const assessment=assessFxCauseInput({packet:data.packet,dossier:data.dossier,...data.fxCauseInput})
    const plan=prepareEventTrial(data),background=projectFxWritingBackground(data.packet)
    holds=[...new Set([...assessment.holds,...(plan.holds??[]),...(plan.holdReasons??[]),
     ...(plan.status!=='prepared_not_called'?[plan.status]:[])])]
    status=holds.length?'saved_case_writer_held':'saved_case_request_prepared'
    consumer=background?.consumerContext||background?.reviewedNotes?.length?'reviewed_background_available':'no_reviewed_business_background'
    price=assessment.priceMovement
    handoff={...data,assessment,plan,paidCallAuthorized:false,publicationApproved:false}
   }else {
    const prepared=prepareCountryMaterials(structuredClone(input))
    holds=prepared.holds;status='saved_case_writer_held'
    // Country material validation is a handoff, never a substitute for the
    // purpose-specific price/cause compiler or a fresh eligibility decision.
    if(!holds.length)holds=['purpose_specific_writer_preparation_required']
    consumer=prepared.sections.consumer_background.length?'reviewed_material_background_only':'no_reviewed_business_background'
    price=prepared.priceConnection?{status:prepared.priceConnection.status,
     holds:prepared.priceConnection.holds,strictWriterSupported:prepared.priceConnection.strictWriterSupported}:null
    handoff={prepared,paidCallAuthorized:false,publicationApproved:false}
   }
   results.push({currency:c.currency,kind:c.kind,status,caseDate:packet.baseDate,sessionDate:packet.observedDate,
    ageInCalendarDays:Math.floor((Date.parse(asOf.slice(0,10))-Date.parse(packet.observedDate))/86400000),
    caseRebasedToAuditDate:false,holds,consumer,price,acquisition,
    semanticReview:'saved_bound_reviews_revalidated_not_new_independent_review',
    repeatableAutomaticResearchReady:false,providerAvailability:'not_checked_offline',paidCallAuthorized:false,publicationApproved:false})
   handoffs.push({currency:c.currency,handoff})
  }catch(error){results.push({currency:c.currency,status:'saved_case_invalid',reason:safeError(error),acquisition,
   paidCallAuthorized:false,publicationApproved:false,repeatableAutomaticResearchReady:false})}
 }
 if(before!==fingerprint(cases))throw new Error('six_currency_input_mutated')
 return {version:SIX_CURRENCY_PREPARATION_VERSION,asOf,results,handoffs,
  networkCalls:0,modelCalls:0,newPaidCostUsd:0,paidCallAuthorized:false,publicationApproved:false}
}
