// One editorial hierarchy for every currency and cadence. No inference of
// causality, no price replacement, and no automatic repair of saved drafts.
export const FX_REPORT_PRIORITY_VERSION='fx-report-priority/1'
export const FX_EVIDENCE_SCOPE_INSTRUCTIONS=[
 '명목환율, 실질환율 지수, 국가위험 프리미엄, 주가·주식 매입액을 구분한다. 측정치·기간·가격 종류·실제/전망을 scopeMatches와 allSubclaimsSupported로 검사하고 불일치는 scopeMatches=false와 근거 위치·이유로 남긴다.',
 'market_explanation은 해당 통화의 실제 움직임·안정에 대한 귀속 경로가 있어야 한다. 기사 가격 미기재만으로 제외하지 않는다. 향후 위험·과거 통계·실질 경쟁력만으로 현재 명목환율 원인을 만들지 않는다. 해당 자료는 배경 또는 unrelated, 명목 가격 종류는 not_applicable이다. 목록 속 조건도 보존한다.',
].join('\n')
export const FX_REPORT_PRIORITY_INSTRUCTIONS=[
 '리포트의 주제는 환율이다. 제목·요약은 환율의 움직임과 근거 있는 시장 해설 또는 환율 점검 결론을 전달한다. 소비·물가·소매 지표 제목으로 대체하지 않는다.',
 '본문의 중심은 왜 움직였나이다. 사건 → 출처가 설명한 시장 반응 경로 → 해당 통화의 연결을 설명한다. 당일 새 원인이 없어도 현재 근거로 기존 환율 설명을 재확인할 수 있지만, 이전 원고 자체를 현재 근거로 쓰지 않는다.',
 '달러 공통 흐름은 현지 통화와의 연결을 출처가 지지하는 범위에서 통합한다. 단순 동행·정책 발표·소비통계만으로 실제 원인을 확정하지 않는다.',
 '영업 환경은 선택적인 짧은 보조 설명이다. 환율 설명을 이해하는 데 직접 도움이 되는 경우만 implications 한 항목·백팔십 자 이내로 쓰고 나머지는 생략한다. 자료가 있다는 이유로 넣거나 환율 설명의 빈자리를 채우지 않는다.',
 '앞으로 확인할 변수는 앞선 환율 설명에 연결되는 근거가 있을 때만 제시한다. 공통 자료 한계는 코드의 별도 영역에 한 번 두며, 의미를 바꾸는 조건·반대 근거만 해당 설명 안에 남긴다.',
 FX_EVIDENCE_SCOPE_INSTRUCTIONS,
].join('\n')

export function fxMaterialHolds(sections) {
 const holds=[]
 if(!sections?.market_observation?.length)holds.push('fx_market_observation_required')
 if(!sections?.attributed_fx_explanation?.length)holds.push('fx_explanation_required')
 return holds
}

// Necessary structural coverage only. The independent reviewer must still
// judge relevance, entailment and whether the prose explains the currency.
export function inspectFxPriority(content,links=[],notes=[]) {
 const holds=[]
 if(!content?.drivers?.length)holds.push('fx_explanation_body_missing')
 const causal=new Set(notes.filter(n=>n.role==='attributed_fx_explanation').map(n=>n.claimId))
 const market=new Set(notes.filter(n=>['market_observation','attributed_fx_explanation'].includes(n.role)).map(n=>n.claimId))
 for(const target of ['title','summary',...(content?.drivers??[]).map((_,i)=>`drivers.${i}.text`)]){
  if(!links.some(l=>l.target===target&&l.materialClaimIds?.some(id=>(target==='title'?market:causal).has(id))))holds.push(`fx_explanation_link_missing:${target}`)
 }
 if((content?.implications?.length??0)>1||content?.implications?.some(b=>b.text.length>180))holds.push('optional_background_too_long')
 return {version:FX_REPORT_PRIORITY_VERSION,status:holds.length?'hold':'requires_content_review',holds,
  contentReview:'unverified',publicationApproved:false}
}
