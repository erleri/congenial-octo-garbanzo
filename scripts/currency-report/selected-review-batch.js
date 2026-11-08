// Repeatable, offline orchestration of the existing source/card review contract.
// An unavailable automated reviewer is a service gap, never a manual-user task
// or implicit evidence approval. Raw originals stay inside the local collection.
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {reviewSelectedNewsMaterial,reviewSelectedStatisticMaterial} from './selected-material-review.js'
import {fingerprint} from './research-harness.js'
import {prepareSelectedNewsReview,validateSelectedNewsReview} from './selected-news-review.js'

export function prepareSelectedReviewBatch({collection,receipts=[],newsResponses=[]}) {
  if(!Array.isArray(receipts)||!Array.isArray(collection?.reviewQueue)||!Array.isArray(newsResponses)||newsResponses.length>24)
    throw new Error('invalid_review_batch')
  const bindings=new Set(collection.reviewQueue.map(c=>c.binding)),seen=new Set()
  for(const receipt of receipts){
    if(!bindings.has(receipt?.cardBinding)||seen.has(receipt.cardBinding))throw new Error('unknown_or_duplicate_review_receipt')
    seen.add(receipt.cardBinding)
  }
  for(const saved of newsResponses){
    if(!bindings.has(saved?.cardBinding)||seen.has(saved.cardBinding)
      ||!collection.reviewQueue.some(c=>c.binding===saved.cardBinding&&c.materialKind==='article'))
      throw new Error('unknown_or_duplicate_review_response')
    seen.add(saved.cardBinding)
  }
  const before=fingerprint({collection,receipts,newsResponses}),items=[]
  for(const card of collection.reviewQueue){
    const base={cardId:card.id,cardBinding:card.binding,originalId:card.originalId,sourceId:card.sourceId,
      requestedPeriodMatch:card.requestedPeriodMatch,writingEligibility:'not_assessed',publicationApproved:false}
    try{validateSelectedReviewCard(collection,card)}catch{
      items.push({...base,status:'invalid_original_binding',reason:'saved_original_or_card_changed'});continue
    }
    const saved=newsResponses.find(r=>r.cardBinding===card.binding)
    if(saved){
      try{
        const job=prepareSelectedNewsReview({collection,card})
        const checked=validateSelectedNewsReview({collection,card,job,response:saved.response})
        items.push({...base,...checked,reviewExecution:'saved_response_replay',
          semanticSupport:'recorded_judgment_not_automatically_proven'})
      }catch{
        items.push({...base,status:'review_result_invalid',reason:'bound_original_claim_or_scope_review_failed'})
      }
      continue
    }
    const receipt=receipts.find(r=>r.cardBinding===card.binding)
    if(!receipt){
      if(card.materialKind==='article'&&card.reviewAdapter==='reviewed_news_notes'){
        try{
          const job=prepareSelectedNewsReview({collection,card})
          base.newsReviewPreparation={version:job.version,jobBinding:job.binding,time:job.time,
            sourceUses:job.sourceUses,originHints:job.originHints,blockCount:job.blocks.length,
            rawBodyIncluded:false,externalDispatchAllowed:false}
        }catch{
          items.push({...base,status:'review_preparation_failed',reason:'news_body_or_time_invalid'});continue
        }
      }
      items.push({...base,status:'automatic_review_unavailable',reason:'no_bound_content_review_result',
        reviewAdapter:card.reviewAdapter,requiredChecks:[...card.requiredChecks]});continue
    }
    const apply=card.materialKind==='article'?reviewSelectedNewsMaterial:card.materialKind==='statistic'?reviewSelectedStatisticMaterial:null
    if(!apply){items.push({...base,status:'review_adapter_unavailable',reason:card.reviewAdapter});continue}
    try{
      const evidence=apply({collection,card,receipt})
      items.push({...base,status:'review_receipt_verified',evidence,
        reason:'saved_review_replayed_not_new_independent_review'})
    }catch{
      items.push({...base,status:'review_result_invalid',reason:'existing_card_scope_or_support_checks_failed'})
    }
  }
  if(fingerprint({collection,receipts,newsResponses})!==before)throw new Error('review_batch_input_mutated')
  return {version:'selected-review-batch/1',currency:collection.currency,collectionHash:fingerprint(collection),
    collectionOutcomes:collection.outcomes.map(o=>({sourceId:o.sourceId,status:o.status,reason:o.reason??null,
      issues:o.issues??[],absenceVerified:false})),items,
    automaticContentReviewPerformed:false,externalDispatchAllowed:false,manualUserTasks:[],
    modelCalls:0,networkCalls:0,newPaidCostUsd:0,writingEligibility:'not_assessed',publicationApproved:false}
}
