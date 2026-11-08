// Shared private reading rules, not a publisher licence or a legal conclusion.
// Read the complete captured body without percentage/paragraph truncation.
// Recorded purpose restrictions and raw-public-display prohibition still apply.
import {fingerprint} from './research-harness.js'
import {sourceUseBinding,inspectSourceUses} from './source-use.js'
import {validateSelectedReviewCard} from './selected-source-collection.js'
import {articleOriginHints} from './news-publisher-access.js'
import {validDate} from './core.js'
import {applyOriginalUsePolicies} from './original-news-use-policy.js'
import {referenceMaterialHolds} from './reference-material-state.js'
import {unsafeSourceText} from './source-text-safety.js'

export const MATERIAL_PROCESSING_VERSION='material-processing/2'
export const bindProcessingRules=rules=>({...structuredClone(rules),binding:fingerprint(rules)})
const unsafe=unsafeSourceText
const fail=(code,details={})=>({status:'hold',reason:code,...details,licenseGranted:false,publicationApproved:false})

export function assertProcessingRules(rules) {
 const {binding,...body}=rules??{}
 if(rules?.version!==MATERIAL_PROCESSING_VERSION||binding!==fingerprint(body)||!validDate(rules.reviewedOn)
  ||rules.defaultArticleMode!=='private_article_analysis'||rules.rawPublicDisplay!==false
  ||rules.analysisContext?.mode!=='complete_captured_body'||rules.analysisContext.truncation!=='forbidden'
  ||Object.keys(rules.analysisContext).some(k=>!['mode','truncation'].includes(k))
  ||!Array.isArray(rules.restrictions)||rules.restrictions.length>100
  ||rules.sourceNotices!==undefined&&(!Array.isArray(rules.sourceNotices)||rules.sourceNotices.length>100
   ||new Set(rules.sourceNotices.map(n=>n.id)).size!==rules.sourceNotices.length)
  ||new Set(rules.restrictions.map(r=>r.id)).size!==rules.restrictions.length)throw Error('bound_common_processing_rules_required')
 for(const r of rules.restrictions){
  let u
  try{u=new URL(r.origin)}catch{throw Error('invalid_processing_restriction')}
  if(u.origin!==r.origin||u.protocol!=='https:'||!r.id||!r.pathPrefix?.startsWith('/')
   ||!['all_external_text','full_article','authored_notes','public_notes'].includes(r.target)
   ||!['deny','review'].includes(r.effect)||!validDate(r.checkedOn)||!r.evidenceUrl?.startsWith('https://')
   ||typeof r.reason!=='string'||r.reason.length<10)throw Error('invalid_processing_restriction')
 }
 for(const n of rules.sourceNotices??[]){
  let u
  try{u=new URL(n.origin)}catch{throw Error('invalid_source_scope_notice')}
  if(u.origin!==n.origin||u.protocol!=='https:'||!n.id||!n.pathPrefix?.startsWith('/')||!validDate(n.checkedOn)
   ||!Array.isArray(n.evidenceUrls)||!n.evidenceUrls.length||n.evidenceUrls.length>6||n.evidenceUrls.some(v=>!v.startsWith('https://'))
   ||typeof n.summary!=='string'||n.summary.length<10||n.summary.length>480
   ||n.aiPermission!=='not_explicitly_addressed'||n.grantsUse!==false)throw Error('invalid_source_scope_notice')
 }
 return rules
}
export function matchingProcessingRestrictions({rules,url,target,evaluatedOn}) {
 assertProcessingRules(rules)
 const u=new URL(url)
 return rules.restrictions.filter(r=>r.origin===u.origin&&u.pathname.startsWith(r.pathPrefix)
  &&(r.target===target||target==='full_article'&&r.target==='all_external_text')&&r.checkedOn<=evaluatedOn)
}

