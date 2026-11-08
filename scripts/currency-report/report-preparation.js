// Final pre-writing assembly. No transport, credentials, model, DB or report writes.
import {prepareResearchMaterials,priceUseResource} from './research-materials.js'
import {inspectSourceUses,sourceUseBinding} from './source-use.js'
import {fingerprint} from './research-harness.js'
import {decideGeneration} from './generation-decision.js'
import {PROMPT_VERSION} from './openrouter.js'
import {RULE_VERSION} from './rules.js'
import {ECONOMIC_VERSION} from './economic-update.js'
import {CLAIM_REVIEW_VERSION,CLAIM_REVIEW_INSTRUCTIONS} from './claim-review.js'
import {EDITORIAL_VERSION} from './editorial.js'

export const PREPARATION_VERSION='report-preparation/1'
export const WRITING_ROLES=Object.freeze({
  code:{owns:['report_and_transaction_dates','price_calculations_and_direction','original_identity_and_revision','source_use_conditions',
    'period_and_scope_compatibility','duplicate_history_checks','schema_and_reference_validation'],
    cannotDecide:['claim_entailment_by_hash','causality_from_comovement','semantic_novelty_by_price_alone']},
  writer:{owns:['source_attributed_explanation','reader_summary','bounded_sales_environment_context'],
    cannotDo:['search_or_invent_sources','calculate_new_values','change_period_or_price_basis','invent_missing_causes','company_sales_estimates','price_or_promotion_instructions']},
  reviewer:{owns:['every_subclaim_supported_by_original','causal_and_scope_limits','material_counterevidence','new_explanation_value'],
    existingContract:CLAIM_REVIEW_VERSION,requiredCorrections:['observation_time','source_authority','claim_scope','evidence_conflict','advice'],
    editorialRefinements:['supported_but_abstract_title','wordiness','repeated_nonmaterial_caveats'],
    cannotDo:['grant_permission','approve_publication','treat_style_as_fact_error']},
  administrator:{owns:['approve_or_reject_for_publication'],cannotDo:['bypass_source_or_privacy_failures']},
})
const signature=p=>{
  const b=p.marketData?.reportPriceBasis
  return b&&{currency:p.currency,sourceAdapter:b.sourceAdapter,provider:b.provider,seriesId:b.seriesId,
    priceKind:b.priceKind,dateBasis:b.dateBasis,timeZone:b.timeZone,methodology:b.methodology?.sha256,
    attribution:b.attribution}
}

