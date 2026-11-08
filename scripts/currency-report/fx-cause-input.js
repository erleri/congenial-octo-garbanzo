// A purpose-specific boundary over the existing source, research and writer
// contracts. Coverage is not causality; a reviewer must judge each connection.
import {fingerprint,inspectDossier} from './research-harness.js'
import {packetBinding} from './rules.js'
import {researchTimeScope} from './research-time-scope.js'
import {inspectSourceUses} from './source-use.js'
import {priceUseResource} from './research-materials.js'
import {validateMxnPriceBasis} from './mxn-official-price.js'
import {researchSourceTimeIssue} from './research-needs.js'
import {projectFxWritingBackground} from './fx-writing-background.js'

export const FX_CAUSE_VERSION='fx-cause-input/1'
export const FX_CAUSE_INSTRUCTIONS=[
  '이번 목적은 환율 움직임의 설명이다. 소비 통계 브리프로 목적을 대체하지 않는다.',
  'priceMovement의 공급자·실제 거래일·가격 종류를 기준으로 무엇이 바뀌었는지 설명한다. FIX·종가·평균환율·결제 적용일과 기사 호가를 섞지 않는다.',
  'driverClaimIds는 이번 환율 설명에 채택된 자료다. 공통 집필 기준에 따라 왜 움직였나를 먼저 쓴다.',
  'counterClaimIds는 조사에서 확인한 조건·반대 압력이다. 같은 발언자의 중요도 평가는 해당 배경에 합친다. 분류만으로 전문가 이견이나 반대 방향의 움직임을 만들지 않는다.',
  'businessBackground는 별도 영업 환경 배경이다. 대상 월을 보존하고 환율 원인이나 현재 회사 실적으로 사용하지 않는다.',
  '설명할 근거가 없으면 빈칸을 일반 경제 원리나 면책 문장으로 채우지 않는다. 새 원고는 검토용이며 게시 승인이 아니다.',
].join('\n')

const meaningful=v=>typeof v==='string'&&v.trim().length>=10
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-8

export function fxCauseBinding(packet,dossier) {
  return fingerprint({packet:packetBinding(packet),dossier:fingerprint(dossier),price:packet.marketData?.reportPriceBasis})
}

export function verifiedFxMovement(packet) {
  const scope=researchTimeScope(packet,'market'),basis=packet.marketData?.reportPriceBasis
  const mxn=packet.currency==='MXN',reported=packet.currency==='BRL'||['COP','ARS'].includes(packet.currency)
  if(mxn)validateMxnPriceBasis(basis,packet)
  if(!['CLP','MXN','BRL','COP','ARS'].includes(packet.currency)||!basis||scope.dateBasis!==(mxn?'local_banking_session_day':reported?'publisher_stated_local_session_day':'underlying_local_transaction_day')
    ||!basis.provider||!(reported?basis.verificationHash:basis.methodology?.sha256)) throw new Error('verified_fx_price_basis_required')
  const [previous,current]=basis.observations
  const rows=packet.series?.slice(-2),fact=id=>packet.facts?.find(f=>f.id===id)?.value
  const changePct=(current.value/previous.value-1)*100
  if(!rows||rows.length!==2||!rows.every((r,i)=>r.date===basis.observations[i].localSessionDate&&close(r.value,basis.observations[i].value))
    ||previous.value<=0||current.value<=0||!close(fact('spot'),current.value)||!close(fact('day'),changePct)
    ||basis.observations.some(o=>o.provider!==basis.provider||o.seriesId!==basis.seriesId||o.priceKind!==basis.priceKind))
    throw new Error('fx_price_snapshot_mismatch')
  return {provider:basis.provider,seriesId:basis.seriesId,unit:`${packet.currency}_per_USD`,priceKind:basis.priceKind,
    reportDate:packet.baseDate,previousSessionDate:previous.localSessionDate,sessionDate:current.localSessionDate,
    previousEffectiveDate:previous.effectiveDate,effectiveDate:current.effectiveDate,
    previous:previous.value,current:current.value,changePct,
    direction:changePct>0?'local_weaker':changePct<0?'local_stronger':'unchanged',
    observationAt:packet.observationAt??null,aggregationCutoffAt:current.observationWindow?.endAt??null,
    ...(basis.sourceAdapter==='country-publisher-close/1'?{comparisonKind:'two_reported_session_closes',dailyChangeClaimAllowed:false}:{}),
    articlePricesInterchangeable:false,directCausalityEstablished:false}
}

