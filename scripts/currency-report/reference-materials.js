import {fitsCommentary} from './news-period.js'
// Offline adapter over existing bound notes, scope, role and use validators.
// Source-case prices and approvals are never copied into the shared rate packet.
import {validNewsAttribution} from './news-attribution.js'
import {validDate,referencePeriodStart} from './core.js'
import {fingerprint,inspectDossier} from './research-harness.js'
import {projectEvidenceScopes} from './evidence-scope.js'
import {prepareCountryMaterials} from './country-material-preparation.js'
import {fxCauseBinding,FX_CAUSE_VERSION} from './fx-cause-input.js'
import {projectFxWritingBackground} from './fx-writing-background.js'
import {projectSourceContext} from './source-context.js'
import {inspectSourceUses} from './source-use.js'
import {projectSourceAttributions} from './source-attributions.js'
import {SHARED_REPORT_RULE_VERSION,REPORT_REFERENCE_POLICY} from './shared-price-contract.js'
import {selectReferenceMaterialConnection} from './material-selection.js'
import {referenceMaterialHolds} from './reference-material-state.js'

export const REFERENCE_MATERIAL_VERSION='reference-materials/2'
export const REFERENCE_MATERIAL_REVIEW_VERSION='reference-material-review/1'
export const REFERENCE_MATERIAL_WRITING_GUIDE=Object.freeze([
 '기준환율 숫자와 뉴스의 실제 시장 관측을 구분한다. 날짜·가격 종류의 대응을 확인하기 전 방향 일치만으로 직접 원인으로 단정하지 않는다.',
 'writingContext의 최근 기간·장중·주요 유동성 구간·전일 사건·예정 일정을 보존한다. 예정 발표는 실제 결정이나 반대 근거가 아니다.',
 'sourceVersion의 bodyAvailableBy는 해당 판본을 수집해 확인한 시점이다. 최초 게시시각에 수정·마감 본문까지 있었다고 소급하지 않으며 modifiedAt=null은 수정 없음의 증거가 아니다.',
 '소비 지표는 원래 대상 월·분기와 조사 범위를 유지한다. 제외된 선택 배경은 이번 입력 미포함이며 현실의 미발표·부재를 뜻하지 않는다.',
 'constraint와 공통 한계는 내부 집필 기준이다. 원문을 대신할 주장이 아니며 면책 문장으로 매 문단에 복사하지 않는다. 의미를 바꾸는 시점·귀속·조건은 해당 설명에 남긴다.',
])
export const REFERENCE_MATERIAL_ROLES=Object.freeze(['market_observation','attributed_fx_explanation','global_context',
 'countercontext','consumer_background','policy_background','watch_context'])
const marketRoles=new Set(['market_observation','attributed_fx_explanation','global_context','countercontext'])
const meaningful=v=>typeof v==='string'&&v.trim().length>=10
const timed=v=>typeof v==='string'&&validDate(v.slice(0,10))&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))