export function buildAnalysisContext(original,rules) {
 assertProcessingRules(rules)
 if(original.kind!=='article'||!Array.isArray(original.blocks)||!original.blocks.length)return fail('unsupported_material_format')
 if(original.metadata?.isAccessibleForFree===false||original.access?.barrier)return fail('restricted_access_material')
 if(original.blocks.some(b=>typeof b?.text!=='string'||!b.text.trim()))return fail('invalid_article_body')
 if(unsafe(JSON.stringify(original.blocks)))return fail('unsafe_original_material')
 const blocks=original.blocks.map((b,index)=>({kind:b.kind,text:b.text,index}))
 const characters=blocks.reduce((n,b)=>n+b.text.length,0)
 // Content completeness is determined by the actual collector, not by a small
 // selected fraction. Reading every captured block cannot prove that the
 // publisher page itself was complete or that its claims are true.
 const context={version:MATERIAL_PROCESSING_VERSION,profile:'private_article_analysis',originalId:original.id,
  originalBinding:fingerprint(original),sourcePositions:blocks.map(b=>b.index),
  sourceSpans:blocks.map(b=>({blockIndex:b.index,start:0,end:b.text.length})),
  unitNormalization:'original_blocks_unchanged',originalBlockCount:original.blocks.length,blocks,characters,totalCharacters:characters,
  omittedBlockCount:0,omittedSensitiveBlocks:0,
  scope:'complete_captured_body_not_publisher_completeness_guarantee',completeCapturedBodyIncluded:true,publisherBodyCompleteness:'unverified',
  fullArticleIncluded:null,rawPublicDisplay:false,licenseGranted:false,policyBinding:rules.binding}
 return {...context,status:'prepared',binding:fingerprint(context)}
}
export function assertAnalysisContext(original,context,rules) {
 const expected=buildAnalysisContext(original,rules)
 if(expected.status!=='prepared'||fingerprint(expected)!==fingerprint(context))throw Error('analysis_context_changed_or_incomplete')
 return expected
}

