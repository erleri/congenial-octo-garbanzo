// Offline review boundary. The reviewer supplies semantic judgments; hashes and
// checks validate their scope/identity, never their truth or publication authority.
import {createHash} from 'node:crypto'
import {validDate} from './core.js'
import {packetBinding} from './rules.js'
import {createSourceContext} from './source-context.js'
import {bindEvidenceScope,projectEvidenceScopes} from './evidence-scope.js'
import {HARNESS_VERSION,evidenceBinding,compileBrief} from './research-harness.js'
import {researchTimeScope,originalPriceTimeRelation} from './research-time-scope.js'
import {NOTE_AUTHORING_VERSION,NOTE_AUTHORING_GUIDE} from './note-authoring.js'

export const PUBLISHER_ADMISSION_VERSION='publisher-admission/1'
export const PUBLISHER_REVIEW_CHECKS=Object.freeze([
  'full_body_and_attribution','period_and_price_basis','all_claims_supported',
  'qualifiers_and_countercontext','independence_and_duplicates','reuse_scope',
])
export const admissionHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const meaningful=v=>typeof v==='string' && v.trim().length>=10 && v.length<=480
const id=v=>typeof v==='string' && /^[a-z][a-z0-9-]{0,79}$/.test(v)
const safe=v=>!/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(v))
const timestamp=v=>typeof v==='string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))

export function publisherOriginalBinding(original) {
  return admissionHash({id:original.candidateId,url:original.url,publisher:original.publisher,title:original.title,
    metadata:original.metadata,bodyHash:original.bodyHash,capturedTextSha256:original.capturedTextSha256,
    fetchedAt:original.fetchedAt,adapterVersion:original.adapterVersion,sourceVersion:original.sourceVersion})
}

export function publisherReviewTemplate(packet,research) {
  return {version:PUBLISHER_ADMISSION_VERSION,packetHash:packetBinding(packet),reviewedOn:null,
    noteAuthoringVersion:NOTE_AUTHORING_VERSION,claimGuide:NOTE_AUTHORING_GUIDE,
    review:{origin:null,status:'pending',reason:'',checks:[]},requiredChecks:[...PUBLISHER_REVIEW_CHECKS],
    sources:research.originals.map(o=>({id:o.candidateId,originalBinding:publisherOriginalBinding(o),
      decision:'hold',reason:'',claims:[],exclusions:[],reuse:{status:'not_verified',reason:''}}))}
}

function verifyOriginal(original) {
  let url
  try {url=new URL(original.url)} catch {throw new Error('invalid_publisher_original')}
  if(url.protocol!=='https:' || url.username || url.password || url.hash || url.search
    || !id(original.candidateId) || original.status!=='collected_pending_review'
    || !timestamp(original.fetchedAt) || !timestamp(original.metadata?.publishedAt)
    || Date.parse(original.metadata.publishedAt)>Date.parse(original.fetchedAt)
    || original.sourceVersion!=='current_page_not_archived'
    || typeof original.title!=='string' || original.title.length>300
    || typeof original.publisher!=='string' || original.publisher.length>120
    || !safe({url:original.url,title:original.title,publisher:original.publisher,metadata:original.metadata})
    || !Array.isArray(original.blocks) || !original.blocks.length || original.blocks.length>160
    || original.bodyHash!==admissionHash(original.blocks)
    || !/^[a-f0-9]{64}$/.test(original.capturedTextSha256??'')) throw new Error('invalid_publisher_original')
}

function verifyReview(review,reviewedOn) {
  if(!['agent','human'].includes(review?.origin) || review.status!=='checked'
    || !validDate(reviewedOn) || !meaningful(review.reason)
    || !Array.isArray(review.checks) || PUBLISHER_REVIEW_CHECKS.some(c=>!review.checks.includes(c)))
    throw new Error('explicit_publisher_review_required')
}

function passageRefs(values,original) {
  if(!Array.isArray(values) || !values.length || values.length>8 || new Set(values).size!==values.length
    || values.some(p=>!/^p(?:0|[1-9]\d*)$/.test(p) || !original.blocks[Number(p.slice(1))]))
    throw new Error('publisher_passage_missing')
  return values
}