export function prepareLatestReportInput({priceInput,previousPrepared,reviewedMonthly,sourceUse,refresh,asOf,history=[],reportCatalogue}) {
  if(priceInput?.version!=='bcch-report-input/1'||priceInput.sourceAdapter!=='bcch-bde-api/1'
    || reviewedMonthly?.version!=='chile-monthly-review-run/1'||!Array.isArray(reviewedMonthly.bundles)
    || refresh?.version!=='chile-monthly-refresh/1'||refresh.asOf!==asOf?.slice(0,10)
    || !Array.isArray(refresh.sources)||refresh.sources.length!==2
    || new Set(refresh.sources.map(s=>s.sourceId)).size!==2
    || refresh.sources.some(s=>!['cl-retail','cl-pay'].includes(s.sourceId))
    || !Array.isArray(refresh.documents)||refresh.documents.length>4||!Array.isArray(history))
    throw new Error('invalid_report_preparation_input')
  const baselineResources=[priceUseResource(previousPrepared.packet),...previousPrepared.packet.evidence,
    ...reviewedMonthly.bundles.flatMap(b=>b.evidence)]
  const policies=inspectSourceUses({resources:baselineResources,reviews:sourceUse.reviews,evaluatedOn:sourceUse.evaluatedOn})
  if(policies.items.some(i=>i.reviewStatus==='binding_changed')) throw new Error('preparation_policy_baseline_changed')
  if(!signature(priceInput.packet)||fingerprint(signature(priceInput.packet))!==fingerprint(signature(previousPrepared.packet)))
    throw new Error('price_policy_scope_changed')
  const priceReview=sourceUse.reviews.find(r=>r.resourceId==='official-price')
  const reviews=priceReview?[{...structuredClone(priceReview),resourceBinding:sourceUseBinding(priceUseResource(priceInput.packet)),
    application:{type:'same_reviewed_series_policy_new_numeric_capture',parentReviewHash:fingerprint(priceReview)}}]:[]
  const bundles=[],selection=[]
  for(const id of ['cl-retail','cl-pay']) {
    const source=refresh.sources.find(s=>s.sourceId===id),docs=refresh.documents.filter(d=>d.sourceId===id)
    const row={sourceId:id,latestPeriod:source?.latestPeriod??null,latestBasis:source?.latestBasis??null,
      status:'source_unavailable',reason:source?.reason??docs.find(d=>d.captureReason)?.captureReason??'latest_capture_unavailable',absenceProven:false}
    // Two genuinely different files for the latest period need adjudication.
    const captured=Date.parse(source?.indexCollectedAt)
    if(source?.status==='collected_pending_review'&&(!Number.isFinite(captured)||captured>Date.parse(asOf))) Object.assign(row,{reason:'index_capture_time_unverified'})
    else if(source?.status==='collected_pending_review'&&docs.length&&source.omittedCandidates===0) {
      if(new Set(docs.map(d=>d.sha256)).size>1) Object.assign(row,{status:'review_required',reason:'multiple_latest_versions'})
      else {
        const d=docs[0],bundle=reviewedMonthly.bundles.find(b=>b.evidence.length&&b.evidence.every(e=>e.period===source.latestPeriod&&e.provenance?.pdfHash===d.sha256)
          &&b.evidence.every(e=>id==='cl-pay'?e.url.includes('/sueldos-y-salarios/'):e.url.includes('/actividad-mensual-del-comercio/')))
        if(d.period!==source.latestPeriod||!Number.isFinite(Date.parse(d.collectedAt))||Date.parse(d.collectedAt)>Date.parse(asOf))
          Object.assign(row,{status:'review_required',reason:'latest_capture_period_or_time_mismatch'})
        else if(d.extraction.status!=='extracted_pending_review') Object.assign(row,{status:'review_required',reason:'latest_extraction_failed'})
        else if(!bundle) Object.assign(row,{status:'review_required',reason:'new_period_or_revised_original'})
        else if(d.extraction.extractionHash!==bundle.identity.extractionHash) Object.assign(row,{status:'review_required',reason:'extraction_identity_changed'})
        else {
          bundles.push(bundle)
          for(const e of bundle.evidence) {
            const r=sourceUse.reviews.find(r=>r.resourceId===e.id)
            if(r) reviews.push(structuredClone(r))
          }
          Object.assign(row,{status:'reviewed_original_unchanged',reason:'fresh_bytes_and_extraction_match_reviewed_original',
            sha256:d.sha256,capturedAt:d.collectedAt??refresh.capturedAt,
            originalReviewPreserved:true})
        }
      }
    } else if(source?.omittedCandidates>0) Object.assign(row,{status:'review_required',reason:'unexamined_latest_versions'})
    selection.push(row)
  }
  const periods=selection.map(s=>s.latestPeriod)
  const common=periods.every(Boolean)&&new Set(periods).size===1?periods[0]:null
  // Never quietly choose an older common month when the latest releases differ.
  const alignment=common?'same_latest_index_period':periods.every(Boolean)?'different_latest_periods':'latest_period_unverified'
  const materials=prepareResearchMaterials({prepared:priceInput,monthlyBundles:bundles,
    sourceUse:{evaluatedOn:sourceUse.evaluatedOn,reviews},asOf,consumerPeriod:common??undefined})
  if(common) {
    const consumer=materials.questions.find(q=>q.id==='consumer')
    consumer.latestness=selection.every(s=>s.status==='reviewed_original_unchanged')?'latest_registered_indexes_confirmed':'latest_source_review_pending'
    consumer.latestnessScope='registered_index_links_only_not_proof_of_universal_latestness'
  }
  const dataset={dailyRates:priceInput.packet.series.map(p=>({...p,currency:'CLP',rateType:'LOCAL_PER_USD',source:'API',status:'ok',provider:'Banco Central de Chile'}))}
  const decision=decideGeneration({dataset,currency:'CLP',asOf,history,events:[]})
  const sourceReuseScreen=selection.filter(s=>s.sha256).map(s=>({sourceId:s.sourceId,sha256:s.sha256,
    priorReportIds:(reportCatalogue?.reports??[]).filter(r=>r.currency==='CLP'
      &&['published','approved','pending_review','rejected','held','failed'].includes(r.status)
      &&r.sourceHashes.includes(s.sha256)).map(r=>r.id),
    meaning:'document_identity_only_not_a_semantic_novelty_verdict'}))
  const input={currency:materials.currency,baseDate:materials.baseDate,observedDate:materials.observedDate,
    facts:materials.contentReviewPrice?.facts??[],evidence:materials.contentReviewMaterials}
  const inputReviewPacket=input.evidence.length?{format:'prewriting_evidence_review_not_a_writer_prompt',
    promptVersion:PROMPT_VERSION,ruleVersion:RULE_VERSION,editorialVersion:EDITORIAL_VERSION,
    input:{currency:input.currency,baseDate:input.baseDate,observedDate:input.observedDate,
        observationAt:null,facts:input.facts.map(({id,label})=>({id,label})),
        evidence:input.evidence.map(e=>({id:e.id,country:input.currency,title:e.title,publisher:e.source,publishedAt:e.publishedAt,
          eventDate:e.eventDate,period:e.period,sourceContext:e.sourceContext,
          summary:e.scope.admittedClaims.map(c=>c.text).join(' '),admittedScope:e.scope.allowedUse,
          attribution:e.attribution,license:e.license,licenseUrl:e.licenseUrl,transformation:e.transformation})),
        scopeCards:input.evidence.map(e=>e.scope),
        scope:'monthly_background_not_verified_as_fx_cause',
        missingQuestions:materials.missingQuestions.map(q=>({id:q.id,status:q.status})),
        instruction:'자료에 없는 원인·전망·업무 제안을 채우지 않는다. 이 입력은 검토용이며 집필 허가는 별도다.'},
    model:null,apiCallAuthorized:false}:null
  const holds=[...materials.questions.filter(q=>q.required&&q.status!=='usable_for_content_review').map(q=>`question:${q.id}`),
    ...selection.filter(s=>s.status!=='reviewed_original_unchanged').map(s=>`source:${s.sourceId}:${s.reason}`),
    ...(alignment!=='same_latest_index_period'?[alignment]:[]),
    'semantic_input_review_not_completed','new_information_value_not_reviewed','paid_generation_not_authorized']
  return {version:PREPARATION_VERSION,asOf,reportDate:materials.baseDate,priceSessionDate:materials.observedDate,
    selection:{alignment,comparisonPeriod:common,sources:selection},materials,decision,
    priceAssessment:{sourceCapture:'validated_projected_snapshot',rollingWindows:decision.price.status,
      interpretation:decision.price.status==='partial'?'historical_window_coverage_incomplete_not_a_source_download_failure'
        :decision.price.status==='available'?'rolling_window_inputs_available':'price_inputs_require_review'},
    historyScope:'caller_supplied_local_history_not_production_history',
    localReportHistory:{status:reportCatalogue?reportCatalogue.issues.length?'partial':'local_catalogue_only':'not_supplied',
      reports:(reportCatalogue?.reports??[]).filter(r=>r.currency==='CLP').slice(0,30).map(({sourceHashes,...r})=>r),
      sourceReuseScreen,semanticNovelty:'not_reviewed',productionHistoryVerified:false},
    roles:WRITING_ROLES,inputReviewPacket,
    writerPlan:{purpose:'not_selected',model:null,request:null,automaticPurposeFallback:false,
      contracts:{fx_explanation:{version:PROMPT_VERSION,prepare:'requestBody',schema:'draftSchemaForPacket'},
        economic_update:{version:ECONOMIC_VERSION,prepare:'economicUpdateRequest',schema:'economicOutputSchema'}},
      prerequisite:'source_scope_semantic_support_novelty_and_budget_review'},
    reviewerPlan:{contract:CLAIM_REVIEW_VERSION,instructions:CLAIM_REVIEW_INSTRUCTIONS,
      prepare:'prepareClaimReview',validate:'assessClaimReview',correction:'runEditorialWorkflow',
      automaticRewriteAuthorized:false,publicationApproved:false},
    stageStatus:{inputAssembly:'completed_with_explicit_holds',roleContracts:'defined_using_existing_writer_and_review_contracts',semanticReview:'not_run'},
    status:'hold_before_generation',holds:[...new Set(holds)],
    generationRequest:null,modelCalls:0,newApiCostUsd:0,publicationApproved:false,
    binding:fingerprint({price:priceInput.sourceSnapshotSha256,selection,materials:materials.binding,history})}
}