export function applyMaterialProcessing({collection,legacyRegistry,rules,evaluatedOn}) {
 assertProcessingRules(rules)
 if(!validDate(evaluatedOn)||rules.reviewedOn>evaluatedOn)throw Error('processing_policy_cutoff_required')
 const reviews=[],policyDecisions=[],contexts=[],renderings={external_model:[]}
 for(const card of collection.reviewQueue.filter(c=>c.materialKind==='article')){
  let original,u
  try{({original}=validateSelectedReviewCard(collection,card));u=new URL(original.url)}catch{
   policyDecisions.push({originalId:card.originalId,cardBinding:card.binding,...fail('invalid_bound_source_material')});continue
  }
  // Isolate a malformed/sensitive original. Passing the entire raw collection
  // into the common validator would otherwise make one bad outlet stop all
  // other candidates, even though no text from that outlet may be transmitted.
  if(unsafe(JSON.stringify(original))){policyDecisions.push({originalId:original.id,...fail('unsafe_original_material')});continue}
  if(original.sourceAdmission&&(!original.sourceAdmission.scopes?.analyze||!original.sourceAdmission.scopes?.publishNotes
   ||original.sourceAdmission.url!==original.url||(original.sourceAdmission.actualCaptureHash??original.sourceAdmission.captureHash)!==original.sha256
   ||original.sourceAdmission.expiresAt.slice(0,10)<evaluatedOn)){
   policyDecisions.push({originalId:original.id,...fail('source_admission_scope_hold')});continue
  }
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.search||original.url.length>480){policyDecisions.push({originalId:original.id,...fail('unsafe_or_unsupported_material_locator')});continue}
  const restrictions=matchingProcessingRestrictions({rules,url:original.url,target:'all_external_text',evaluatedOn})
  // Retain explicit pre-existing denials. A legacy 'pending full text' record is
  // not a denial of bounded context; no country or newspaper exception is added.
  const legacy=(legacyRegistry?.policies??[]).filter(p=>p.origin===u.origin&&u.pathname.startsWith(p.pathPrefix)
   &&p.status==='reviewed'&&p.checkedOn<=evaluatedOn)
  for(const p of legacy){const {binding,...body}=p;if(binding!==fingerprint(body))throw Error('legacy_processing_policy_changed')}
  if(restrictions.length||legacy.some(p=>p.reviewedUse?.uses.external_model.status==='denied')){
   const denied=restrictions.some(r=>r.effect==='deny')||legacy.some(p=>p.reviewedUse?.uses.external_model.status==='denied')
   policyDecisions.push({originalId:original.id,status:denied?'denied':'pending',reason:denied?'explicit_external_text_denied':'explicit_external_text_scope_review',restrictionIds:restrictions.map(r=>r.id),profile:'none'});continue
  }
  if(legacy.some(p=>p.sourceId===card.sourceId&&p.currency===collection.currency&&p.reviewedUse?.uses.external_model.status==='pending')){
   policyDecisions.push({originalId:original.id,status:'pending',reason:'explicit_external_text_scope_review',profile:'none'});continue
  }
  const fullRestrictions=matchingProcessingRestrictions({rules,url:original.url,target:'full_article',evaluatedOn})
  if(fullRestrictions.length){
   policyDecisions.push({originalId:original.id,status:fullRestrictions.some(r=>r.effect==='deny')?'denied':'pending',
    reason:fullRestrictions.some(r=>r.effect==='deny')?'explicit_full_article_denied':'explicit_full_article_scope_review',
    restrictionIds:fullRestrictions.map(r=>r.id),profile:'none'});continue
  }
  if(legacy.some(p=>p.sourceId===card.sourceId&&p.currency===collection.currency&&p.reviewedUse?.uses.external_model.status==='allowed')){
   const explicit=applyOriginalUsePolicies({collection:{...collection,reviewQueue:[card],originals:[original]},registry:legacyRegistry,evaluatedOn})
   if(explicit.policyDecisions[0]?.status==='allowed'){
    for(const r of explicit.reviews)r.uses.public_display={status:'denied',reason:'Raw article public display is outside the shared report processing contract.',conditionIds:[]}
    reviews.push(...explicit.reviews);renderings.external_model.push(...explicit.renderings.external_model)
    policyDecisions.push({...explicit.policyDecisions[0],profile:'full_original_explicit_review'});continue
   }
   // Delivery conditions or an explicitly reviewed third-party exception must
   // not be bypassed by falling through to the general private-reading profile.
   policyDecisions.push({originalId:original.id,status:'pending',reason:'explicit_full_article_scope_review',profile:'none'});continue
  }
  const context=buildAnalysisContext(original,rules)
  if(context.status!=='prepared'){policyDecisions.push({originalId:original.id,status:'pending',reason:context.reason,profile:'private_article_analysis'});continue}
  const origins=[...new Set([...(original.originHints?.creditedOrigins??[]),...articleOriginHints(original.url,original.blocks).creditedOrigins])]
  const label={resourceId:original.id,resourceBinding:sourceUseBinding(original),sourceUrl:original.url,publisher:u.hostname,
   publishedAt:original.metadata?.publishedAt??null,referencePeriod:null,
   attribution:`출처: ${u.hostname}${origins.length?' · 기사에 표기된 제공 출처: '+origins.join(', '):''}`,
   transformation:'수집 본문을 생략 없이 비공개 분석하여 독립 작성 사실·귀속 견해만 만든다. 원문 공개·번역문·기사 대체물·학습 용도가 아니다.'}
  const notices=(rules.sourceNotices??[]).filter(n=>n.origin===u.origin&&u.pathname.startsWith(n.pathPrefix)&&n.checkedOn<=evaluatedOn)
  const creditConditions=['sourceUrl','attribution','transformation'].map(field=>({id:`delivery-${field}`,
   text:`비공개 분석 요청에도 확인된 ${field} 값을 그대로 전달한다.`,status:'satisfied',delivery:{field,equals:label[field],uses:['external_model']}}))
  const record={version:'source-use/1',resourceId:original.id,resourceBinding:sourceUseBinding(original),
   terms:{url:original.url,version:rules.version+':internal_operating_scope_not_publisher_licence',reviewedOn:rules.reviewedOn},
   scope:'수집 본문 전체의 비공개 사실·귀속 견해 분석. 이 기록은 출판사의 허가·수집 완전성·의미 검토·공개 승인을 증명하지 않는다.',
   review:{origin:'agent',status:'checked',reason:'Apply complete-capture reading rules; recorded purpose restrictions, request budget and raw public-display prohibition remain in force.'},
   sourceNotices:notices.map(n=>({...n,declaredTextOrigins:origins,scope:'publication_notice_not_ai_permission_or_model_semantic_review'})),
   conditions:[{id:'exact-capture',text:'해시로 고정한 수집 본문을 생략 없이 비공개 분석 요청에 전달한다.',status:'satisfied'},...creditConditions],
   uses:{local_analysis:{status:'allowed',reason:'Captured public material is prepared for complete private reading.',conditionIds:[]},
    external_model:{status:'allowed',reason:'The exact captured body is eligible under the internal processing policy, subject to request budget and endpoint checks.',conditionIds:['exact-capture',...creditConditions.map(c=>c.id)]},
    public_display:{status:'denied',reason:'Original article text and analysis excerpts are never public report content.',conditionIds:[]}},
   appliedProcessing:{version:rules.version,profile:'private_article_analysis',contextBinding:context.binding,policyBinding:rules.binding}}
  reviews.push(record);contexts.push(context);renderings.external_model.push(label)
  policyDecisions.push({originalId:original.id,status:'allowed',reason:'private_capture_analysis_operationally_eligible_not_publisher_licence',
   profile:'private_article_analysis',contextBinding:context.binding,missingPublisherRecordIsNotDenial:true,creditedOrigins:origins,
   noticeIds:notices.map(n=>n.id),noticeIsNotAiPermission:true})
 }
 inspectSourceUses({resources:collection.originals.filter(o=>reviews.some(r=>r.resourceId===o.id)),reviews,evaluatedOn,renderings})
 return {evaluatedOn,reviews,renderings,policyDecisions,contexts,processingRules:rules,
  policyVersion:MATERIAL_PROCESSING_VERSION,manualUserTasks:[],meaningVerified:false,publicationApproved:false}
}

