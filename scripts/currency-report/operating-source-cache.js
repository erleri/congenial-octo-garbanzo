import {fingerprint} from './research-harness.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {NEWS_INTERPRETATION_VERSION} from './news-attribution.js'
import {FX_REPORT_PRIORITY_VERSION} from './fx-report-priority.js'
import {NEWS_EVENT_DATE_VERSION} from './news-event-date.js'
import {ORIGINAL_NEWS_PIPELINE_VERSION} from './original-news-pipeline.js'
import {RESEARCH_CONTINUATION_VERSION,sourceContinuation} from './research-continuation.js'
import {SOURCE_REVIEW_VALIDITY_VERSION,effectiveSourceReview,isUnreviewedSourceCapture} from './source-review-validity.js'
import {RUNTIME_ASSEMBLY_VERSION} from './runtime-assembly.js'
export const newsEdition=original=>({url:original.url,identity:fingerprint({blocks:original.blocks,
 publishedAt:original.metadata?.publishedAt??null,modifiedAt:original.metadata?.modifiedAt??null})})
export function officialMaterialEditions(statistics=[]) {
 const groups=new Map()
 for(const s of statistics){
  const url=s.release?.url??s.releaseUrl,publishedAt=s.release?.publishedOn??s.publishedAt
  if(!groups.has(url))groups.set(url,{url,publishedAt,rows:[]})
  groups.get(url).rows.push({seriesId:s.seriesId,definitionId:s.definitionId,period:s.period,value:s.value,
   comparison:s.scope?.comparison,releaseHash:s.release?.editionHash??s.editionHash??s.release?.sha256??s.releaseHash})
 }
 return [...groups.values()].map(({rows,...group})=>({...group,identity:fingerprint(rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))}))
}
export function newOfficialMaterialCandidates(admission,publications) {
 const latest=[...publications].filter(p=>p.state==='published'&&p.approved&&!p.withdrawn).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0]
 return officialMaterialEditions(admission?.admitted).filter(e=>!latest||!(latest.materialEditions??[]).some(old=>old.url===e.url&&old.identity===e.identity)
  // Date-only releases on the publication day have unknown intraday order.
  // Keep an unseen edition as a research candidate; the writer/reviewer must
  // still establish novelty. Do not silently classify it as older material.
  &&(e.publishedAt>=latest.publishedAt.slice(0,10)||(latest.materialEditions??[]).some(old=>old.url===e.url&&old.identity!==e.identity)))
}
export function newMaterialCandidates(collection,publications) {
 const latest=[...publications].filter(p=>p.state==='published'&&p.approved&&!p.withdrawn).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0]
 const earlier=latest?.materialEditions??[]
 return collection.originals.filter(o=>{
  if(o.kind!=='article')return false
  const current=newsEdition(o)
  if(earlier.some(e=>e.url===current.url&&e.identity===current.identity))return false
  if(!latest)return true
  // Old unknown articles are not automatically new events. They may still be
  // used for a due cumulative/periodic review, with their original dates.
  return Date.parse(o.metadata?.publishedAt)>Date.parse(latest.publishedAt)
   ||Date.parse(o.metadata?.modifiedAt)>Date.parse(latest.publishedAt)
   ||earlier.some(e=>e.url===current.url&&e.identity!==current.identity)
 })
}
export function operatingMaterialHash(country) {
 const identities=country.collection.originals.map(o=>fingerprint({sourceId:o.sourceId,url:o.url,
  body:o.blocks??o.observations??o.sha256,metadata:o.metadata??null,originHints:o.originHints??null}))
 // Numeric releases/revisions can change the consumer context without any new
 // article or FX observation. Ignore fresh capture clocks, retain actual values,
 // definitions, release edition, terms state and failure state for rechecking.
 const official=country.officialBackground?.admission
 return fingerprint({newsRules:NEWS_INTERPRETATION_VERSION,dateRules:NEWS_EVENT_DATE_VERSION,writingRules:FX_REPORT_PRIORITY_VERSION,assemblyVersion:RUNTIME_ASSEMBLY_VERSION,
  pipelineRules:ORIGINAL_NEWS_PIPELINE_VERSION,continuationRules:RESEARCH_CONTINUATION_VERSION,
  revalidations:(country.collection.reviewRevalidations??[]).map(r=>({priorKeys:r.priorKeys,reason:r.reason}))
   .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),news:[...new Set(identities)].sort(),...(official?{official:{
  admitted:official.admitted.map(({seriesId,definitionId,definitionVersion,period,value,scope,release})=>({seriesId,definitionId,definitionVersion,period,value,scope,
   release:{url:release.url,sha256:release.editionHash??release.sha256,publishedOn:release.publishedOn}}))
   .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),
  holds:[...new Set(official.rows.filter(r=>r.reason).map(r=>r.reason))].sort()}}:{})})
}
// Shared cost-planning/execution lookup. Reuse is not new content approval;
// the downstream receipt, note-use and writing validators remain mandatory.
export function savedSourceReview(saved,card) {
 const matches=saved.filter(s=>s.cardBinding===card.binding)
 if(matches.length>1)throw Error('ambiguous_saved_review')
 const prior=matches[0]
 if(prior&&!prior.heldStatus&&prior.receipt?.cardBinding!==card.binding)throw Error('saved_review_binding_changed')
 return prior??null
}
// Reuse an earlier immutable capture/review, never rebind its receipt to the
// new capture time, target date, body or model. Current source-use gates rerun.
export function operatingSourceKey(original,rulesBinding) {
 return fingerprint({version:'operating-source-cache/2',newsRules:NEWS_INTERPRETATION_VERSION,sourceId:original.sourceId,url:original.url,
  bodyHash:fingerprint(original.blocks),metadata:original.metadata,
  originHints:original.originHints,rulesBinding})
}
const reviewRecordKey=r=>isUnreviewedSourceCapture(r)?fingerprint({version:'unreviewed-source-capture/1',sourceKey:r.sourceKey})
 :fingerprint({version:'operating-source-review-record/3',sourceKey:r.sourceKey,cardBinding:r.card.binding,reviewBinding:fingerprint(r.review)})