function roleSelections(input,kind,scopes) {
 const packet=input.packet
 if(kind==='country_materials'){
  const prepared=prepareCountryMaterials(input)
  return {excluded:prepared.materialSelection?.excluded??[],selections:prepared.outcomes.flatMap(outcome=>{
   const record=input.materials.find(m=>m.record.evidenceId===outcome.evidenceId).record
   return Object.entries(record.claimRoles).map(([claimId,role])=>({evidenceId:outcome.evidenceId,claimId,role,
    ...(record.marketPeriod?{marketPeriod:record.marketPeriod}:{}),sourceSessionDate:record.sessionDate,priceBasis:record.priceBasis??null,bodyAvailableAt:record.bodyAvailableAt??null,
    savedHolds:outcome.holds,support:'saved_bound_role_review'}))
  })}
 }
 if(kind!=='reviewed_fx')throw new Error('reference_material_kind_required')
 const coverage=inspectDossier(packet,input.dossier),review=input.fxCauseInput?.review
 if(coverage.rejected.length||review?.version!==FX_CAUSE_VERSION||review.binding!==fxCauseBinding(packet,input.dossier)
  ||!['agent','human'].includes(review.origin)||review.status!=='checked'||review.purpose!=='fx_explanation'
  ||!meaningful(review.reason)||!Array.isArray(review.claims)||review.claims.length!==coverage.cards.length
  ||new Set(review.claims.map(r=>r.cardId)).size!==coverage.cards.length
  ||review.claims.some(r=>!coverage.cards.some(c=>c.id===r.cardId)))throw new Error('bound_reference_material_review_required')
 const background=projectFxWritingBackground(packet)
 const consumerIds=new Set(background?.consumerContext?.sourceAttributions.map(s=>s.evidenceId)??[])
 const policyIds=new Set(background?.policyBackground.map(s=>s.evidenceId)??[])
 const selections=[],excluded=[]
 for(const card of coverage.cards){
  const r=review.claims.find(r=>r.cardId===card.id),e=packet.evidence.find(e=>e.id===card.evidenceId)
  if(!['market','driver','counter','background','exclude'].includes(r.role)||typeof r.supported!=='boolean'||!meaningful(r.reason))
   throw new Error('reference_material_claim_review_required')
  if(r.role==='exclude'){excluded.push({evidenceId:e.id,claimId:card.id,reason:r.reason});continue}
  const scope=scopes.find(s=>s.evidenceId===e.id),claim=scope.admittedClaims.find(c=>c.id===card.id
   ||c.text===card.statement&&fingerprint(c.passageIds)===fingerprint(card.passageIds))
  if(!claim)throw new Error('reference_material_scope_claim_required')
  const role=r.role==='market'?'market_observation':r.role==='driver'?(e.country==='GLOBAL'?'global_context':'attributed_fx_explanation')
   :r.role==='counter'?'countercontext':card.questionId==='consumer'?'consumer_background':'watch_context'
  selections.push({evidenceId:e.id,claimId:claim.id,role,sourceSessionDate:e.eventDate,
   priceBasis:null,bodyAvailableAt:null,savedHolds:r.supported?[]:['saved_claim_support_missing'],support:'saved_bound_fx_review'})
 }
 // Official statistics are deliberately outside the market-news dossier. The
 // existing background projector validates their original period and bindings.
 for(const id of [...consumerIds,...policyIds])for(const claim of scopes.find(s=>s.evidenceId===id)?.admittedClaims??[]){
  if(selections.some(s=>s.evidenceId===id&&s.claimId===claim.id))throw new Error('duplicate_reference_material_role')
  selections.push({evidenceId:id,claimId:claim.id,role:consumerIds.has(id)?'consumer_background':'policy_background',
   sourceSessionDate:null,priceBasis:null,bodyAvailableAt:null,savedHolds:[],support:'saved_bound_background_review'})
 }
 return {selections,excluded}
}