export function assessFxCauseInput({packet,dossier,review,sourceUse}) {
  const movement=verifiedFxMovement(packet),coverage=inspectDossier(packet,dossier),binding=fxCauseBinding(packet,dossier)
  const writingBackground=projectFxWritingBackground(packet)
  const holds=[],accepted=[],background=[]
  const reviewed=review?.version===FX_CAUSE_VERSION&&review.binding===binding
    &&['agent','human'].includes(review.origin)&&review.status==='checked'&&meaningful(review.reason)
    &&review.purpose==='fx_explanation'&&Array.isArray(review.claims)
    &&review.claims.length===dossier.cards.length&&new Set(review.claims.map(c=>c.cardId)).size===dossier.cards.length
    &&review.claims.every(c=>dossier.cards.some(d=>d.id===c.cardId))
  if(!reviewed) holds.push('bound_fx_content_review_required')
  if(coverage.rejected.length) holds.push('invalid_research_cards')
  if(coverage.questions.some(q=>q.status==='conflict')) holds.push('unresolved_evidence_conflict')
  if(reviewed) for(const c of coverage.cards) {
    const r=review.claims.find(r=>r.cardId===c.id),e=packet.evidence.find(e=>e.id===c.evidenceId)
    if(!['market','driver','counter','background','exclude'].includes(r.role)||typeof r.supported!=='boolean'||!meaningful(r.reason)) {
      holds.push(`claim_review_incomplete:${c.id}`);continue
    }
    if(r.role==='exclude') continue
    if(!r.supported) {holds.push(`claim_support_missing:${c.id}`);continue}
    if(r.role==='background') {background.push(c);continue}
    if(['consumer_background','policy_background'].includes(e.provenance?.reportRole)) {
      holds.push(`background_not_fx_driver:${c.id}`);continue
    }
    const priceConnections=packet.currency==='MXN'?['same_sessions_matching_official_close','same_sessions_different_price_basis']:['same_sessions_different_price_basis']
    if(r.sessionDate!==movement.sessionDate||e.eventDate<movement.previousSessionDate||e.eventDate>movement.sessionDate
      ||!priceConnections.includes(r.priceConnection)) {
      holds.push(`claim_price_period_mismatch:${c.id}`);continue
    }
    if(r.role==='driver'&&(c.kind!=='attributed_interpretation'||!c.attribution||!['local','global'].includes(c.questionId))) {
      holds.push(`attributed_fx_connection_required:${c.id}`);continue
    }
    accepted.push({...c,role:r.role})
  }
  if(!accepted.some(c=>c.role==='market')) holds.push('market_observation_missing')
  if(!accepted.some(c=>c.role==='driver')) holds.push('why_fx_moved_missing')
  if(!reviewed||review.counterevidenceChecked!==true||!meaningful(review.counterevidenceReason)) holds.push('counterevidence_review_required')
  if(!reviewed||review.newExplanationValue!==true||!meaningful(review.newExplanationReason)) holds.push('new_explanation_value_unverified')
  const resources=[priceUseResource(packet),...packet.evidence]
  const uses=inspectSourceUses({resources,evaluatedOn:sourceUse.evaluatedOn,
    reviews:sourceUse.reviews.filter(r=>resources.some(e=>e.id===r.resourceId))})
  // The existing writer projects all evidence, including neighbouring context.
  // Do not approve only the cited subset and then transmit an unchecked source.
  const requiredIds=new Set(['official-price',...packet.evidence.map(e=>e.id)])
  for(const id of requiredIds) {
    const use=uses.items.find(u=>u.resourceId===id)
    for(const scope of ['local_analysis','external_model']) if(use?.uses[scope].status!=='allowed') holds.push(`source_use:${id}:${scope}`)
  }
  if(packet.currency==='MXN')for(const evidence of packet.evidence) {
    const temporal=researchSourceTimeIssue(evidence,packet.marketData.reportPriceBasis.asOf)
    if(temporal)holds.push(`source_time:${evidence.id}:${temporal}`)
  }
  const coreHolds=holds.filter(h=>!h.startsWith('source_use:'))
  return {version:FX_CAUSE_VERSION,purpose:'fx_explanation',inputBinding:binding,
    binding:fingerprint({input:binding,review,sourceUse}),priceMovement:movement,
    status:holds.length?'hold_before_writer':'ready_for_writer',holds:[...new Set(holds)],
    contentReadiness:coreHolds.length?'incomplete':'reviewed_session_explanation_not_proven_causality',
    driverClaimIds:accepted.filter(c=>c.role==='driver').map(c=>c.id),
    counterClaimIds:accepted.filter(c=>c.role==='counter').map(c=>c.id),
    claimIds:accepted.map(c=>c.id),businessBackground:[...background.map(c=>({id:c.id,evidenceId:c.evidenceId,role:'background_only'})),
      ...(writingBackground?.evidenceIds??[]).map(evidenceId=>({evidenceId,role:'background_only'}))],
    structure:['what_changed','why_fx_moved','business_context_if_supported','what_would_change_the_explanation'],
    instructions:FX_CAUSE_INSTRUCTIONS+(movement.dailyChangeClaimAllowed===false
      ?'\n이번 변화율은 확인한 두 보도 거래일 사이의 변화다. 당일 TRM과의 차이·인증된 일간 등락률로 바꾸지 않는다.':''),
    automaticPurposeFallback:false,publicationApproved:false,
    generationRequest:null,modelCalls:0,newApiCostUsd:0}
}
