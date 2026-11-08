// Card-only handoff into the existing dossier, source-use and FX-purpose checks.
// All support/use decisions are explicit local reviewer records, not licences
// inferred from a publisher domain or an automatic paraphrase operation.
import {createReviewedNewsEvidence} from './reviewed-news-notes.js'
import {HARNESS_VERSION,evidenceBinding} from './research-harness.js'
import {bindEvidenceScope} from './evidence-scope.js'
import {packetBinding} from './rules.js'
import {FX_CAUSE_VERSION,fxCauseBinding,assessFxCauseInput} from './fx-cause-input.js'
import {priceUseResource} from './research-materials.js'
import {SOURCE_USE_VERSION,sourceUseBinding} from './source-use.js'
import {DECISION_VERSION} from './generation-decision.js'
import {assessEvidencePacket} from './evidence-quality.js'
import {prepareInegiConsumerContext} from './inegi-writing-context.js'
import {bindFxWritingBackground,bindConsumerNotes} from './fx-writing-background.js'
import {bindFxWritingFocus} from './fx-writing-focus.js'
import {researchSourceTimeIssue} from './research-needs.js'

export const NEWS_NOTES_HANDOFF_VERSION='news-notes-handoff/3'

export function prepareNewsNotesInput(pricePacket,bundle,{consumer=null}={}) {
  if(bundle?.version!=='news-notes-case/2'||!Array.isArray(bundle.entries)||!bundle.entries.length||bundle.entries.length>8
    ||pricePacket.evidence?.length||pricePacket.observedDate!==bundle.sessionDate||pricePacket.baseDate!==bundle.reportDate
    ||!bundle.contentReview||!bundle.priceUseReview) throw new Error('invalid_news_notes_case')
  let packet=structuredClone(pricePacket)
  const cards=[],claimReviews=[]
  packet.evidence=[];packet.evidenceScopeCards=[]
  for(const entry of bundle.entries) {
    if(!Array.isArray(entry.claims)||entry.claims.length!==entry.notes?.length) throw new Error('news_notes_claims_required')
    const evidence=createReviewedNewsEvidence(entry.source,entry.notes,entry.review)
    if(evidence.eventDate!==bundle.sessionDate) {
      // Earlier consumer releases retain their real event date. They must be
      // explicitly selected as background; a mixed market/source entry cannot
      // use this exception to admit an earlier driver into today's explanation.
      const selection=bundle.consumerBackground?.find(s=>s.evidenceId===evidence.id)
      const asOf=packet.marketData?.reportPriceBasis?.asOf
      if(evidence.eventDate>bundle.sessionDate||!selection
        ||!entry.claims.length||entry.claims.some(c=>c.role!=='background'||c.questionId!=='consumer')
        ||!asOf||researchSourceTimeIssue(evidence,asOf))throw new Error('news_notes_session_mismatch')
    }
    packet.evidence.push(evidence)
    const attribution=n=>n.attribution?`${n.attribution.organization} / ${n.attribution.person}`:null
    const reason=entry.review.reason
    const backgroundOnly=entry.claims.every(c=>c.role==='background')
    packet.evidenceScopeCards.push(bindEvidenceScope(evidence,{
      passageIds:entry.notes.map(n=>n.id),scope:{subject:backgroundOnly?`${packet.currency} 정책·소비 배경`:`${packet.currency} 현지 외환시장`,metric:backgroundOnly?'출처가 발표한 정책·소비 평가':'보도된 가격 또는 귀속 견해',
        unit:backgroundOnly?'출처가 정의한 지표 단위 또는 정성 평가':`매체별 ${packet.currency}/USD 또는 정성 해석`,comparison:backgroundOnly?'발표일과 지표 대상 기간을 구분한 배경':'같은 거래일, 별개의 가격·시각 기준',rankingStatus:'not_applicable'},
      admittedClaims:entry.notes.map(n=>({id:`${evidence.id}-${n.id}`,kind:n.kind==='fact'?'source_fact':'source_interpretation',text:n.text,passageIds:[n.id]})),
      allowedUse:'독자적으로 작성한 사실·귀속 견해 요지만 사용하며 원문을 전달하지 않는다.',
      countercontext:backgroundOnly?'지표 대상 기간·산업 범위는 현재 회사 판매 또는 당일 환율 원인과 구분한다.':'매체별 호가와 공식 평균은 별개이며 견해의 기여도·중요도를 수치로 확정하지 않는다.',
      excludedExpansions:['기사 번역·대체 요약','회사별 실적 추정','목표환율·가격 업무 지시'],
      coverageGaps:[{subject:backgroundOnly?'현재 회사별 판매와 자료 밖의 세부 업종 효과':'정확한 일중 관측시각과 요인별 환율 기여도',status:'not_verified'}],
    },{origin:entry.review.origin,status:'checked',reason}))
    for(const claim of entry.claims) {
      const n=entry.notes.find(n=>n.id===claim.noteId)
      const background=claim.role==='background'
      if(!n||!['market','local','global','counter','consumer','watch'].includes(claim.questionId)
        ||!['market','driver','counter','background'].includes(claim.role)||!['supports','qualifies'].includes(claim.relation)
        ||background!==['consumer','watch'].includes(claim.questionId)
        ||!['agent','human'].includes(claim.review?.origin)||claim.review.status!=='checked') throw new Error('invalid_news_note_claim')
      const card={id:`${evidence.id}-${n.id}`,questionId:claim.questionId,evidenceId:evidence.id,evidenceHash:evidenceBinding(evidence),
        passageIds:[n.id],statement:n.text,kind:n.kind==='fact'?'fact':'attributed_interpretation',attribution:attribution(n),
        allowedUse:background?'출처가 확인한 정책·소비 배경으로만 사용한다.':'당일 보도에 귀속한 설명만 사용한다.',
        limit:background?'발표일·대상 기간을 보존하고 이번 거래시간의 환율 원인으로 승격하지 않는다.':'호가·평균을 섞거나 원인별 기여도를 만들지 않는다.',
        eventKey:claim.eventKey,independenceKey:claim.independenceKey,relation:claim.relation,timeScope:background?'earlier_context':'same_day_context',review:claim.review}
      cards.push(card)
      claimReviews.push({cardId:card.id,role:claim.role,supported:claim.supported,reason:claim.review.reason,
        sessionDate:bundle.sessionDate,priceConnection:claim.priceConnection??'same_sessions_different_price_basis'})
    }
  }
  if(new Set(cards.map(c=>c.id)).size!==cards.length||new Set(packet.evidence.map(e=>e.id)).size!==packet.evidence.length)
    throw new Error('duplicate_news_note_identity')
  const reviewedNotes=bindConsumerNotes(packet,bundle.consumerBackground??[],cards,claimReviews)
  let consumerContext=null
  if(consumer) {
    const attached=prepareInegiConsumerContext({...packet,purpose:'economic_update'},
      {...consumer,asOf:packet.marketData?.reportPriceBasis?.asOf})
    if(attached.holds.length)throw new Error('consumer_background_not_ready')
    packet={...attached.packet,purpose:'fx_explanation'};consumerContext=attached.context
  }
  if(consumerContext||reviewedNotes.length) {
    packet.purpose='fx_explanation'
    packet.fxWritingBackground=bindFxWritingBackground({consumerContext,reviewedNotes,asOf:packet.marketData?.reportPriceBasis?.asOf})
  }
  if(bundle.marketFocus)packet.fxWritingFocus=bindFxWritingFocus(packet,bundle.marketFocus,cards,claimReviews)
  // Re-assess the price-only packet after attaching reviewed notes. This is
  // writing eligibility, not source-use clearance or publication approval.
  packet.assessment=assessEvidencePacket(packet)
  const dossier={version:HARNESS_VERSION,packetHash:packetBinding(packet),cards}
  const review={...bundle.contentReview,version:FX_CAUSE_VERSION,binding:fxCauseBinding(packet,dossier),purpose:'fx_explanation',claims:claimReviews}
  // User/reviewer chooses each use status for these exact authored notes. A
  // public_display decision never follows automatically from external_model.
  const judgments=[bundle.priceUseReview,...bundle.entries.map(e=>e.useReview)]
  const newsIds=new Set(bundle.entries.map(e=>e.source.id))
  const resources=[priceUseResource(packet),...packet.evidence.filter(e=>newsIds.has(e.id))]
  const sourceUse={evaluatedOn:bundle.checkedOn,reviews:[...resources.map((resource,i)=>({
    ...structuredClone(judgments[i]),version:SOURCE_USE_VERSION,resourceId:resource.id,resourceBinding:sourceUseBinding(resource)})),
    ...(consumerContext?structuredClone(consumer.sourceUse.reviews):[])]}
  const fxCauseInput={review,sourceUse}
  const assessment=assessFxCauseInput({packet,dossier,...fxCauseInput})
  return {packet,dossier,fxCauseInput,assessment,decision:{ruleVersion:DECISION_VERSION,status:'draft_candidate',
    currency:packet.currency,price:{observedDate:packet.observedDate},events:[{id:bundle.historicalCase===false?'latest-reviewed-news-notes':'historical-news-notes-review',
      binding:assessment.binding,status:'draft_candidate',purpose:'fx_explanation'}]},
    mode:'local_preparation_only',handoffVersion:NEWS_NOTES_HANDOFF_VERSION,historicalReplay:bundle.historicalCase!==false,approval:{authorized:false,budgetUsd:null},
    publicationApproved:false,networkCalls:0,modelCalls:0,newApiCostUsd:0}
}