export function preparePublisherAdmission({packet,research,receipt}) {
  // This compiler creates a new research input. It cannot replace an existing
  // manuscript or silently merge/reapprove previously admitted evidence.
  if(!Array.isArray(packet?.evidence) || packet.evidence.length || packet.evidenceScopeCards?.length)
    throw new Error('fresh_research_packet_required')
  const timeScope=researchTimeScope(packet,'market')
  if(research?.currency!==packet.currency || research.reportDate!==packet.baseDate
    || admissionHash(research.timeScope)!==admissionHash(timeScope)
    || !Array.isArray(research.originals) || !research.originals.length || research.originals.length>8
    || new Set(research.originals.map(o=>o.candidateId)).size!==research.originals.length)
    throw new Error('publisher_research_scope_mismatch')
  if(receipt?.version!==PUBLISHER_ADMISSION_VERSION || receipt.packetHash!==packetBinding(packet)
    || !Array.isArray(receipt.sources) || receipt.sources.length!==research.originals.length
    || new Set(receipt.sources.map(s=>s.id)).size!==receipt.sources.length
    || receipt.sources.some(s=>!research.originals.some(o=>o.candidateId===s.id))
    || !safe(receipt) || Buffer.byteLength(JSON.stringify(receipt))>100000) throw new Error('stale_publisher_receipt')
  verifyReview(receipt.review,receipt.reviewedOn)
  const next=structuredClone(packet),cards=[],decisions=[],claimIds=new Set(),companions=[]
  next.evidenceScopeCards=[]
  for(const source of receipt.sources) {
    const original=research.originals.find(o=>o.candidateId===source.id)
    if(source.originalBinding!==publisherOriginalBinding(original)
      || original.fetchedAt && receipt.reviewedOn<original.fetchedAt.slice(0,10)) throw new Error('stale_publisher_original_review')
    if(!['admit','hold','exclude'].includes(source.decision) || !meaningful(source.reason)
      || !Array.isArray(source.claims) || !Array.isArray(source.exclusions) || source.exclusions.length>12
      || !['not_verified','verified_for_scope'].includes(source.reuse?.status) || !meaningful(source.reuse.reason))
      throw new Error('publisher_decision_required')
    for(const exclusion of source.exclusions) {
      if(!meaningful(exclusion.reason)) throw new Error('publisher_exclusion_reason_required')
      passageRefs(exclusion.passageIds,original)
    }
    decisions.push({id:source.id,decision:source.decision,reason:source.reason,
      originalBinding:source.originalBinding,exclusions:structuredClone(source.exclusions),reuse:structuredClone(source.reuse)})
    if(source.decision!=='admit') {
      if(source.claims.length) throw new Error('held_source_has_claims')
      continue
    }
    verifyOriginal(original)
    if(!source.claims.length || source.claims.length>8 || !validDate(source.eventDate)
      || source.eventDate>packet.baseDate || !meaningful(source.period)
      || !['article_quote_separate','no_price_used'].includes(source.priceBasis?.kind)
      || !meaningful(source.priceBasis.description) || source.priceBasis.observedAt!==null
      || !meaningful(source.allowedUse) || !meaningful(source.countercontext)
      || !Array.isArray(source.excludedExpansions) || !source.excludedExpansions.length)
      throw new Error('publisher_scope_required')
    const selected=[...new Set(source.claims.flatMap(c=>passageRefs(c.passageIds,original)))]
    if(selected.length>8) throw new Error('publisher_selection_too_large')
    const sourceContext=createSourceContext({blocks:original.blocks,selected:selected.map(p=>Number(p.slice(1)))})
    const priceTimeRelation=originalPriceTimeRelation(original.metadata,timeScope,packet.currency)
    const evidence={id:source.id,country:packet.currency,title:original.title,source:original.publisher,url:original.url,
      publishedAt:original.metadata.publishedAt,eventDate:source.eventDate,period:source.period,collectedAt:original.fetchedAt,
      summary:source.claims.map(c=>c.statement).join(' '),sourceContext,
      review:{originalVerified:true,reuse:source.reuse.status,scope:source.allowedUse,origin:receipt.review.origin},
      provenance:{sourceType:'media_reporting',sourceVersion:original.sourceVersion,
        originalBinding:source.originalBinding,receiptHash:admissionHash(receipt),
        publicationMetadata:structuredClone(original.metadata),priceTimeRelation,
        priceBasis:structuredClone(source.priceBasis),directCauseAllowed:false,publicReuseApproved:false}}
    next.evidence.push(evidence)
    for(const claim of source.claims) {
      if(!id(claim.id) || claimIds.has(claim.id) || !['fact','attributed_interpretation'].includes(claim.kind)
        || !meaningful(claim.statement) || !meaningful(claim.allowedUse) || !meaningful(claim.limit)
        || !id(claim.eventKey) || !id(claim.independenceKey)
        || !Array.isArray(claim.requiredCompanionIds) || claim.requiredCompanionIds.some(r=>!id(r) || r===claim.id))
        throw new Error('publisher_claim_invalid')
      if(claim.kind==='attributed_interpretation' && (typeof claim.attribution!=='string' || claim.attribution.trim().length<2))
        throw new Error('publisher_attribution_required')
      claimIds.add(claim.id);companions.push(...claim.requiredCompanionIds)
      const questionScope=researchTimeScope(packet,claim.questionId)
      if(source.eventDate<questionScope.startDate || source.eventDate>questionScope.endDate)
        throw new Error('publisher_claim_outside_period')
      cards.push({id:claim.id,questionId:claim.questionId,evidenceId:source.id,evidenceHash:evidenceBinding(evidence),
        passageIds:[...claim.passageIds],statement:claim.statement,allowedUse:claim.allowedUse,limit:claim.limit,
        kind:claim.kind,attribution:claim.attribution??null,eventKey:claim.eventKey,independenceKey:claim.independenceKey,
        relation:claim.relation,timeScope:source.eventDate===questionScope.anchorDate?'same_day_context':'earlier_context',review:receipt.review})
    }
    next.evidenceScopeCards.push(bindEvidenceScope(evidence,{passageIds:selected,scope:source.scope,
      admittedClaims:source.claims.map(c=>({id:c.id,kind:c.kind==='fact'?'source_fact':'source_interpretation',text:c.statement,passageIds:c.passageIds})),
      allowedUse:source.allowedUse,countercontext:source.countercontext,
      excludedExpansions:[...source.excludedExpansions,...source.exclusions.map(e=>e.reason)],
      coverageGaps:source.coverageGaps??[],crossSourceClaims:[]},receipt.review))
  }
  if(companions.some(id=>!claimIds.has(id))) throw new Error('required_countercontext_missing')
  if(next.evidence.length) projectEvidenceScopes(next,undefined,{required:true})
  const dossier={version:HARNESS_VERSION,packetHash:packetBinding(next),cards}
  const brief=compileBrief(next,dossier)
  if(brief.coverage.rejected.length) throw new Error('publisher_dossier_invalid')
  brief.instructions.push('admittedClaims에 명시한 주장만 집필 재료다. 이웃 원문은 조건·귀속을 확인하기 위한 문맥이며, 제외 수치·전망·다른 주장까지 채택한 것이 아니다.',
    'current_page_not_archived는 수집 당시 페이지다. 당시 이용 가능했던 원문이나 수정 전 내용이 보존됐다고 주장하지 않는다.')
  const holds=['independent_content_review_required','writing_value_not_assessed','public_reuse_not_approved']
  if(decisions.some(d=>d.decision==='admit' && d.reuse.status!=='verified_for_scope')) holds.push('external_model_transfer_terms_unverified')
  if(brief.status!=='ready_for_draft') holds.push('required_questions_unresolved')
  return {version:PUBLISHER_ADMISSION_VERSION,packet:next,dossier,brief,decisions,
    receiptHash:admissionHash(receipt),parentPacketHash:packetBinding(packet),
    sourceReview:{status:'reviewer_checked',origin:receipt.review.origin,independentReview:'not_performed'},
    writingEligibility:{eligible:false,reasons:holds},contentQuality:'not_assessed',publicationApproved:false,
    status:'prepared_for_local_review',networkCalls:0,modelCalls:0,newApiCostUsd:0}
}
