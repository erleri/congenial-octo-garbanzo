// Explicit reviewed observations, never a keyword inference of FX causality.
import {fingerprint} from './research-harness.js'
import {projectSourceContext} from './source-context.js'
import {projectFxWritingBackground} from './fx-writing-background.js'
import {sharedCoverageRequirements} from './shared-input-policy.js'

export const FX_FOCUS_VERSION='fx-writing-focus/1'
const scopeHash=(packet,id)=>fingerprint(packet.evidenceScopeCards.find(s=>s.evidenceId===id))
export function bindFxWritingFocus(packet,selections,cards,claimReviews) {
 if(!Array.isArray(selections)||!selections.length||selections.length>2)throw new Error('market_focus_selection_required')
 const rows=selections.map(s=>{
  const card=cards.find(c=>c.id===s.cardId),review=claimReviews.find(r=>r.cardId===s.cardId)
  const e=packet.evidence.find(e=>e.id===card?.evidenceId)
  if(s.topic!=='global_dollar'||!['intraday','close'].includes(s.priceTiming)||!card||!e?.newsNotes
   ||!['market','global'].includes(card.questionId)||card.timeScope!=='same_day_context'
   ||e.eventDate!==packet.observedDate||review?.supported!==true||!['market','counter','driver'].includes(review.role)
   ||!['agent','human'].includes(s.review?.origin)||s.review.status!=='checked'||!(s.review.reason?.trim().length>=10))
   throw new Error('reviewed_same_session_focus_required')
  return {...structuredClone(s),evidenceId:e.id,passageIds:card.passageIds,evidenceHash:fingerprint(e),scopeHash:scopeHash(packet,e.id)}
 })
 if(new Set(rows.map(r=>r.cardId)).size!==rows.length)throw new Error('duplicate_market_focus')
 const payload={version:FX_FOCUS_VERSION,currency:packet.currency,sessionDate:packet.observedDate,rows}
 return {...payload,binding:fingerprint(payload)}
}
export function projectFxWritingFocus(packet) {
 const record=packet.fxWritingFocus
 if(!record)return null
 const {binding,...payload}=record
 if(record.version!==FX_FOCUS_VERSION||binding!==fingerprint(payload)||record.currency!==packet.currency
  ||record.sessionDate!==packet.observedDate||!record.rows?.length)throw new Error('market_focus_binding_required')
 return {version:record.version,sessionDate:record.sessionDate,observations:record.rows.map(r=>{
  const e=packet.evidence.find(e=>e.id===r.evidenceId),context=e&&projectSourceContext(e)
  if(!context||e.eventDate!==record.sessionDate||fingerprint(e)!==r.evidenceHash||scopeHash(packet,e.id)!==r.scopeHash
   ||r.passageIds.some(id=>!context.passages.some(p=>p.id===id)))throw new Error('market_focus_source_changed')
  return {cardId:r.cardId,evidenceId:e.id,passageIds:r.passageIds,topic:r.topic,priceTiming:r.priceTiming}
 }),instruction:'당일 확인된 달러 흐름과 현지통화 움직임을 먼저 설명하고 금리차·캐리 등 이전 배경을 그 뒤에 연결한다. 장중 동행은 종가의 직접 원인이나 기여도 증명이 아니다. 실제 인과 경로는 출처의 귀속 해석 범위만 사용한다. 미래 중앙은행 일정은 이미 발생한 달러 반응으로 바꾸지 않는다. 중요한 반대 압력은 관련 설명 안에 짧게 남긴다.'}
}

// A review question is deliberately unverified; a source ID or lexical hit
// cannot certify that the writer actually explained the observation.
export function fxWritingCoverageRequirements(packet) {
 if(packet.sharedReference)return sharedCoverageRequirements(packet)
 const focus=projectFxWritingFocus(packet)
 const background=projectFxWritingBackground(packet)
 return [
  ...(background?[{id:'business_background_body',status:'unverified',evidenceIds:background.evidenceIds,
   scopedNotes:background.reviewedNotes.map(n=>({evidenceId:n.evidenceId,passageIds:n.passageIds,referencePeriod:n.referencePeriod})),
   referencePeriods:[...new Set([...(background.consumerContext?.timing.publications.map(p=>p.referencePeriod)??[]),...background.reviewedNotes.map(n=>n.referencePeriod)])],
   question:'검토된 소비 배경이 영업 환경 본문에 의미 있게 연결됐는가? 생략했다면 자료 부족인지 편집상 선택인지 구분한다. 당일 환율 원인·현재 회사 판매로 확대하지 않았는가?'}]:[]),
  ...(focus?[{id:'same_session_dollar_connection',status:'unverified',evidenceIds:focus.observations.map(o=>o.evidenceId),
   passageIds:focus.observations.flatMap(o=>o.passageIds),
   question:'당일 달러 흐름과 현지통화의 관계를 설명했는가? 이전 캐리·금리차 견해만 반복하거나 장중 동행을 종가 원인으로 단정하지 않았는가?'}]:[]),
 ]
}
