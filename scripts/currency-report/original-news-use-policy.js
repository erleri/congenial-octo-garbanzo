// Apply an already reviewed publisher/material policy to exact new captures.
// Does not interpret terms, infer permission from robots, or promote note use.
import {fingerprint} from './research-harness.js'
import {inspectSourceUses,sourceUseBinding} from './source-use.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {validDate} from './core.js'
import {articleOriginHints} from './news-publisher-access.js'
export const ORIGINAL_USE_POLICY_VERSION='original-news-use-policy/1'

export const bindOriginalUsePolicy=policy=>({...structuredClone(policy),binding:fingerprint(policy)})
export function applyOriginalUsePolicies({collection,registry,evaluatedOn}){
 if(registry?.version!==ORIGINAL_USE_POLICY_VERSION||!Array.isArray(registry.policies)||registry.policies.length>40
   ||new Set(registry.policies.map(p=>p.id)).size!==registry.policies.length||!validDate(evaluatedOn))throw new Error('invalid_original_use_registry')
 const reviews=[],policyDecisions=[],renderings={external_model:[]}
 for(const card of collection.reviewQueue.filter(c=>c.materialKind==='article')){
   const {original}=validateSelectedReviewCard(collection,card),url=new URL(original.url)
   const matches=registry.policies.filter(p=>p.sourceId===card.sourceId&&p.currency===collection.currency
     &&p.origin===url.origin&&typeof p.pathPrefix==='string'&&p.pathPrefix.startsWith('/')&&url.pathname.startsWith(p.pathPrefix))
   if(matches.length!==1){policyDecisions.push({originalId:original.id,status:'pending',reason:matches.length?'ambiguous_source_policy':'matching_original_policy_missing'});continue}
   const {binding,...policy}=matches[0]
   if(binding!==fingerprint(policy)||policy.version!==ORIGINAL_USE_POLICY_VERSION||policy.materialKind!=='publisher_article_text'
     ||!['pending','reviewed'].includes(policy.status)||!validDate(policy.checkedOn)||policy.checkedOn>evaluatedOn
     ||typeof policy.reason!=='string'||policy.reason.length<10)throw new Error('original_policy_binding_or_material_mismatch')
   if(policy.status==='pending'){
     policyDecisions.push({originalId:original.id,policyId:policy.id,status:'pending',reason:'publisher_original_use_not_resolved'});continue
   }
   if(policy.thirdParty!=='hold_on_credited_origin'||!policy.reviewedUse)throw new Error('explicit_original_use_scope_required')
   if(policy.attribution!==undefined&&(typeof policy.attribution!=='string'||policy.attribution.trim().length<10||policy.attribution.length>480))
     throw new Error('invalid_original_policy_attribution')
   const {resourceId:discardId,resourceBinding:discardBinding,...template}=policy.reviewedUse
   // A template cannot import a previous article's identity or semantic review.
   if(discardId!==undefined||discardBinding!==undefined)throw new Error('publisher_policy_must_not_bind_an_old_article')
   const record={...structuredClone(template),resourceId:original.id,resourceBinding:sourceUseBinding(original),
     appliedPolicy:{id:policy.id,binding,materialKind:policy.materialKind,notNewSemanticReview:true}}
   const label={resourceId:original.id,resourceBinding:sourceUseBinding(original),sourceUrl:original.url,publisher:url.hostname,
     publishedAt:original.metadata?.publishedAt??null,referencePeriod:null,attribution:policy.attribution??`원출처: ${url.hostname}`,
     transformation:'LATAM FX의 내부 원문 분석용 전달이며 원문 재배포나 공개 승인이 아니다.'}
   for(const condition of record.conditions??[]){
     const alias=condition.delivery?.equals
     if(typeof alias==='string'&&alias.startsWith('@')){
       const field=alias.slice(1)
       if(!['sourceUrl','publisher','publishedAt','referencePeriod','attribution','transformation'].includes(field))throw new Error('unknown_original_delivery_placeholder')
       if(typeof label[field]==='string'&&label[field])condition.delivery.equals=label[field]
     }
   }
   const thirdParty=(original.originHints?.creditedOrigins??[]).length>0
     ||articleOriginHints(original.url,original.blocks).creditedOrigins.length>0
     ||/\b(?:Reuters|EFE|AFP)\b/i.test(original.blocks.map(b=>b.text).join('\n'))
   if(thirdParty){
     for(const use of ['external_model','public_display'])record.uses[use]={...record.uses[use],status:'pending',
       reason:'Third-party credited text requires the policy exception to be resolved.'}
   }
   const result=inspectSourceUses({resources:[original],reviews:[record],evaluatedOn,renderings:{external_model:[label]}})
   reviews.push(record)
   renderings.external_model.push(label)
   policyDecisions.push({originalId:original.id,policyId:policy.id,status:result.items[0].uses.external_model.status,
     reason:thirdParty?'third_party_exception_requires_review':result.items[0].uses.external_model.reason})
 }
 return {evaluatedOn,reviews,renderings,policyDecisions,policyVersion:ORIGINAL_USE_POLICY_VERSION,
   manualUserTasks:[],meaningVerified:false,publicationApproved:false}
}
