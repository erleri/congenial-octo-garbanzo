// Common questions over admitted roles. These are review obligations, never
// inferred economic causes, a requirement to use every card, or approval.
import {FX_REPORT_PRIORITY_VERSION} from './fx-report-priority.js'
import {assertSharedPacket} from './shared-writing-contract.js'
export const SHARED_INPUT_POLICY_VERSION='shared-input-policy/4'
const questions={
 market_observation:'별도 시장 거래일의 관측과 대시보드 기준환율을 구분했는가? 같은 가격 종류·비교 구간끼리 설명했는가?',
 attributed_fx_explanation:'현지 요인이든 국제 요인이든 채택 근거가 통화와 연결하는 경로를 설명했는가? 과거 배경·기대·사후 해석을 실제 사건이나 측정 기여도로 바꾸지 않았는가?',
 global_context:'국제 배경은 현지 연결 근거가 있는 범위만 사용했는가? 다른 설명에 합치거나 생략했다면 이유가 타당한가?',
 countercontext:'설명의 의미를 바꾸는 반대 압력·조건을 보존했는가? 양립 가능한 설명을 억지 대립으로 만들지 않았는가?',
 consumer_background:'소비 배경은 환율 해설에 직접 도움이 될 때만 짧게 사용했는가? 관련성이 낮아 생략하는 것이 정상이며 문단을 채우도록 요구하지 않는다. 대상 기간·조사 범위·명목/실질·비교 기준을 유지하고 현재 회사 실적이나 당일 원인으로 확대하지 않았는가?',
 policy_background:'정책 배경의 발표·계획·집행·대상 기간을 구분했는가? 영업 환경과 시장 원인의 역할을 혼동하지 않았는가?',
 watch_context:'관찰 변수의 판단 목적이 앞선 설명에 연결되는가? 예정 사건을 실현된 결정으로 쓰지 않고 근거 없는 관찰은 생략했는가?',
}
export function sharedCoverageRequirements(packet) {
 assertSharedPacket(packet)
 const notes=packet.evidence.flatMap(e=>e.sharedNotes.claims)
 const requirements=Object.entries(questions).filter(([role])=>notes.some(n=>n.role===role)).map(([role,question])=>{
  const selected=notes.filter(n=>n.role===role)
  return {id:`shared_${role}`,status:'unverified',policyVersion:SHARED_INPUT_POLICY_VERSION,role,
   evidenceIds:[...new Set(selected.map(n=>n.evidenceId))],materialClaimIds:selected.map(n=>n.claimId),
   referencePeriods:[...new Set(selected.map(n=>n.referencePeriod))],
   question:question+' 모든 카드를 사용하도록 강제하지 않으며 새 정보·관련성에 따라 선별한다.'}
 })
 requirements.push({id:'shared_fx_priority',status:'unverified',policyVersion:SHARED_INPUT_POLICY_VERSION,priorityVersion:FX_REPORT_PRIORITY_VERSION,required:true,role:'fx_priority',
  evidenceIds:packet.evidence.map(e=>e.id),materialClaimIds:notes.map(n=>n.claimId),referencePeriods:[...new Set(notes.map(n=>n.referencePeriod))],
  question:'제목·요약·핵심 본문이 환율 움직임과 해당 통화의 해설을 전달하는가? 사건→시장 반응→통화 연결 또는 현재 근거로 재확인한 기존 설명을 독자가 이해하는가? 소비·정책 소개만 있거나 환율 설명이 형식적이면 hold다. 근거 없는 실제 원인을 요구하지 않으며 판단 불가는 unverified다. 선택적 영업 문단 생략은 감점하지 않는다.'})
 if(packet.sharedReference.edition?.kind==='context_update'||packet.sharedReference.commentaryDate>packet.baseDate)requirements.push({
  id:'shared_evidence_after_reference',status:'unverified',policyVersion:SHARED_INPUT_POLICY_VERSION,role:'context_update',
  evidenceIds:packet.evidence.map(e=>e.id),materialClaimIds:notes.map(n=>n.claimId),referencePeriods:[...new Set(notes.map(n=>n.referencePeriod))],
  question:'환율 기준일과 자료 발표·대상 기간을 구분한다. 이후 발표를 과거 기준환율 변화의 원인으로 소급하지 않았는가? 설명 업데이트의 중요성과 새로운 내용이 출처와 전회 설명에 근거하는가? 비교 대상은 현재 사실의 근거가 아니다. 전회 설명: '+JSON.stringify(packet.sharedReference.edition?.kind==='context_update'?packet.sharedReference.edition.previous:null)})
 if(packet.sharedReference.edition?.kind==='initial_check')requirements.push({id:'shared_initial_baseline',status:'unverified',
  policyVersion:SHARED_INPUT_POLICY_VERSION,role:'initial_check',evidenceIds:[...new Set(notes.map(n=>n.evidenceId))],
  materialClaimIds:notes.map(n=>n.claimId),referencePeriods:[...new Set(notes.map(n=>n.referencePeriod))],
  question:'첫 점검이다. 현재 근거로 유용한 결론을 전달하고, 존재하지 않는 전회 발행본·누적 변화·설명 재확인·시장 무변화를 만들지 않았는가? 환율 설명이 중심이며 소비·정책 배경으로 대체하지 않았는가?'})
 if(packet.sharedReference.edition?.kind==='periodic_check')requirements.push({id:'shared_periodic_comparison',status:'unverified',
  policyVersion:SHARED_INPUT_POLICY_VERSION,role:'periodic_check',evidenceIds:[...new Set(notes.map(n=>n.evidenceId))],
  materialClaimIds:notes.map(n=>n.claimId),referencePeriods:[...new Set(notes.map(n=>n.referencePeriod))],
  question:'전회 내용은 비교 대상이며 현재 근거가 아니다. 재확인·보완·미확인이라는 모든 비교 주장이 전회 내용과 현재 출처 양쪽에 맞는지 판단한다. 관계 근거가 부족하면 현재 설명만 허용하고 무변화·영향 지속/소멸을 추정하지 않는다. 전회 기록: '+JSON.stringify(packet.sharedReference.edition.previous)})
 if(packet.sharedReference.commentaryPeriod)requirements.push({id:'shared_market_period',status:'unverified',policyVersion:SHARED_INPUT_POLICY_VERSION,required:true,role:'period_scope',evidenceIds:packet.evidence.filter(e=>e.marketPeriod).map(e=>e.id),materialClaimIds:notes.filter(n=>n.marketPeriod).map(n=>n.claimId),referencePeriods:[...new Set(notes.filter(n=>n.marketPeriod).map(n=>n.referencePeriod))],question:'주간·월간·구간 환율 해설의 모든 주장이 해당 기간·가격 종류·귀속에 맞는가? 월말을 실제 거래일로, 누적 해설을 당일 기준환율 변동 원인으로 바꾸면 hold다. 미래 전망과 실현 결과를 구분하고 제목에도 같은 기간을 유지한다.'})
 return requirements
}
const normalize=s=>s.normalize('NFD').replace(/\p{M}/gu,'').replace(/\s+/gu,' ').trim().toLowerCase()
export function sharedEvidenceRelations(packet) {
 assertSharedPacket(packet)
 const groups=new Map(),notes=packet.evidence.flatMap(e=>e.sharedNotes.claims)
 const add=(type,key,n)=>{const id=type+':'+key;if(!groups.has(id))groups.set(id,{type,identity:key,claims:[]});groups.get(id).claims.push(n)}
 for(const n of notes){
  add('same_note_text',normalize(n.text),n)
  for(const key of new Set(n.attributions.map(a=>(a.type??'person')+'|'+normalize(a.person)+'|'+normalize(a.organization))))add('shared_attribution',key,n)
  const statistic=packet.evidence.find(e=>e.id===n.evidenceId)?.officialStatistic
  if(statistic)add('same_official_release',statistic.releaseUrl,n)
 }
 return [...groups.values()].filter(g=>g.claims.length>1).map((g,i)=>({id:`relation-${i}`,type:g.type,
  materialClaimIds:[...new Set(g.claims.map(n=>n.claimId))],evidenceIds:[...new Set(g.claims.map(n=>n.evidenceId))],
  independence:'not_established_by_publisher_count',sameEvent:'unverified',
  instruction:'관련 요지는 시점·사건·전달 경로를 대조해 통합 또는 구분한다. 같은 발언 주체나 비슷한 문구만으로 같은 사건·독립 확인·의견 대립을 확정하거나 카드를 삭제하지 않는다.'}))
}
