// Job outcome is independent from publication approval and content quality.
import {REPORT_CURRENCIES,COUNTRY_REPORT_PROFILES} from './shared-price-contract.js'
export function referenceReadiness(result) {
 const rows=result.collectionResults??[],failures=[]
 if(result.modelCalls!==0||result.publicationApproved!==false)failures.push('non_free_readiness_result')
 for(const currency of REPORT_CURRENCIES){
  const matches=rows.filter(r=>r.currency===currency),row=matches[0],decision=row?.publicationDecision
  if(matches.length!==1)failures.push(currency+':reference_result_missing_or_duplicate')
  else if(row.referenceStatus!=='usable_reference'||!decision||decision.thresholdPct!==COUNTRY_REPORT_PROFILES[currency].cumulativeThresholdPct
    ||!Array.isArray(decision.dataHolds)||!Array.isArray(decision.comparisonHolds)
    ||decision.dataHolds.length||decision.comparisonHolds.length)failures.push(currency+':reference_not_ready')
 }
 if(rows.some(r=>!REPORT_CURRENCIES.includes(r.currency)))failures.push('unexpected_reference_currency')
 return {ready:failures.length===0,failures,modelCalls:result.modelCalls??null,publicationApproved:result.publicationApproved===true,contentQualityEvaluated:false}
}
export function operatingResultState(result) {
 const results=[],seen=new Set(),pending=[result]
 while(pending.length){const current=pending.shift();if(!current||seen.has(current))continue
  results.push(current);seen.add(current);pending.push(current.previousResult,...(current.executionBatches??[]))}
 // The coordinator merges current country ownership. A resolved old country's
 // preparation hold must not override its completed follow-up; batch-level
 // accounting/lease errors below remain global across every envelope.
 const rows=result.rows??results.flatMap(r=>r.rows??[])
 // Current discovery diagnostics supersede historical failed lookups. Keep
 // frozen execution errors visible without relabelling old captures as fresh.
 const collections=result.collectionResults??results.flatMap(r=>r.collectionResults??[])
 const statuses=[...results.flatMap(r=>[r.status,...(r.holds??[])]),...rows.map(r=>r.status),...collections.map(r=>r.status)]
 const recorded=results.filter(r=>r.version==='operating-checkpoint/1').map(r=>r.checkpointOutcome)
 const attention=recorded.some(r=>r?.kind==='action_required')||statuses.some(s=>/source_endpoint_|operating_storage_failure|cost_(?:unresolved|reconciliation|exceeded|or_execution_recovery)|unresolved_or_inflight|execution_hold|lease_expired|batch_busy|payload_capacity_hold|queue_capacity_hold|correction_recording_required/.test(s??''))
  ||rows.some(r=>[r.continuation,...(r.continuation?.issues??[])].some(i=>['await_pipeline_repair','stop_paid_work'].includes(i?.action)))
 const failed=result.referenceReadiness?.ready===false||recorded.some(r=>r?.kind==='failure')||statuses.some(s=>/collection_or_history_failed|country_execution_hold|operating_model_key_missing|collection_failed/.test(s??''))
  ||collections.some(r=>r.acquisitionError||r.referenceStatus==='upstream_fx_refresh_not_confirmed'||r.candidates===0&&r.lookupFailures?.length)
 const partial=recorded.some(r=>r?.partialSourceFailure)||collections.some(r=>r.lookupFailures?.length)
 const review=recorded.some(r=>r?.kind==='review_wait')||statuses.includes('pending_admin_review')
 const waiting=recorded.some(r=>r?.kind==='waiting')||(result.holds?.length??0)>0||statuses.some(s=>/(?:_hold|_wait|not_enabled|required|configuration_pending|source_dispatch_deferred)$/.test(s??''))
 return {kind:attention?'action_required':failed?'failure':review?'review_wait':waiting?'waiting':'normal',
  exitCode:attention?2:failed?1:0,partialSourceFailure:!!partial,publicationApproved:false}
}