export function commonAuthoredNotePolicy({evidence,rules,evaluatedOn}) {
 const restrictions=matchingProcessingRestrictions({rules,url:evidence.url,target:'authored_notes',evaluatedOn})
 const publicRestrictions=matchingProcessingRestrictions({rules,url:evidence.url,target:'public_notes',evaluatedOn})
 const state=restrictions.some(r=>r.effect==='deny')?'denied':restrictions.length?'pending':'allowed'
 return {version:'source-use/1',terms:{url:evidence.url,version:rules.version+':independently_authored_notes_not_raw_article',reviewedOn:rules.reviewedOn},
  scope:'검토된 자체 사실·귀속 견해 카드만 집필·분석에 사용한다. 원문·번역문·기사 대체물과 전문 출처의 이용 조건은 포함하지 않는다.',
  review:{origin:'agent',status:'checked',reason:'Apply the common note profile only after separate support, attribution, independent-wording and scope checks.'},conditions:[],
  appliedProcessing:{version:rules.version,profile:'authored_facts_and_attributed_views',policyBinding:rules.binding},
  uses:Object.fromEntries(['local_analysis','external_model','public_display'].map(use=>[use,{status:use==='public_display'&&publicRestrictions.length
   ?publicRestrictions.some(r=>r.effect==='deny')||state==='denied'?'denied':'pending':state,
   reason:'Only checked independently authored facts and attributed views are eligible; publication approval remains separate.',conditionIds:[]}]))}
}

// Current restrictions also apply to reused notes. This only downgrades use;
// it never relabels an old note as newly verified or upgrades an old approval.
export function restrictCachedNoteMaterial(input,rules,evaluatedOn) {
 assertProcessingRules(rules)
 const next=structuredClone(input)
 for(const e of next.packet.evidence){
  const r=next.sourceUse.reviews.find(r=>r.resourceId===e.id)
  if(!r||r.resourceBinding!==sourceUseBinding(e))throw Error('cached_note_use_binding_required')
  const note=matchingProcessingRestrictions({rules,url:e.url,target:'authored_notes',evaluatedOn})
  const display=matchingProcessingRestrictions({rules,url:e.url,target:'public_notes',evaluatedOn})
  for(const use of ['local_analysis','external_model','public_display'])if(note.length||use==='public_display'&&display.length)
   r.uses[use]={...r.uses[use],status:r.uses[use].status==='denied'||[...note,...(use==='public_display'?display:[])].some(x=>x.effect==='deny')?'denied':'pending',reason:'Current recorded note-processing restriction requires resolution.'}
 }
 return next
}
export function restrictCachedHandoff(handoff,rules,evaluatedOn) {
 assertProcessingRules(rules)
 const c=handoff.materialConnection,{binding,...body}=c
 if(binding!==fingerprint(body))throw Error('cached_handoff_binding_required')
 const next=structuredClone(handoff),n=next.materialConnection
 for(const [role,rows] of Object.entries(n.sections)){
  const keep=[]
  for(const item of rows){
   const note=matchingProcessingRestrictions({rules,url:item.sourceUrl,target:'authored_notes',evaluatedOn})
   const display=matchingProcessingRestrictions({rules,url:item.sourceUrl,target:'public_notes',evaluatedOn})
   if(note.length){n.archive.push({...item,reason:'current_authored_note_processing_restriction'});continue}
   if(display.length)item.sourceUses.public_display={status:item.sourceUses.public_display?.status==='denied'||display.some(x=>x.effect==='deny')?'denied':'pending',reason:'Current public-note restriction requires resolution.'}
   keep.push(item)
  }
  n.sections[role]=keep
 }
 n.holds=referenceMaterialHolds({sections:n.sections,held:n.held,priorHolds:n.holds,priceHeld:n.holds.includes('shared_reference_price_held')})
 n.processingPolicy={version:rules.version,binding:rules.binding,scope:'current_note_restrictions_rechecked_not_new_semantic_review'}
 delete n.binding;n.binding=fingerprint(n)
 return next
}

export function assertIndependentNoteText(original,evidence) {
 const names=[...new Set((evidence.newsNotes?.notes??[]).flatMap(n=>n.attribution?[n.attribution.person,n.attribution.organization]:[])
  .filter(name=>typeof name==='string'&&name.trim().length>0))]
 const normalize=text=>{
  for(const name of names)text=text.replaceAll(name,'@attribution')
  return text.normalize('NFKD').replace(/\p{M}/gu,'').replace(/\s+/g,' ').trim().toLowerCase()
 }
 const body=normalize(original.blocks.map(b=>b.text).join('\n'))
 for(const n of evidence.newsNotes?.notes??[]){
  const text=normalize(n.text)
  for(let i=0;i+48<=text.length;i++)if(body.includes(text.slice(i,i+48)))throw Error('authored_note_contains_original_prose')
 }
}
