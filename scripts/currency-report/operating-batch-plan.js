// OFFLINE planning only. No secrets, POSTs, reservations, DB activation or
// publication. A deployment owner must separately enable and authorize the
// processing policy. This cannot waive a host/tool's transmission approval.
import {fingerprint} from './research-harness.js'
import {REPORT_CURRENCIES,buildSharedDashboardPriceSnapshot} from './shared-price-contract.js'
import {evaluatePublicationCadence} from './publication-cadence.js'
import {compileResearchSourceCatalog,registeredNewsSourceForUrl} from './research-source-selection.js'
import {collectionAtReviewCutoff,validateSelectedReviewCard} from './selected-source-collection.js'
import {applyMaterialProcessing} from './material-processing.js'
import {prepareOriginalNewsCase} from './original-news-pipeline.js'
import {writerProfile} from './writer-policy.js'
import {savedSourceReview} from './operating-source-cache.js'
import {inspectNewsPreselection} from './news-preselection.js'
import {budgetedSourceDispatch} from './budgeted-source-dispatch.js'
import {isolateUnregisteredArticles} from './registered-collection.js'

export const OPERATING_PLAN_VERSION='operating-batch-plan/1'
export const OPERATING_DESTINATION=Object.freeze({endpoint:'https://openrouter.ai/api/v1/chat/completions',
 model:'openai/gpt-6.1-sol',provider:'azure',writerProvider:'azure',reviewProvider:'azure/us',zdr:true,dataCollection:'deny',rawPurpose:'original_extraction_and_comparison_only',
 writerInput:'reviewed_independent_notes_only',rawPublicDisplay:false,retries:0,fallback:false})
export const matchesOperatingDestination=value=>value&&Object.keys(value).every(key=>Object.hasOwn(OPERATING_DESTINATION,key))
 &&Object.entries(OPERATING_DESTINATION).every(([key,expected])=>key==='writerProvider'?['azure','azure/us'].includes(value[key]??'azure'):value[key]===expected)
// The extended ceiling is available only to an explicitly bound one-time
// trial. Factory defaults and recurring service limits remain unchanged.
export const operatingLimitCeilings=policy=>policy?.state==='trial_configured'
 ?{batchUsd:8,maxCalls:62}:{batchUsd:7,maxCalls:60}
