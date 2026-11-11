// Common next-action contract. A continuation never authorizes a request,
// weakens a source check or changes the dashboard's reference price.
import {effectiveSourceGroups} from './source-review-validity.js'
export const RESEARCH_CONTINUATION_VERSION='research-continuation/3'
const codes=item=>[item?.status,item?.reason,...(item?.holds??[])].filter(v=>typeof v==='string')
const match=(items,re)=>items.some(v=>re.test(v))
const discoveryStates=new Set(['partial_pending_review','originals_pending_review','collected_pending_review',
 'no_candidates_in_listing','listing_did_not_identify_matching_article','no_candidates_in_attempt','no_candidates_in_index'])
export function sourceContinuation(item) {
 const reasons=codes(item)
 let category='technical',action='await_pipeline_repair',resumeWhen='code_or_configuration_changed',resumeExact=false
 if(reasons.length&&reasons.every(code=>discoveryStates.has(code))){
  category='discovery';action='review_available_sources';resumeWhen='next_cycle_with_available_material'
 }else if(match(reasons,/frozen_country_(?:reference|material)_superseded/)){
  category='superseded';action='prepare_current_input';resumeWhen='next_cycle_with_current_input_and_original_budget_gates'
 }else if(match(reasons,/recovery_(?:next_execution_wait|route_wait|retry_wait)/)){
  category='temporary';action='resume_saved_stages';resumeWhen='next_authorized_execution_after_cooldown';resumeExact=true
 }else if(match(reasons,/recovery_retry_exhausted|response_failed_no_automatic_retry/)){
  category='output';action='find_other_evidence';resumeWhen='new_material_or_operator_review'
 }else if(match(reasons,/cost_unresolved|cost_reconciliation|existing_source_call_not_reusable|unresolved_or_inflight|recovery_accounting_hold/)){
  category='accounting';action='stop_paid_work';resumeWhen='confirmed_accounting_recovery'
 }else if(match(reasons,/unsafe_or_oversized_runtime_payload|runtime_document_|unsafe_supply_payload/)){
  category='technical';action='await_pipeline_repair';resumeWhen='verified_runtime_storage_repair';resumeExact=true
 }else if(match(reasons,/source_endpoint_(?:preflight_hold|metadata_unavailable|route_unavailable|unsupported_parameters|processing_conditions|price_or_input_limit|request_configuration)/)){
  category='temporary';action='resume_saved_stages';resumeWhen='endpoint_control_or_execution_window_recovered';resumeExact=true
 }else if(match(reasons,/published_history_unavailable|correction_storage_failed|correction_history_unavailable|supply_status_storage_failed/)){
  category='temporary';action='wait_for_country_storage';resumeWhen='next_cycle_rechecks_country_history_and_storage'
 }else if(match(reasons,/source_budget_deferred|source_dispatch_deferred/)){
  category='budget';action='continue_next_budgeted_cycle';resumeWhen='next_cycle_reuses_reviews_and_allocates_remaining_sources'
 }else if(match(reasons,/country_runtime_read_wait|country_store_wait|frozen_(?:source|reference)_refresh_wait|execution_time_budget_wait|source_endpoint_(?:preflight_hold|metadata_unavailable|route_unavailable|unsupported_parameters|processing_conditions|price_or_input_limit|request_configuration)|runtime_endpoint_preflight_wait|runtime_finalization_wait|runtime_store_.*_failed|runtime_stopped_before_call|runtime_disabled|source_runtime_stopped_before_post/)){
  category='temporary';action='resume_saved_stages';resumeWhen='endpoint_control_or_execution_window_recovered';resumeExact=true
 }else if(match(reasons,/source_budget_not_approved|source_review_budget_required|source_review_wait|batch_budget_hold|monthly_budget|budget_exhausted|batch_stopped_before_dispatch|operating_batch_budget_hold/)){
  category='budget';action='wait_for_budget';resumeWhen='authorized_budget_available';resumeExact=true
 }else if(match(reasons,/source_request_budget$|source_request_budget_hold|comparison_input_budget_hold|complete_original_exceeds_budget|comparison_worst_case_exceeds_budget|source_two_stage_budget_exceeded/)){
  category='capacity';action='find_other_evidence';resumeWhen='other_material_or_request_policy_changed'
 }else if(match(reasons,/unsafe|processing_restricted|source_use_wait|source_review_withdrawn|original_use_or_input_hold|robots_disallowed|robots_unavailable|publisher_paywall|access_failed|http_[45]\d\d|publisher_delay_requires_scheduler/)){
  category='access';action='use_other_registered_source';resumeWhen='other_source_or_access_policy_changed'
 }else if(match(reasons,/extraction_failed|invalid_structured_article_body|source_metadata_hold|analysis_context_hold|discovery_incomplete|saved_capture_missing|alternative_index_unavailable/)){
  category='capture';action='use_other_registered_source';resumeWhen='source_revision_or_adapter_changed'
 }else if(match(reasons,/cadence_hold|cadence_or_reference_hold|shared_reference_price_held|dashboard_reference|new_publication_superseded_frozen_input|frozen_reference_superseded/)){
  category='reference';action='wait_for_reference_or_trigger';resumeWhen='valid_reference_or_current_publication'
 }else if(match(reasons,/invalid_original_|held_extraction_has_claims|event_date_evidence_required|extraction_attribution_not_in_original|comparison_dropped_candidate_context|source_json_hold|source_response_or_cost_hold|content_review_hold|structure_hold|output_hold|review_input_preflight_hold|source_review_conflict|source_review_revalidation_required/)){
  category='output';action='find_other_evidence';resumeWhen='new_material_or_review_rules'
 }else if(match(reasons,/market_period_|publication_before_session_window|original_event_date_not_supported|event_date_|extraction_event_/)){
  category='period';action='find_period_matched_evidence';resumeWhen='new_material_or_review_rules'
 }else if(match(reasons,/non_economic_section|original_support_hold|original_claim_support_not_confirmed|insufficient_information|unrelated|writing_input_hold|selected_session_.*_missing|explicit_local_explanation_required|global_context_promoted_to_local|note_use_or_role_hold/)){
  category='content';action='find_other_evidence';resumeWhen='new_material_or_review_rules'
 }
 return {version:RESEARCH_CONTINUATION_VERSION,category,action,resumeWhen,resumeExact,
  paidCallAuthorized:false,automaticRetry:false}
}