export function reconnectReferenceMaterials({input,kind,snapshot,commentaryDate,commentaryPeriod,asOf,review}) {
 const packet=input?.packet
 if(snapshot?.ruleVersion!==SHARED_REPORT_RULE_VERSION||snapshot.referenceBasis?.version!==REPORT_REFERENCE_POLICY.version
  ||packet?.currency!==snapshot.currency||!validDate(commentaryDate)||commentaryDate>asOf.slice(0,10)
  ||!timed(asOf)||snapshot.baseDate>asOf.slice(0,10)||!validDate(packet.baseDate)||packet.baseDate>asOf.slice(0,10)
  ||!Array.isArray(packet.evidence)||!packet.evidence.length||packet.evidence.length>8)throw new Error('shared_material_context_required')
 const inputBinding=fingerprint(input),scopes=projectEvidenceScopes(packet,undefined,{required:true})
 const selected=roleSelections(input,kind,scopes)
 const sourceUse=input.sourceUse??input.fxCauseInput?.sourceUse
 const labels=projectSourceAttributions(packet.evidence,sourceUse?.attributionNotes)
 if(!validDate(sourceUse?.evaluatedOn)||sourceUse.evaluatedOn>asOf.slice(0,10))throw new Error('reference_material_use_cutoff_required')
 const uses=inspectSourceUses({resources:packet.evidence,reviews:sourceUse.reviews.filter(r=>packet.evidence.some(e=>e.id===r.resourceId)),
  evaluatedOn:sourceUse.evaluatedOn,renderings:{external_model:labels}})
 const sections=Object.fromEntries(REFERENCE_MATERIAL_ROLES.map(role=>[role,[]])),archive=[],held=[],seen=new Set()
 for(const selection of selected.selections){
  const {evidenceId,claimId,role}=selection,e=packet.evidence.find(e=>e.id===evidenceId),scope=scopes.find(s=>s.evidenceId===evidenceId)
  const claim=scope?.admittedClaims.find(c=>c.id===claimId),key=`${evidenceId}:${claimId}`
  if(!claim||!REFERENCE_MATERIAL_ROLES.includes(role)||seen.has(key)||!['GLOBAL',snapshot.currency].includes(e.country))
   throw new Error('reference_material_role_required')
  seen.add(key)
  const context=projectSourceContext(e),use=uses.items.find(u=>u.resourceId===e.id),holds=[...selection.savedHolds]
  // Projected material carries only the already-reviewed claim, never sourceContext
  // bodies, price facts, a dossier, reviewer identity, or spent call approvals.
  if(!context||!claim.passageIds.every(id=>context.passages.some(p=>p.id===id)))throw new Error('reference_material_passage_required')
  if(!validDate(e.publishedAt?.slice(0,10))||Date.parse(e.publishedAt)>Date.parse(asOf))holds.push('source_publication_after_or_without_cutoff')
  if(!timed(e.collectedAt)||Date.parse(e.collectedAt)>Date.parse(asOf))holds.push('source_collection_after_or_without_cutoff')
  if(selection.bodyAvailableAt&&(!timed(selection.bodyAvailableAt)||Date.parse(selection.bodyAvailableAt)>Date.parse(asOf)))holds.push('source_body_after_cutoff')
  const start=referencePeriodStart(e.period)
  if(!start)holds.push('source_reference_period_unverified')
  if(start>asOf.slice(0,10)||e.eventDate!=null&&(!validDate(e.eventDate)||e.eventDate>asOf.slice(0,10)))holds.push('source_period_after_reference_date')
  if(use.uses.local_analysis.status!=='allowed')holds.push('local_source_use_pending')
  const passages=claim.passageIds.map(id=>context.passages.find(p=>p.id===id))
  if(role==='attributed_fx_explanation'&&(claim.kind!=='source_interpretation'
   ||!passages.every(p=>validNewsAttribution(p.attribution))))holds.push('explicit_attributed_connection_required')
  const consumerPeriod=input.packet.fxWritingBackground?.reviewedNotes?.find(s=>s.evidenceId===e.id
   &&claim.passageIds.every(id=>s.noteIds.includes(id)))?.referencePeriod
  const item={evidenceId,claimId,role,text:claim.text,kind:claim.kind,country:e.country,publisher:e.publisher??e.source,
   sourceUrl:e.url,publishedAt:e.publishedAt,collectedAt:e.collectedAt,eventDate:e.eventDate??null,referencePeriod:consumerPeriod??e.period,
   ...(selection.marketPeriod?{marketPeriod:structuredClone(selection.marketPeriod)}:{}),sourcePeriod:e.period,sourceSessionDate:marketRoles.has(role)?selection.sourceSessionDate:null,
   roleReviewSessionDate:selection.sourceSessionDate,bodyAvailableAt:selection.bodyAvailableAt,
   articlePriceBasis:selection.priceBasis??{unit:scope.scope.unit,comparison:scope.scope.comparison},
   scope:scope.scope,allowedUse:scope.allowedUse,countercontext:scope.countercontext,excludedExpansions:scope.excludedExpansions,
   coverageGaps:scope.coverageGaps,crossSourceClaims:scope.crossSourceClaims,passageIds:claim.passageIds,
   attributions:passages.filter(p=>p.attribution).map(p=>({passageId:p.id,...p.attribution})),
   sourceUses:use.uses,sourceCredit:labels.find(n=>n.resourceId===e.id)??null,
   sourceUseProof:{resource:structuredClone(e),review:structuredClone(sourceUse.reviews.find(r=>r.resourceId===e.id))},
   evidenceBinding:fingerprint(e),scopeBinding:fingerprint(scope),savedSupport:selection.support,
   referenceRateCausalityEstablished:false}
  if(holds.length){held.push({...item,holds:[...new Set(holds)]});continue}
  if(marketRoles.has(role)&&!fitsCommentary(item,{commentaryDate,commentaryPeriod})){
   archive.push({...item,reason:'different_market_session_not_current_commentary'});continue
  }
  sections[role].push(item)
 }
 const holds=referenceMaterialHolds({sections,held,priceHeld:snapshot.numericStatus!=='pass'||snapshot.referenceBasis.status!=='pass'})
 const contentReview={status:'pending_independent_shared_context_review',
  savedSupport:'bound_existing_reviews_revalidated_not_new_independent_judgment',publicationApproved:false}
 const result={version:REFERENCE_MATERIAL_VERSION,ruleVersion:SHARED_REPORT_RULE_VERSION,currency:snapshot.currency,
  referenceSnapshotId:snapshot.snapshotId,referencePolicyVersion:REPORT_REFERENCE_POLICY.version,
  referenceDate:snapshot.baseDate,commentaryDate,...(commentaryPeriod?{commentaryPeriod:structuredClone(commentaryPeriod)}:{}),commentaryDateMeaning:'explicit_research_target_not_inferred_reference_rate_session',
  sourceCaseDate:packet.baseDate,sourceCaseSessionDate:packet.observedDate??null,inputBinding,asOf,
  status:holds.length?'materials_connected_with_gaps':'materials_prepared_for_content_review',sections,archive,held,excluded:selected.excluded,
  sourceUseSummary:uses.items,externalSourceAttributions:labels,holds:[...new Set(holds)],contentReview,
  referenceRateCausalityEstablished:false,localCloseRequired:false,
  writingGuide:REFERENCE_MATERIAL_WRITING_GUIDE,
  writerProjection:'current_sections_only_after_content_review_and_source_use_checks',request:null,
  paidCallAuthorized:false,publicationApproved:false,networkCalls:0,modelCalls:0,newPaidCostUsd:0}
 result.binding=fingerprint(result)
 if(inputBinding!==fingerprint(input))throw new Error('reference_material_input_mutated')
 return review===undefined?result:applyReferenceMaterialReview(result,review)
}

