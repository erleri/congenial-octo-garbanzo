// Re-run current LOCAL checks on immutable, already-paid independent outputs.
// Never generates, edits prose, invents a verdict, or upgrades a content hold.
import {fingerprint} from './research-harness.js'
import {prepareOriginalComparison,completeOriginalNewsReview} from './original-news-pipeline.js'
import {applyMaterialProcessing} from './material-processing.js'
import {admitRuntimeNotes} from './runtime-note-material.js'
import {operatingSourceKey,operatingSourceRecords} from './operating-source-cache.js'
import {effectiveSourceReview} from './source-review-validity.js'
import {selectRuntimeAttempt} from './runtime-retry.js'
const localFalseHolds=new Set(['invalid_original_comparison'])
function paidOutput(job,hash,plan){
 if(!job||job.request_hash!==hash||job.context.planBinding!==plan.binding||job.context.purpose!=='original_source_review'
  ||job.cost_state!=='confirmed'||job.actual_nano>job.reserved_nano||!job.response?.valid
  ||!['received','held','finished'].includes(job.state))throw Error('bound_confirmed_source_response_required')
 return JSON.parse(job.response.payload.choices[0].message.content)
}
export async function reassessOriginalCalls({prepared,store,registry,processingRules}){
 const rows=[],rulesBinding=fingerprint(processingRules)
 for(const country of prepared.privateCountries){
  const collection=country.collection,asOf=prepared.asOf,cache=await store.sourceCache(country.currency,rulesBinding)
  const sourceUse=applyMaterialProcessing({collection,legacyRegistry:registry,rules:processingRules,evaluatedOn:asOf.slice(0,10)})
  for(const plan of prepared.sourcePlans.filter(p=>p.currency===country.currency)){
   const card=collection.reviewQueue.find(c=>c.binding===plan.cardBinding),original=collection.originals.find(o=>o.id===card?.originalId)
   if(!card||!original)continue
   const sourceKey=operatingSourceKey(original,rulesBinding),records=cache.filter(r=>(r.sourceKey??r.key)===sourceKey)
   const current=effectiveSourceReview(records)
   if(current.state!=='held'||!current.record?.review.holds?.some(h=>localFalseHolds.has(h)))continue
   try{
    const root=fingerprint({purpose:'original_source_review',plan:plan.binding,stage:'extract'})
    const extraction=await selectRuntimeAttempt({store,taskKey:root,requestHash:plan.extraction.requestHash,enabled:true})
    const candidate=paidOutput(extraction.prior,plan.extraction.requestHash,plan)
    const comparisonRequest=prepareOriginalComparison(plan,candidate)
    const comparison=await selectRuntimeAttempt({store,taskKey:fingerprint({purpose:'original_source_review',plan:plan.binding,stage:'compare'}),requestHash:comparisonRequest.requestHash,enabled:true})
    const verdict=paidOutput(comparison.prior,comparisonRequest.requestHash,plan)
    const reviewed=completeOriginalNewsReview({collection,card,sourceUse,plan,candidate,comparison:verdict,checkedOn:asOf.slice(0,10)})
    if(reviewed.status!=='source_card_prepared'){rows.push({currency:country.currency,sourceKey,status:reviewed.status});continue}
    const material=await admitRuntimeNotes({collection,card,reviewed,asOf,registry:processingRules})
    if(!material){rows.push({currency:country.currency,sourceKey,status:'note_use_hold'});continue}
    const auditCollection={...collection,reviewRevalidations:[{cardBinding:card.binding,priorKeys:current.priorKeys,reason:'local_validator_reassessment'}]}
    const result={receipts:[reviewed.receipt],materialInputs:[{cardBinding:card.binding,input:material}],items:[{cardBinding:card.binding,status:'reviewed_note_ready_for_material_validation',assessment:reviewed.assessment,modelCalls:0,costUsd:0}]}
    const record=operatingSourceRecords(auditCollection,result,rulesBinding)[0]
    record.review.reassessment={version:'original-local-check/2',sourceJobIds:[extraction.prior.id,comparison.prior.id],modelCalls:0,reason:'whole_comparison_context_not_direct_citation_limit'}
    record.key=fingerprint({version:'operating-source-review-record/3',sourceKey:record.sourceKey,cardBinding:record.card.binding,reviewBinding:fingerprint(record.review)})
    await store.saveSourceReview(record)
    rows.push({currency:country.currency,sourceKey,status:'saved_independent_output_reassessed',publicationApproved:false})
   }catch(error){rows.push({currency:country.currency,sourceKey,status:'reassessment_hold',reason:/^[a-z_]+$/.test(error.message)?error.message:'stored_response_check_failed'})}
  }
 }
 return {version:'original-local-reassessment/1',rows,modelCalls:0,newPaidCostUsd:0,publicationApproved:false}
}
