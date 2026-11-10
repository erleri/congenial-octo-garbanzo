// Review orchestration over original-bound extraction/comparison. Raw-use
// policies and independently authored-note policies remain separate gates.
import {applyOriginalUsePolicies} from './original-news-use-policy.js'
import {prepareOriginalNewsCase,runOriginalNewsCase} from './original-news-pipeline.js'
import {validateSelectedReviewCard,collectionAtReviewCutoff} from './selected-source-collection.js'
import {fingerprint} from './research-harness.js'
import {applyMaterialProcessing,restrictCachedNoteMaterial} from './material-processing.js'
import {admitRuntimeNotes} from './runtime-note-material.js'
import {savedSourceReview} from './operating-source-cache.js'
import {sourceContinuation} from './research-continuation.js'
import {inspectNewsPreselection} from './news-preselection.js'

export async function reviewRuntimeSources({collection,asOf,registry,processingRules,saved=[],extract,compare,admitNotes,onlySaved=false,dispatchCardBindings,sourceWriter='sol'}) {
 if(dispatchCardBindings!==undefined&&(!Array.isArray(dispatchCardBindings)
  ||new Set(dispatchCardBindings).size!==dispatchCardBindings.length
  ||dispatchCardBindings.some(b=>!collection.reviewQueue.some(c=>c.binding===b))))throw Error('bound_source_dispatch_required')
 collection=collectionAtReviewCutoff({collection,asOf})
 const sourceUse=processingRules?applyMaterialProcessing({collection,legacyRegistry:registry,rules:processingRules,evaluatedOn:asOf.slice(0,10)})
  :applyOriginalUsePolicies({collection,registry,evaluatedOn:asOf.slice(0,10)})
 if(processingRules&&!admitNotes)admitNotes=args=>admitRuntimeNotes({...args,registry:processingRules})
 const receipts=[],materialInputs=[],items=[]
 let modelCalls=0,newPaidCostUsd=0
 const seen=new Set()
 for(const card of collection.reviewQueue){
  try{
   const {original}=validateSelectedReviewCard(collection,card)
   const identity=fingerprint({url:original.url,sha256:original.sha256})
   if(seen.has(identity)){items.push({cardBinding:card.binding,status:'duplicate_original'});continue}
   seen.add(identity)
   if(card.materialKind==='article'){
    const selection=inspectNewsPreselection(original,card,collection.currency)
    if(selection.status==='excluded'){
     items.push({cardBinding:card.binding,status:'source_selection_hold',holds:[selection.reason],selection,modelCalls:0,costUsd:0});continue
    }
   }
   // Saved records are accepted only through the existing downstream validators.
   // No response is rebound to a new body or a different source date.
   const cached=savedSourceReview(saved,card)
   if(cached){
    if(cached.heldStatus){items.push({cardBinding:card.binding,status:'exact_saved_hold_reused_not_new_verification',holds:cached.holds??[cached.heldStatus]});continue}
    receipts.push(cached.receipt)
    if(cached.materialInput)materialInputs.push({cardBinding:card.binding,input:processingRules
     ?restrictCachedNoteMaterial(cached.materialInput,processingRules,asOf.slice(0,10)):cached.materialInput})
    items.push({cardBinding:card.binding,status:'exact_saved_review_reused_not_new_verification'});continue
   }
   if(onlySaved){items.push({cardBinding:card.binding,status:'pending_original_review_not_admitted',modelCalls:0,costUsd:0});continue}
   if(dispatchCardBindings&&!dispatchCardBindings.includes(card.binding)){
    items.push({cardBinding:card.binding,status:'source_budget_deferred',modelCalls:0,costUsd:0});continue
   }
   if(card.materialKind!=='article'){
    items.push({cardBinding:card.binding,status:'automatic_statistic_review_adapter_required'});continue
   }
   const materialDecision=sourceUse.policyDecisions.find(d=>d.originalId===original.id)
   if(materialDecision?.reason==='unsafe_original_material'){
    items.push({cardBinding:card.binding,status:'source_review_hold',holds:['unsafe_original_material']});continue
   }
   const plan=prepareOriginalNewsCase({collection,card,sourceUse,sourceWriter})
   if(plan.holds.length){
    const decision=sourceUse.policyDecisions.find(d=>d.originalId===original.id)
    const budgetHold=plan.holds.some(h=>['complete_original_exceeds_budget','comparison_worst_case_exceeds_budget','source_two_stage_budget_exceeded'].includes(h))
    const status=!processingRules?'original_use_or_input_hold':decision?.reason?.startsWith('explicit_')
     ?'processing_restricted':plan.holds.includes('publication_metadata_missing')?'source_metadata_hold':budgetHold?'source_request_budget_hold':'analysis_context_hold'
    items.push({cardBinding:card.binding,status,holds:plan.holds,nextAction:'continue_other_registered_candidates',
     useDecision:decision?{status:decision.status,reason:decision.reason}:null,
     ...(budgetHold?{maximumUsd:plan.maximumUsd,requestBudget:plan.budget,contextBlocks:plan.job.blocks.length,
      contextCoverage:plan.job.analysisCoverage??null}:{} )});continue
   }
   if(!extract||!compare||!admitNotes){
    items.push({cardBinding:card.binding,status:processingRules?'source_review_budget_required':'source_review_budget_or_note_policy_required',maximumUsd:plan.maximumUsd,
     inputMode:plan.job.inputMode??'full_original',contextBlocks:plan.job.blocks.length,contextCoverage:plan.job.analysisCoverage??null,requestBudget:plan.budget});continue
   }
   // Explicit caller adapters own durable reservation and actual usage. There
   // is no implicit paid transport, default retry or model fallback here.
   let thisCalls=0,thisCost=0
   const invoke=fn=>async request=>{
    let r
    try{r=await fn(request,plan)}catch(error){
     if(error.recordedGenerationCalls===1&&Number.isFinite(error.recordedCostUsd)&&error.recordedCostUsd>=0){
      thisCalls++;modelCalls++;thisCost+=error.recordedCostUsd
      if(newPaidCostUsd!==null)newPaidCostUsd+=error.recordedCostUsd
     }else if(error.beforeDispatch!==true){modelCalls=null;newPaidCostUsd=null}
     throw error
    }
    if(!(r?.generationCalls===1||r?.generationCalls===0&&r?.reused===true&&r.costUsd===0)
     ||r.costUsd!==null&&(!Number.isFinite(r.costUsd)||r.costUsd<0)){
     modelCalls=null;newPaidCostUsd=null;throw Error('source_usage_receipt_required')
    }
    thisCalls+=r.generationCalls;modelCalls+=r.generationCalls
    if(r.costUsd===null){thisCost=null;newPaidCostUsd=null;throw Error('source_cost_unresolved')}
    if(thisCost!==null)thisCost+=r.costUsd
    if(newPaidCostUsd!==null)newPaidCostUsd+=r.costUsd
    return r
   }
   const reviewed=await runOriginalNewsCase({collection,card,sourceUse,sourceWriter,extract:invoke(extract),compare:invoke(compare),checkedOn:asOf.slice(0,10)})
   if(newPaidCostUsd===null){items.push({cardBinding:card.binding,status:'source_cost_unresolved'});break}
   if(reviewed.status!=='source_card_prepared'){
    items.push({cardBinding:card.binding,status:reviewed.status,reason:reviewed.reason??null,
     ...(reviewed.diagnostic?{diagnostic:reviewed.diagnostic}:{}),limitations:reviewed.limitations??[],modelCalls:thisCalls,costUsd:thisCost});continue
   }
   // A note's publication/model-use permission is not inferred from permission
   // to analyze the original. This adapter must return a bound material input.
   const material=await admitNotes({collection,card,reviewed,asOf})
   receipts.push(reviewed.receipt)
   if(material)materialInputs.push({cardBinding:card.binding,input:material})
   items.push({cardBinding:card.binding,status:material?'reviewed_note_ready_for_material_validation':'note_use_or_role_hold',
    assessment:reviewed.assessment,modelCalls:thisCalls,costUsd:thisCost})
  }catch(error){
   items.push({cardBinding:card.binding,status:'source_review_hold',holds:[/^[a-z_]{5,100}$/.test(error.message??'')?error.message:'source_review_failed']})
   // invoke() records uncertainty only around a dispatched request. A local
   // preparation/admission error must not invent an unknown paid expense merely
   // because paid adapters were supplied. Never continue after a real unknown.
   if(newPaidCostUsd===null)break
  }
 }
 return {version:'runtime-source-review/1',status:newPaidCostUsd===null?'source_cost_unresolved':'source_reviews_returned',
  receipts,materialInputs,newsResponses:[],items:items.map(item=>({...item,continuation:sourceContinuation(item)})),modelCalls,newPaidCostUsd,publicationApproved:false}
}