// A trusted local judgment is bound to this exact source/price/day projection.
// It adjusts roles, selection and timing; it cannot approve writing or publish.
export function applyReferenceMaterialReview(connection,review) {
 const {binding,...bound}=connection,before=fingerprint(connection)
 const reason=v=>meaningful(v)&&v.length<=480
 const safe=v=>!(/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|<[^>]+>|-----BEGIN .*PRIVATE KEY|ignore\s+(previous|all)|system\s*prompt|지시.*무시|[?&](?:token|apikey|api_key)=/i.test(JSON.stringify(v)))
 const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k))
 if(connection.version!==REFERENCE_MATERIAL_VERSION||fingerprint(bound)!==binding||review?.version!==REFERENCE_MATERIAL_REVIEW_VERSION
  ||review.contextBinding!==binding||!keys(review,['version','contextBinding','review','selection','roleChanges','claimContexts','sourceVersions'])
  ||!keys(review.review,['origin','status','reason','checkedOn'])||!['agent','human'].includes(review.review.origin)
  ||review.review.status!=='checked'||!reason(review.review.reason)||!validDate(review.review.checkedOn)
  ||review.review.checkedOn>connection.asOf.slice(0,10)||!safe(review)||JSON.stringify(review).length>48000
  ||!Array.isArray(review.roleChanges)||review.roleChanges.length>24||!Array.isArray(review.claimContexts)||review.claimContexts.length>96
  ||!Array.isArray(review.sourceVersions)||review.sourceVersions.length>8)throw new Error('bound_reference_material_review_required')
 const selected=selectReferenceMaterialConnection(connection,review.selection),next=selected.connection
 const all=[...Object.values(connection.sections).flat(),...connection.archive,...connection.held]
 const current=()=>Object.values(next.sections).flat()
 const find=r=>all.find(c=>c.evidenceId===r.evidenceId&&c.claimId===r.claimId)
 const unique=(rows,key)=>new Set(rows.map(key)).size===rows.length
 const claimKey=r=>`${r.evidenceId}:${r.claimId}`
 if(!unique(review.roleChanges,claimKey)||!unique(review.claimContexts,claimKey)
  ||!unique(review.sourceVersions,r=>r.evidenceId))throw new Error('duplicate_reference_material_review')
 for(const r of review.roleChanges){
  const item=current().find(c=>c.evidenceId===r.evidenceId&&c.claimId===r.claimId)
  // Conservative reclassification only. No background/global -> local cause,
  // market observation removal, or archived-session promotion through a role.
  if(!keys(r,['evidenceId','claimId','fromRole','toRole','reason'])||!item||item.role!==r.fromRole||r.fromRole===r.toRole
   ||!['countercontext','watch_context','policy_background'].includes(r.fromRole)
   ||!['countercontext','watch_context','policy_background'].includes(r.toRole)||!reason(r.reason)
   ||marketRoles.has(r.toRole)&&(item.eventDate!==connection.commentaryDate||item.roleReviewSessionDate!==connection.commentaryDate))
   throw new Error('reference_material_role_change_invalid')
  next.sections[r.fromRole]=next.sections[r.fromRole].filter(c=>c!==item)
  item.role=r.toRole;item.sourceSessionDate=marketRoles.has(r.toRole)?item.roleReviewSessionDate:null
  next.sections[r.toRole].push(item)
 }
 for(const r of review.claimContexts){
  if(!keys(r,['evidenceId','claimId','periodMeaning','observationWindow','constraint'])||!find(r)
   ||!['session','recent_period','prior_event_and_session','scheduled_event','indicator_period'].includes(r.periodMeaning)
   ||!['intraday','liquid_session_end','session_end','recent_period','not_applicable'].includes(r.observationWindow)
   ||!reason(r.constraint))throw new Error('reference_material_context_invalid')
  for(const item of [...current(),...next.archive,...next.held].filter(c=>claimKey(c)===claimKey(r)))
   item.writingContext={periodMeaning:r.periodMeaning,observationWindow:r.observationWindow,constraint:r.constraint}
 }
 for(const r of review.sourceVersions){
  const source=all.find(c=>c.evidenceId===r.evidenceId)
  if(!keys(r,['evidenceId','evidenceBinding','publishedAt','collectedAt','modifiedAt','support'])||!source
   ||r.evidenceBinding!==source.evidenceBinding||r.publishedAt!==source.publishedAt||r.collectedAt!==source.collectedAt
   ||!timed(r.collectedAt)||Date.parse(r.collectedAt)>Date.parse(connection.asOf)
   ||r.modifiedAt!==null&&(!timed(r.modifiedAt)||Date.parse(r.modifiedAt)>Date.parse(r.collectedAt)||Date.parse(r.modifiedAt)<Date.parse(r.publishedAt))
   ||!['verified_saved_original','saved_statistic_review','not_reverified'].includes(r.support))throw new Error('reference_material_version_invalid')
  for(const item of [...current(),...next.archive,...next.held].filter(c=>c.evidenceId===r.evidenceId)){
   item.sourceVersion={publishedAt:r.publishedAt,modifiedAt:r.modifiedAt,bodyAvailableBy:r.collectedAt,
    availabilityBasis:'known_by_collection_not_first_publication',support:r.support}
   if(r.support==='not_reverified'&&current().includes(item)){
    next.sections[item.role]=next.sections[item.role].filter(c=>c!==item)
    next.held.push({...item,holds:['support_not_reverified_from_saved_original']})
   }
  }
 }
 next.holds=referenceMaterialHolds({sections:next.sections,held:next.held,
  priceHeld:connection.holds.includes('shared_reference_price_held'),priorHolds:next.holds})
 next.status=next.holds.length?'materials_connected_with_gaps':'materials_prepared_for_content_review'
 next.preparationReview={version:review.version,reviewBinding:fingerprint(review),originalConnectionBinding:binding,
  selection:selected.record,roleChanges:structuredClone(review.roleChanges),
  status:'adjustments_applied_writer_review_still_required',publicationApproved:false}
 delete next.binding;next.binding=fingerprint(next)
 if(before!==fingerprint(connection))throw new Error('reference_material_input_mutated')
 return next
}