export function proposeOperatingPolicy({sourcePlan,sourceRegister,processingRules}) {
 const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister)
 const body={version:'report-operating-policy/1',state:'proposal_not_enabled',destination:OPERATING_DESTINATION,
  sourceCatalogBinding:catalog.catalogId,processingRulesBinding:fingerprint(processingRules),currencies:[...REPORT_CURRENCIES],
  limits:{batchUsd:7,maxCalls:60,maxReports:6,perCallUsd:.25},
  budgetScope:'recurring_service_separate_from_single_trial_approval',
  recurringBudgetAuthorization:'pending_operator_budget_configuration',
  externalTransmissionAuthorization:'pending_explicit_operator_configuration',
  publication:'separate_active_admin_review',configurationTrust:'server_owned_never_article_or_model_input'}
 return {...body,binding:fingerprint(body)}
}
function assertPolicy(policy) {
 const {binding,...body}=policy??{},limits=policy?.limits,ceilings=operatingLimitCeilings(policy)
 if(policy?.version!=='report-operating-policy/1'||binding!==fingerprint(body)
  ||!matchesOperatingDestination(policy.destination)
  ||!['proposal_not_enabled','operator_configured','trial_configured'].includes(policy.state)
  ||!['pending_explicit_operator_configuration','approved_by_operator'].includes(policy.externalTransmissionAuthorization)
  ||policy.budgetScope!==(policy.state==='trial_configured'?'one_time_trial_only':'recurring_service_separate_from_single_trial_approval')
  ||!['pending_operator_budget_configuration','approved_by_operator','not_authorized'].includes(policy.recurringBudgetAuthorization)
  ||policy.configurationTrust!=='server_owned_never_article_or_model_input'
  ||policy.publication!=='separate_active_admin_review'||JSON.stringify(policy.currencies)!==JSON.stringify(REPORT_CURRENCIES)
  ||!limits||!Number.isFinite(limits.batchUsd)||limits.batchUsd<=0||limits.batchUsd>ceilings.batchUsd
  ||!Number.isInteger(limits.maxCalls)||limits.maxCalls<12||limits.maxCalls>ceilings.maxCalls||limits.maxReports!==6
  ||!Number.isFinite(limits.perCallUsd)||limits.perCallUsd<=0||limits.perCallUsd>.25)
  throw Error('bound_operating_policy_required')
}
export function prepareOperatingBatch({policy,dataset,countries,asOf,publicationsByCurrency,sourcePlan,sourceRegister,registry,processingRules,control}) {
 assertPolicy(policy)
 if(!Array.isArray(countries)||countries.length!==6||REPORT_CURRENCIES.some(c=>countries.filter(r=>r.currency===c).length!==1))
  throw Error('complete_country_operating_input_required')
 const catalog=compileResearchSourceCatalog(sourcePlan,sourceRegister),holds=[],rows=[],privateCountries=[]
 let plans=[]
 if(policy.sourceCatalogBinding!==catalog.catalogId)holds.push('source_configuration_changed')
 if(policy.processingRulesBinding!==fingerprint(processingRules))holds.push('processing_configuration_changed')
 if(!['operator_configured','trial_configured'].includes(policy.state)||policy.externalTransmissionAuthorization!=='approved_by_operator')holds.push('external_processing_configuration_pending')
 if(policy.state==='trial_configured'){
  if(policy.datasetBinding!==fingerprint(dataset))holds.push('trial_dataset_scope_changed')
  if(policy.trialBudgetAuthorization!=='approved_by_operator'||policy.recurringBudgetAuthorization!=='not_authorized')holds.push('trial_budget_authorization_required')
  if(!Number.isFinite(Date.parse(policy.expiresAt))||Date.parse(asOf)>Date.parse(policy.expiresAt))holds.push('trial_authorization_expired')
 }else if(policy.recurringBudgetAuthorization!=='approved_by_operator')holds.push('standing_budget_configuration_pending')
 if(!control?.enabled||!control?.review_enabled||control?.writer!==(policy.writer??'sol'))holds.push('runtime_not_enabled')
 if(!Number.isSafeInteger(control?.monthly_limit_nano)||control.monthly_limit_nano<=0)holds.push('recurring_or_runtime_budget_not_enabled')
 for(const currency of REPORT_CURRENCIES){
  const country=countries.find(c=>c.currency===currency),row={currency,status:'planned',holds:[],sources:[],sourceMaxNano:0,maxCalls:2}
  let cadence=null
  if(!Array.isArray(publicationsByCurrency?.[currency]))row.holds.push('published_history_unavailable')
  else{
   const snapshot=buildSharedDashboardPriceSnapshot({dataset,currency,asOf,calendar:country.calendar})
   cadence=evaluatePublicationCadence({snapshot,asOf,calendar:country.calendar,publications:publicationsByCurrency[currency],eventCandidateIds:country.eventCandidateIds??[]})
   row.noReportDue=cadence.status==='no_active_trigger'&&!cadence.dataHolds.length&&!cadence.comparisonHolds.length
   if(!row.noReportDue&&(cadence.status!=='research_candidate'||cadence.dataHolds.length||cadence.comparisonHolds.length))row.holds.push('cadence_or_reference_hold')
  }
  const isolated=isolateUnregisteredArticles(country.collection,catalog)
  const collection=collectionAtReviewCutoff({collection:isolated.collection,asOf})
  row.sources.push(...isolated.excluded)
  if(collection.currency!==currency)throw Error('collection_country_changed')
  if(country.acquisitionError){row.holds.push('source_acquisition_failed')
   if(['published_history_unavailable','correction_storage_failed','correction_history_unavailable','supply_status_storage_failed'].includes(country.acquisitionError))row.holds.push(country.acquisitionError)
  }
  const sourceUse=applyMaterialProcessing({collection,legacyRegistry:registry,rules:processingRules,evaluatedOn:asOf.slice(0,10)})
  const seen=new Set()
  for(const card of collection.reviewQueue){
   if(row.holds.length||row.noReportDue)break
   const {original}=validateSelectedReviewCard(collection,card)
   const source=registeredNewsSourceForUrl({catalog,currency,url:original.url})
   const key=fingerprint({url:original.url,hash:original.sha256})
   if(seen.has(key)){row.sources.push({cardBinding:card.binding,status:'duplicate_capture_no_new_call'});continue}
   seen.add(key)
   if(card.materialKind==='article'){
    const selection=inspectNewsPreselection(original,card,currency)
    if(selection.status==='excluded'){
     row.sources.push({cardBinding:card.binding,status:'source_selection_hold',holds:[selection.reason],maximumUsd:0});continue
    }
   }
   if(!source||source.id!==card.sourceId||source.discovery?.mode==='excluded'){
    row.sources.push({cardBinding:card.binding,status:'source_outside_registered_scope'});continue
   }
   try{
    const cached=savedSourceReview(country.savedSourceReviews??[],card)
    if(cached){
     row.sources.push({cardBinding:card.binding,status:cached.heldStatus?'exact_saved_hold_no_new_call':'exact_saved_review_no_new_call',maximumUsd:0})
     continue
    }
   }catch{
    row.holds.push('saved_source_review_invalid');break
   }
   const plan=prepareOriginalNewsCase({collection,card,sourceUse})
   if(plan.holds.length){row.sources.push({cardBinding:card.binding,status:'source_preparation_hold',holds:plan.holds});continue}
   plans.push(plan);row.sourceMaxNano+=Math.ceil(plan.maximumUsd*1e9);row.maxCalls+=2
   row.sources.push({cardBinding:card.binding,status:'request_prepared_not_dispatched',planBinding:plan.binding,
    url:original.url,maximumUsd:plan.maximumUsd})
  }
  row.purpose=cadence?.anchorId===null?'initial_check':cadence?.triggers?.includes('cumulative')?'market':cadence?.triggers?.includes('periodic')?'periodic':'unverified'
  row.caseId=cadence?.caseId??null
  row.status=row.holds.length?'country_preparation_hold':row.noReportDue?'no_report_due':'planned'
  if(row.status!=='planned'){row.maxCalls=0;row.sourceMaxNano=0}
  row.maximumUsd=row.status==='planned'?(row.sourceMaxNano+2*writerProfile('sol').perCallUsd*1e9)/1e9:0
  privateCountries.push({...structuredClone(country),collection,
   preparation:{status:row.status,holds:[...row.holds]}})
  rows.push(row)
 }
 const writerCallAllowance=2*rows.filter(r=>r.status==='planned').length
 const writerReserveUsd=writerCallAllowance*writerProfile('sol').perCallUsd
 if(policy.state==='operator_configured'){
  const dispatch=budgetedSourceDispatch(rows,plans,{...policy.limits,writerUsd:writerReserveUsd,writerCalls:writerCallAllowance})
  for(const row of rows){
   for(const source of row.sources)if(dispatch.deferred.has(source.planBinding))source.status='source_budget_deferred'
   if(row.status==='planned'){
    const selected=row.sources.filter(s=>dispatch.selected.has(s.planBinding))
    row.sourceMaxNano=selected.reduce((n,s)=>n+Math.ceil(s.maximumUsd*1e9),0)
    row.maxCalls=2+2*selected.length
    row.maximumUsd=(row.sourceMaxNano+2*writerProfile('sol').perCallUsd*1e9)/1e9
    const country=privateCountries.find(c=>c.currency===row.currency)
    const dispatchCardBindings=selected.map(s=>s.cardBinding)
    const deferredCardBindings=row.sources.filter(s=>s.status==='source_budget_deferred').map(s=>s.cardBinding)
    Object.assign(country.preparation,{dispatchCardBindings,deferredCardBindings,
     ...(deferredCardBindings.length?{dispatchBinding:fingerprint({dispatchCardBindings,deferredCardBindings})}:{})})
   }
  }
  plans=plans.filter(p=>dispatch.selected.has(p.binding))
 }
 const sourceNano=rows.reduce((n,r)=>n+r.sourceMaxNano,0),maximumUsd=rows.reduce((n,r)=>n+Math.round(r.maximumUsd*1e9),0)/1e9,
  maxCalls=Math.max(12,rows.reduce((n,r)=>n+r.maxCalls,0))
 if(maximumUsd>policy.limits.batchUsd)holds.push('batch_cost_exceeds_configuration')
 if(maxCalls>policy.limits.maxCalls)holds.push('batch_call_count_exceeds_configuration')
 if(rows.every(r=>r.holds.length))holds.push('no_eligible_country_input')
 // This remains an unapproved candidate. It cannot waive missing explicit
 // transmission consent or turn one approved test into a recurring budget.
 const authorizationCandidate={version:'operational-report-batch-approval/1',authorized:false,maxReports:6,budgetUsd:policy.limits.batchUsd,
  maxCalls,sourceBudgetUsd:sourceNano/1e9,sourcePlanBindings:plans.map(p=>p.binding),writerCallAllowance,writerReserveUsd,
  sourceMaxCalls:2*plans.length,datasetBinding:fingerprint(dataset),
  rulesBinding:fingerprint(processingRules),countriesBinding:fingerprint(privateCountries),asOf,policyBinding:policy.binding}
 const result={version:OPERATING_PLAN_VERSION,status:holds.length?'configuration_or_input_hold':'ready_for_authorized_executor',
  holds:[...new Set(holds)],policyBinding:policy.binding,rows,sourceMaximumUsd:sourceNano/1e9,maximumUsd,maxCalls,
  externalApprovalInherited:false,recurringSpendAuthorized:false,modelCalls:0,networkCalls:0,publicationApproved:false}
 return {...result,binding:fingerprint(result),privateCountries,sourcePlans:plans,authorizationCandidate}
}