// Existing immutable review records are the feedback store. A URL is only
// deprioritized, never banned: the publisher may have corrected the same page.
export function researchFeedback(records=[]) {
 const effective=effectiveSourceGroups(records).filter(g=>g.state!=='unreviewed'),current=effective.flatMap(g=>g.state==='usable'?[g.record]:g.records)
 const editionTime=r=>Date.parse(r.original?.metadata?.modifiedAt??r.original?.collectedAt??'')||0
 const latest=new Map()
 for(const record of current)latest.set(record.original?.url,Math.max(latest.get(record.original?.url)??0,editionTime(record)))
 const active=current.filter(r=>editionTime(r)>=(latest.get(r.original?.url)??0))
 const held=active.filter(r=>r?.review?.heldStatus)
 const incomplete=active.filter(r=>!r.review?.heldStatus&&(r.review?.assessment
  ?r.review.assessment.localCauseSupport!==true
  :r.review?.materialInput&&!r.review.materialInput.materials?.some(m=>Object.values(m.record?.claimRoles??{}).includes('attributed_fx_explanation'))))
 const rows=[...held,...incomplete]
 const deprioritized=[...held.filter(r=>codes({status:r.review.heldStatus,holds:r.review.holds})
  .some(code=>/^(unrelated|non_economic_section)$/.test(code))),...incomplete]
 return {version:RESEARCH_CONTINUATION_VERSION,need:'session_market_explanation',
  preferAlternativeIndex:rows.length>0,
  deprioritizeUrls:[...new Set(deprioritized.map(r=>r.original?.url).filter(u=>typeof u==='string'&&u.startsWith('https://')))].slice(0,500),
  preservedForReviewUrls:[...new Set(held.filter(r=>!deprioritized.includes(r)).map(r=>r.original?.url).filter(Boolean))].slice(0,500),
  priorIssues:held.map(r=>({sourceId:r.original?.sourceId,...sourceContinuation({status:r.review.heldStatus,holds:r.review.holds})})).slice(0,100),
  meaning:'discovery_priority_only_not_evidence_or_permission'}
}