export function unreviewedSourceCapture(collection,cardBinding,rulesBinding){
 const card=collection.reviewQueue.find(c=>c.binding===cardBinding)
 if(!card)throw Error('queued_source_card_required')
 const {original}=validateSelectedReviewCard(collection,card)
 const record={kind:'unreviewed_source_capture',sourceKey:operatingSourceKey(original,rulesBinding),
  currency:collection.currency,rulesBinding,original,card,
  review:{cardBinding:card.binding,heldStatus:'unreviewed_capture',validity:{state:'unreviewed'},
   meaning:'durable_body_only_no_extraction_comparison_or_publication_approval'}}
 return {...record,key:reviewRecordKey(record)}
}
export async function persistDeferredSources(countries,store,rulesBinding){
 for(const country of countries){
  const deferred=country.preparation?.deferredCardBindings??[]
  if(!deferred.length)continue
  if(!store.sourceCache||!store.saveSourceReview)throw Error('durable_source_backlog_store_required')
  const cached=await store.sourceCache(country.currency,rulesBinding)
  for(const binding of deferred){
   const record=unreviewedSourceCapture(country.collection,binding,rulesBinding)
   if(cached.some(r=>(r.sourceKey??r.key)===record.sourceKey))continue
   try{await store.saveSourceReview(record);cached.push(record)}catch(error){
    if(error.code!=='22023')throw error
    // A concurrent free/executing runner may have stored the same edition
    // under its original capture clock. Verify the winner before accepting it.
    const latest=await store.sourceCache(country.currency,rulesBinding)
    const winner=latest.find(r=>r.key===record.key)
    if(!winner||reviewRecordKey(winner)!==winner.key||operatingSourceKey(winner.original,rulesBinding)!==record.sourceKey)throw error
    validateSelectedReviewCard({version:collectionVersion,originals:[winner.original],reviewQueue:[winner.card]},winner.card)
    cached.push(winner)
   }
  }
 }
}
const collectionVersion='selected-source-collection/1'
export function reuseOperatingSources(collection,cache,rulesBinding) {
 const copy=structuredClone(collection),savedSourceReviews=[],replacements=new Map()
 copy.reviewRevalidations=[]
 for(let i=0;i<copy.reviewQueue.length;i++){
  const card=copy.reviewQueue[i],{original}=validateSelectedReviewCard(copy,card)
  const key=operatingSourceKey(original,rulesBinding)
  const eligible=cache.filter(c=>c.key===key||c.sourceKey===key)
  for(const record of eligible)if(record.sourceKey&&record.key!==reviewRecordKey(record))throw Error('operating_source_cache_changed')
  const effective=effectiveSourceReview(eligible,{pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION})
  if(['conflict','revalidation_required'].includes(effective.state)){
   copy.reviewRevalidations.push({cardBinding:card.binding,priorKeys:effective.priorKeys,reason:effective.state})
   continue
  }
  const prior=effective.record
  if(!prior)continue
  if(effective.state==='unreviewed')continue
  if(effective.state==='withdrawn'){
   copy.reviewRevalidations.push({cardBinding:card.binding,priorKeys:effective.priorKeys,reason:'withdrawn'})
   savedSourceReviews.push({cardBinding:card.binding,heldStatus:'source_review_withdrawn',holds:['source_review_withdrawn']});continue
  }
  // A held note must be reconsidered when newly covered dates might resolve
  // it. An accepted exact note remains valid within a broader research window;
  // retaining its old receipt does not certify coverage of the added dates.
  const scopeRows=value=>[...new Set(value.targets.map(t=>fingerprint({needId:t.needId,
   requestedPeriod:t.requestedPeriod,requestedScope:t.requestedScope})))].sort()
  const currentScope=scopeRows(card),priorScope=scopeRows(prior.card)
  const acceptedWithinExpandedWindow=!prior.review.heldStatus&&!!prior.review.receipt&&priorScope.every(s=>currentScope.includes(s))
  const questionShape=value=>fingerprint([...new Set(value.targets.map(t=>fingerprint({needId:t.needId,requestedScope:t.requestedScope})))].sort())
  const explicitlyUnrelated=prior.review.heldStatus==='unrelated'&&prior.review.pipelineVersion===ORIGINAL_NEWS_PIPELINE_VERSION
   &&prior.review.holds?.length&&prior.review.holds.every(h=>h==='unrelated')&&questionShape(card)===questionShape(prior.card)
  if(fingerprint(currentScope)!==fingerprint(priorScope)&&!acceptedWithinExpandedWindow&&!explicitlyUnrelated){
   copy.reviewRevalidations=copy.reviewRevalidations.filter(r=>r.cardBinding!==card.binding)
   copy.reviewRevalidations.push({cardBinding:card.binding,priorKeys:effective.priorKeys,reason:'revalidation_required'})
   continue
  }
  // An explicit replacement judgment is a new validity edition even if the
  // article bytes did not change. Routine first-time successful caching is not.
  if(prior.review.validity?.supersedes?.length)copy.reviewRevalidations.push({cardBinding:card.binding,
   priorKeys:effective.priorKeys,reason:effective.state==='held'?'held_review_revision':'usable_review_revision'})
  // Temporary failures are replayed through the durable exact-request jobs,
  // not cached as a permanent semantic rejection. Old records remain intact.
  if(prior.review.heldStatus&&sourceContinuation({status:prior.review.heldStatus,holds:prior.review.holds}).resumeExact)continue
  if(prior.review.heldStatus&&prior.review.pipelineVersion&&prior.review.pipelineVersion!==ORIGINAL_NEWS_PIPELINE_VERSION){
   copy.reviewRevalidations=copy.reviewRevalidations.filter(r=>r.cardBinding!==card.binding)
   copy.reviewRevalidations.push({cardBinding:card.binding,priorKeys:effective.priorKeys,reason:'revalidation_required'})
   continue
  }
  // Keep successful immutable reviews reusable; obsolete holds must not hide
  // corrected parser/guidance behavior forever. Reassessment is not permission
  // for a new paid call; the ordinary budget and dispatch gates still apply.
  const dateParserHold=(prior.review.holds??[]).some(h=>['event_date_evidence_mismatch','relative_event_date_ambiguous',
   'extraction_event_or_role_mismatch','extraction_event_outside_research_window','event_date_unverified',
   'invalid_original_comparison','original_claim_support_not_confirmed'].includes(h))
  if(prior.review.heldStatus&&dateParserHold&&prior.review.dateRuleVersion!==NEWS_EVENT_DATE_VERSION){
   copy.reviewRevalidations=copy.reviewRevalidations.filter(r=>r.cardBinding!==card.binding)
   copy.reviewRevalidations.push({cardBinding:card.binding,priorKeys:effective.priorKeys,reason:'revalidation_required'})
   continue
  }
  if(prior.sourceKey&&prior.key!==reviewRecordKey(prior))throw Error('operating_source_cache_changed')
  if(prior.rulesBinding!==rulesBinding||prior.currency!==copy.currency
   ||operatingSourceKey(prior.original,rulesBinding)!==key||prior.review.cardBinding!==prior.card.binding
   ||!prior.review.heldStatus&&prior.review.receipt?.cardBinding!==prior.card.binding)throw Error('operating_source_cache_changed')
  const index=copy.originals.findIndex(o=>o.id===original.id)
  copy.originals[index]=structuredClone(prior.original);copy.reviewQueue[i]=structuredClone(prior.card)
  replacements.set(original.id,prior.original.id)
  savedSourceReviews.push(structuredClone(prior.review))
  validateSelectedReviewCard(copy,copy.reviewQueue[i])
 }
 for(const o of copy.outcomes??[])if(o.originalIds)o.originalIds=o.originalIds.map(id=>replacements.get(id)??id)
 return {collection:copy,savedSourceReviews}
}
export function operatingSourceRecords(collection,reviewed,rulesBinding) {
 const reused=new Set(reviewed.items.filter(i=>i.status.startsWith('exact_saved_')).map(i=>i.cardBinding))
 const good=reviewed.receipts.filter(r=>!reused.has(r.cardBinding)).map(receipt=>{
  const card=collection.reviewQueue.find(c=>c.binding===receipt.cardBinding)
  if(!card)throw Error('operating_review_card_missing')
  const {original}=validateSelectedReviewCard(collection,card)
  return {key:operatingSourceKey(original,rulesBinding),currency:collection.currency,rulesBinding,
   original,card,review:{cardBinding:card.binding,receipt,
    pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,assessment:reviewed.items.find(i=>i.cardBinding===card.binding)?.assessment??null,
    materialInput:reviewed.materialInputs.find(m=>m.cardBinding===card.binding)?.input??null}}
 })
 const rejected=reviewed.items.filter(i=>i.modelCalls>0&&Number.isFinite(i.costUsd)&&!good.some(g=>g.card.binding===i.cardBinding)
  &&!sourceContinuation(i).resumeExact&&!['accounting','technical'].includes(sourceContinuation(i).category)).map(i=>{
  const card=collection.reviewQueue.find(c=>c.binding===i.cardBinding),{original}=validateSelectedReviewCard(collection,card)
  return {key:operatingSourceKey(original,rulesBinding),currency:collection.currency,rulesBinding,original,card,
   review:{cardBinding:card.binding,heldStatus:i.status,dateRuleVersion:NEWS_EVENT_DATE_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,
    continuation:sourceContinuation(i),holds:i.holds??[i.reason??i.status]}}
 })
 // New judgments append an immutable edition; a corrected rule must not
 // overwrite a past rejection or collide with its primary key in the store.
 return [...good,...rejected].map(record=>{
  const next={...record,sourceKey:record.key}
  next.review={...next.review,validity:{version:SOURCE_REVIEW_VALIDITY_VERSION,pipelineVersion:ORIGINAL_NEWS_PIPELINE_VERSION,
   state:record.review.heldStatus?'held':'usable',
   supersedes:collection.reviewRevalidations?.find(r=>r.cardBinding===record.card.binding)?.priorKeys??[]}}
  return {...next,key:reviewRecordKey(next)}
 })
}
