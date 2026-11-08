// Reviewed background is projected separately from session-specific drivers.
import {fingerprint} from './research-harness.js'
import {projectInegiConsumerContext,inegiConsumerInstructions} from './inegi-writing-context.js'
import {projectEvidenceScopes} from './evidence-scope.js'
import {projectSourceContext} from './source-context.js'

export const FX_BACKGROUND_VERSION='fx-writing-background/1'
export const FX_BACKGROUND_WRITING_VERSION='fx-background-writing/3'
export const FX_BACKGROUND_INSTRUCTIONS=[
 'fxWritingBackground.consumerContext와 reviewedNotes는 검토된 소비 환경, policyBackground는 이전 정책 배경이다. 어느 것도 이번 거래일의 환율 원인으로 사용하지 않는다.',
 '근거의 대상 기간·발표일·귀속을 혼합하지 않는다. 기간·수치·출처는 코드의 배경 근거 표시가 담당한다. 근거가 있는 주제만 영업 환경에 연결하며 회사 판매·가격·판촉 지시는 만들지 않는다.',
 '확보된 배경은 implications에서 소비 흐름·구매력·금융 여건 중 출처가 직접 지지하는 의미를 설명한다. 검토된 소매·물가·내수 평가를 당일 환율 원인이나 현재 가전 판매로 확대하지 않는다. 단순한 경고로 이 항목을 대신하지 않으며, 유용한 설명이 불가능하면 생략하고 검토 대상으로 남긴다.',
 'consumerContext가 있는 멕시코 통계에만 다음 세부 기준을 적용한다:\n'+inegiConsumerInstructions({codeOwnedFacts:true}),
].join('\n')
export function bindFxWritingBackground({consumerContext=null,policyEvidenceIds=[],reviewedNotes,asOf}) {
 const payload={version:FX_BACKGROUND_VERSION,consumerContext:structuredClone(consumerContext),policyEvidenceIds:[...policyEvidenceIds],
  ...(reviewedNotes?.length?{reviewedNotes:structuredClone(reviewedNotes)}:{}),asOf}
 return {...payload,binding:fingerprint(payload)}
}

// Selection is made by the existing reviewed consumer cards, not by keywords
// or a publisher name. A mixed driver/background article is not auto-admitted.
export function bindConsumerNotes(packet,selections,cards,claimReviews) {
 if(!Array.isArray(selections)||selections.length>2)throw new Error('consumer_notes_selection_required')
 return selections.map(s=>{
  const e=packet.evidence.find(e=>e.id===s.evidenceId),scope=packet.evidenceScopeCards.find(c=>c.evidenceId===s.evidenceId)
  const selected=cards.filter(c=>c.evidenceId===s.evidenceId)
  if(!e?.newsNotes||!scope||!selected.length||!s.noteIds?.length||new Set(s.noteIds).size!==s.noteIds.length
   ||!validReferencePeriod(s.referencePeriod,packet.baseDate)
   ||!['agent','human'].includes(s.review?.origin)||s.review.status!=='checked'||!(s.review.reason?.trim().length>=10)
   ||selected.some(c=>claimReviews.find(r=>r.cardId===c.id)?.role!=='background')
   ||s.noteIds.some(id=>!selected.some(c=>c.questionId==='consumer'&&c.passageIds.includes(id)
    &&claimReviews.some(r=>r.cardId===c.id&&r.role==='background'&&r.supported===true))))throw new Error('reviewed_consumer_notes_required')
  projectSourceContext(e)
  return {...structuredClone(s),evidenceHash:fingerprint(e),scopeHash:fingerprint(scope),
   claims:selected.map(c=>({id:c.id,questionId:c.questionId,passageIds:c.passageIds,review:claimReviews.find(r=>r.cardId===c.id)}))}
 })
}
function validReferencePeriod(period,baseDate) {
 if(!/^\d{4}-(?:0[1-9]|1[0-2]|Q[1-4])$/.test(period??''))return false
 const month=period.includes('Q')?String((Number(period.at(-1))-1)*3+1).padStart(2,'0'):period.slice(-2)
 return `${period.slice(0,4)}-${month}-01`<=baseDate
}