export function countryContinuation(row) {
 const sourceIssues=(row.sourceIssues??[]).filter(i=>!['reviewed_note_ready_for_material_validation',
  'exact_saved_review_reused_not_new_verification','duplicate_original'].includes(i.status))
 const diagnostics=sourceIssues.map(issue=>({status:issue.status,reason:issue.reason??null,holds:issue.holds??[],...sourceContinuation(issue)}))
 const blockingCodes=[...sourceIssues,{status:row.status,reason:row.reason,holds:row.sourceHolds??row.holds??[]}].flatMap(codes)
 if(row.status==='source_dispatch_deferred'&&!blockingCodes.some(code=>/source_endpoint_|runtime_document_|unsafe_or_oversized_runtime_payload|cost_unresolved|cost_reconciliation/.test(code)))return {version:RESEARCH_CONTINUATION_VERSION,category:'budget',
  action:'continue_next_budgeted_cycle',resumeExact:false,resumeWhen:'next_cycle_reuses_reviews_and_allocates_remaining_sources',
  paidCallAuthorized:false,automaticRetry:false,issues:diagnostics}
 if(row.status==='country_owned_by_prior_batch')return {version:RESEARCH_CONTINUATION_VERSION,category:'ownership',
  action:'resume_original_batch',resumeExact:false,resumeWhen:'original_country_work_recovered',
  paidCallAuthorized:false,automaticRetry:false,issues:diagnostics}
 if(row.status==='unchanged_case_already_processed')return {version:RESEARCH_CONTINUATION_VERSION,action:'wait_for_changed_material',resumeExact:false,
  resumeWhen:'new_material_or_review_rules',paidCallAuthorized:false,issues:diagnostics}
 if(row.status==='input_staged')return {version:RESEARCH_CONTINUATION_VERSION,action:'write_then_review',resumeExact:false,
  resumeWhen:'authorized_execution_with_exact_input',paidCallAuthorized:false,issues:diagnostics}
 if(row.status==='no_report_due')return {version:RESEARCH_CONTINUATION_VERSION,action:'wait_for_trigger',resumeExact:false,
  resumeWhen:'new_material_price_trigger_or_periodic_due',paidCallAuthorized:false,issues:diagnostics}
 if(row.status==='pending_admin_review')return {version:RESEARCH_CONTINUATION_VERSION,action:'await_admin_review',resumeExact:false,
  resumeWhen:'admin_decision',paidCallAuthorized:false,issues:diagnostics}
 const issues=[...sourceIssues,
  {status:row.status,reason:row.reason,holds:row.sourceHolds??row.holds??[]}]
 const decisions=issues.map(sourceContinuation)
 const selected=decisions.find(d=>d.category==='accounting')??decisions.find((d,i)=>codes(issues[i]).some(code=>/^(source_endpoint_|runtime_document_|unsafe_or_oversized_runtime_payload)/.test(code)))??decisions.find(d=>d.category==='technical')??decisions.find(d=>d.resumeExact)
  ??decisions.find(d=>d.category==='access'||d.category==='capture'||d.category==='capacity')
  ??decisions.find(d=>d.category==='content'||d.category==='output'||d.category==='period'||d.category==='superseded')??decisions[0]
 const holds=row.sourceHolds??row.holds??[]
 return {...selected,issues:issues.map((issue,i)=>({status:issue.status,reason:issue.reason??null,holds:issue.holds??[],...decisions[i]})),
  missing:['market_observation','attributed_fx_explanation'].filter(role=>holds.includes(`selected_session_${role}_missing`)),
  selection:'next_scheduled_cycle_same_policy_budget_and_duplicate_gates',newReportRequired:false}
}