// Facts remain code-owned metadata beside the unchanged model prose.
export function backgroundFactIds(packet,evidenceIds) {
 const context=projectFxWritingBackground(packet)
 if(!context)return []
 const ids=[]
 for(const id of evidenceIds) {
  const s=context.sourceAttributions.find(s=>s.evidenceId===id)?.scope
  const fact=s?.metric==='retail'?(s.comparison==='level'?'mxn_retail_index':'mxn_retail_yoy')
   :s?.metric==='consumer_prices'?(s.comparison==='month_over_month'?'mxn_cpi_mom':'mxn_cpi_yoy')
   :context.policyBackground.some(p=>p.evidenceId===id)?'mxn_policy_rate':null
  if(fact&&packet.facts.some(f=>f.id===fact))ids.push(fact)
 }
 return [...new Set(ids)]
}
export function projectFxWritingBackground(packet) {
 const record=packet.fxWritingBackground
 if(record===undefined)return null
 const {binding,...payload}=record
 if(record.version!==FX_BACKGROUND_VERSION||packet.purpose!=='fx_explanation'
  ||binding!==fingerprint(payload)||record.asOf!==packet.marketData?.reportPriceBasis?.asOf
  ||!Array.isArray(record.policyEvidenceIds)||record.policyEvidenceIds.length>2||new Set(record.policyEvidenceIds).size!==record.policyEvidenceIds.length)
  throw new Error('fx_background_binding_required')
 if((record.consumerContext||record.policyEvidenceIds.length)&&packet.currency!=='MXN')throw new Error('mxn_background_required')
 const consumerContext=record.consumerContext?projectInegiConsumerContext({...packet,purpose:'economic_update'},record.consumerContext):null
 const consumerIds=consumerContext?[...new Set(consumerContext.sourceAttributions.map(s=>s.evidenceId))]:[]
 const scopes=projectEvidenceScopes(packet,undefined,{required:true})
 if(record.reviewedNotes!==undefined&&(!Array.isArray(record.reviewedNotes)||record.reviewedNotes.length>2))throw new Error('consumer_notes_binding_required')
 const reviewedNotes=(record.reviewedNotes??[]).map(s=>{
  const e=packet.evidence.find(e=>e.id===s.evidenceId),scope=packet.evidenceScopeCards.find(c=>c.evidenceId===s.evidenceId)
  if(!e?.newsNotes||e.country!==packet.currency||fingerprint(e)!==s.evidenceHash||fingerprint(scope)!==s.scopeHash
    ||!validReferencePeriod(s.referencePeriod,packet.baseDate)||!['agent','human'].includes(s.review?.origin)
    ||s.review.status!=='checked'||!(s.review.reason?.trim().length>=10)||!s.claims?.length
    ||s.claims.some(c=>c.review?.role!=='background')||!s.noteIds?.length
    ||s.noteIds.some(id=>!e.newsNotes.notes.some(n=>n.id===id)||!s.claims.some(c=>c.questionId==='consumer'
     &&c.passageIds.includes(id)&&c.review.supported===true)))throw new Error('consumer_notes_binding_required')
  const source=projectSourceContext(e)
  return {evidenceId:e.id,role:'consumer_background_only',referencePeriod:s.referencePeriod,publishedAt:e.publishedAt,publisher:e.publisher,
   passageIds:s.noteIds,passages:source.passages.filter(p=>s.noteIds.includes(p.id))}
 })
 const ids=[...consumerIds,...record.policyEvidenceIds,...reviewedNotes.map(n=>n.evidenceId)]
 if(new Set(ids).size!==ids.length||!ids.length||ids.some(id=>!packet.evidence.some(e=>e.id===id)))throw new Error('fx_background_sources_required')
 const policyBackground=record.policyEvidenceIds.map(id=>{
  const e=packet.evidence.find(e=>e.id===id),scope=scopes.find(s=>s.evidenceId===id),context=projectSourceContext(e)
  if(e.newsNotes||e.country!=='MXN'||e.publisher!=='Banco de México'||e.provenance?.reportRole!=='policy_background'
   ||e.provenance.policyVersion!=='banxico-policy-background/1'||!context||!scope||scope.scope.metric!=='policy_target_rate'
   ||scope.scope.comparison!=='decision_level_not_market_reaction')throw new Error('reviewed_policy_background_required')
  return {evidenceId:id,role:'policy_background_only',publisher:e.publisher,publishedAt:e.publishedAt,period:e.period,url:e.url,
   decisionAt:null,passages:context.passages.map(({id,text})=>({id,text})),scope,sourceAttribution:e.provenance.sourceAttribution}
 })
 for(const e of packet.evidence.filter(e=>!e.newsNotes)) {
  if(!ids.includes(e.id)||consumerIds.includes(e.id)&&e.provenance?.reportRole!=='consumer_background')throw new Error('unreviewed_fx_background_source')
 }
 return {version:FX_BACKGROUND_VERSION,role:'background_only',evidenceIds:ids,consumerContext,policyBackground,reviewedNotes,
  directCauseAllowed:false,sourceAttributions:consumerContext?.sourceAttributions??[]}
}

// Check reference roles, not prose meaning. Entailment still needs content review.
export function fxBackgroundClaimIssues(packet,draft) {
 const context=projectFxWritingBackground(packet)
 if(!context)return []
 const background=new Set(context.evidenceIds),issues=[]
 for(const [i,block]of (draft.drivers??[]).entries())if(block.evidenceIds?.some(id=>background.has(id)))issues.push(`background_used_as_fx_driver:${i}`)
 for(const [i,block]of (draft.implications??[]).entries())if(!block.evidenceIds?.length||block.evidenceIds.some(id=>!background.has(id)))issues.push(`unreviewed_business_background:${i}`)
 return issues
}
