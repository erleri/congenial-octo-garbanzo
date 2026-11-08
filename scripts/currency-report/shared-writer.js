// Offline compiler over the common schema, wire, writer policy, assembly and
// claim reviewer. It never fetches, reads keys, executes a paid call or publishes.
import {FX_REPORT_PRIORITY_VERSION,inspectFxPriority} from './fx-report-priority.js'
import {prepareSharedWritingBrief} from './shared-writing-brief.js'
import {fingerprint} from './research-harness.js'
import {applyWriterPolicy,assertWriterPolicy} from './writer-policy.js'
import {decodeGenerationOutput,assertGenerationWireRequest} from './generation-wire.js'
import {draftSchemaForPacket,composeDraft,outputInstructions} from './openrouter.js'
import {WRITING_CONTRACT_INSTRUCTIONS} from './writing-contract.js'
import {SHARED_INPUT_POLICY_VERSION,sharedCoverageRequirements,sharedEvidenceRelations} from './shared-input-policy.js'
import {applySharedClaimTyping} from './shared-claim-typing.js'
import {officialStatisticForModel} from './official-publication.js'
import {sealSharedEvidence,sealSharedPacket,projectSharedScopes,SHARED_WRITING_VERSION,SHARED_REFERENCE_LIMITATION} from './shared-writing-contract.js'

const unsafe=v=>/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|bearer\s+\S+|-----BEGIN .*PRIVATE KEY|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시|[?&](?:token|apikey|api_key)=/i.test(JSON.stringify(v))
function packetFromBrief(brief,handoff,purpose,previous) {
 const material=brief.material,s=handoff.reportPriceSnapshot
 if(!material||unsafe(material))throw new Error('safe_shared_writer_material_required')
 const evidence=material.sources.map(source=>{
  const notes=material.claims.filter(r=>r.evidenceId===source.evidenceId)
  const original=Object.values(handoff.materialConnection.sections).flat().find(r=>r.evidenceId===source.evidenceId)
  return sealSharedEvidence({id:source.evidenceId,country:original.country,publisher:source.publisher,url:source.url,
   publishedAt:source.publishedAt,collectedAt:source.collectedAt,eventDate:notes.find(n=>n.sourceSessionDate)?.sourceSessionDate??null,
   eventAt:null,period:source.referencePeriod,title:source.officialStatistic?source.officialStatistic.fact.label:`${source.publisher} 검토 요지`,
   summary:source.officialStatistic?source.officialStatistic.publication?.summary??`${source.credit.attribution} ${source.credit.transformation} ${source.officialStatistic.availability?.publicationDateKnown===false?'발표일은 제공되지 않았으며 수집 시점에 확인한 통계 판본입니다.':'발표일은 일 단위이며 수집한 통계 판본입니다.'} 자료: ${source.officialStatistic.releaseUrl}`:'검토된 자체 사실·귀속 요지. 원문 발췌·번역이 아님.',
   ...(source.marketPeriod?{marketPeriod:source.marketPeriod}:{}),provenance:source.officialStatistic?'official':'bound_material_projection',sourceCredit:source.credit,articlePriceBasis:source.articlePriceBasis,sourceVersion:source.sourceVersion,
   ...(source.officialStatistic?{officialStatistic:source.officialStatistic}:{}),
   sharedNotes:{version:SHARED_WRITING_VERSION,claims:notes.map((r,i)=>({...r,passageId:`p${i}`,
    attributions:r.attributions.map(a=>({...a,sourcePassageId:a.passageId,passageId:`p${i}`}))}))}})
 })
 const fmt=v=>new Intl.NumberFormat('ko-KR',{maximumFractionDigits:6}).format(v)
 const packet={currency:material.currency,baseDate:material.referenceDate,observedDate:s.current.date,observationAt:null,
  marketData:{fetchedAt:s.fetchedAt,source:s.current.source,rateType:'LOCAL_PER_USD',dateMeaning:s.dateMeaning,
   referencePolicy:material.referencePolicy,lineage:s.lineage,commentaryDate:material.commentaryDate,...(material.commentaryPeriod?{commentaryPeriod:material.commentaryPeriod}:{}),
   ...(s.carryForward?{carryForward:s.carryForward}:{} )},
  facts:[{id:'spot',label:`${fmt(s.current.value)} ${s.unit}`,value:s.current.value,date:s.current.date},
   {id:'previous',label:`${fmt(s.previous.value)} ${s.unit}`,value:s.previous.value,date:s.previous.date},
   {id:'day',label:`${s.changePct>=0?'+':''}${s.changePct.toFixed(2)}%`,value:s.changePct,date:s.baseDate}],
  series:structuredClone(s.series),evidence,limitations:[material.commentaryPeriod?'수치는 대시보드 기준환율입니다. 뉴스 해설은 별도로 표시한 기간의 시장 움직임을 다루며, 그 기간의 설명을 당일 기준환율 변화의 직접 원인으로 보지 않습니다.':SHARED_REFERENCE_LIMITATION],mechanismApplications:[],
  sharedReference:{version:SHARED_WRITING_VERSION,inputPolicyVersion:SHARED_INPUT_POLICY_VERSION,ruleVersion:material.ruleVersion,referenceSnapshotId:s.snapshotId,
   ...(handoff.materialConnection.asOf?{materialCutoff:{version:'independent-material-cutoff/1',asOf:handoff.materialConnection.asOf}}:{}),
   snapshotBinding:brief.referenceSnapshotBinding,materialBinding:brief.materialBinding,commentaryDate:material.commentaryDate,
   ...(material.commentaryPeriod?{commentaryPeriod:material.commentaryPeriod}:{}),
   ...(material.writingSelection?{writingSelection:material.writingSelection}:{}),
   referenceDateMeaning:s.dateMeaning,fxPriority:FX_REPORT_PRIORITY_VERSION,referenceRateCausalityEstablished:false,contentReview:'not_approved',publicationApproved:false,
   ...(purpose==='context_update'?{edition:{version:'shared-context-update/1',kind:'context_update',previous:previous??null,
    comparison:'new_evidence_separate_from_reference_price',priceCauseEstablished:false}}:{}),
   ...(purpose==='initial_check'?{edition:{version:'initial-reference-check/1',kind:'initial_check',previousReportId:null,
    comparison:'previous_reference_observation_only',noPublishedAnchor:true}}:{}),
   ...(purpose==='periodic_check'?{edition:{version:'shared-periodic-check/1',kind:'periodic_check',previous,
    comparison:'published_reference_and_explanation',relation:'unverified_until_separate_review'}}:{})}}
 if(purpose==='periodic_check'){
  packet.facts.push({id:'published_previous',label:`${fmt(previous.value)} ${s.unit}`,value:previous.value,date:previous.observedDate},
   {id:'published_change',label:`${((s.current.value/previous.value-1)*100).toFixed(2)}%`,value:(s.current.value/previous.value-1)*100,date:s.current.date})
 }
 for(const source of material.sources.filter(s=>s.officialStatistic))packet.facts.push(structuredClone(source.officialStatistic.fact))
 return sealSharedPacket(packet)
}
export function prepareSharedWriter({handoff,writer,claimTypingReview,purpose='market',previous}) {
 handoff=applySharedClaimTyping(handoff,claimTypingReview)
 const brief=prepareSharedWritingBrief({handoff,writer,purpose})
 if(!brief.material)return {version:SHARED_WRITING_VERSION,status:'material_hold',holds:brief.holds,request:null,modelCalls:0,
  paidCallAuthorized:false,publicationApproved:false}
 const packet=packetFromBrief(brief,handoff,purpose,previous),scopeCards=projectSharedScopes(packet)
 const system=[
  'LATAM FX 한국어 편집자다. 수치·차트는 대시보드 기준환율, 뉴스는 별도 현지 거래일 해설이다. 뉴스의 움직임을 이 기준환율 변화의 확정 원인으로 바꾸지 않는다.',
  'marketData.carryForward가 있으면 값은 기존 대시보드에서 이어받은 값이다. 새 거래·무변동·휴장 확정으로 설명하지 않는다. 뉴스 발표일은 환율 기준일을 바꾸지 않는다.',
  ...(purpose==='context_update'?['새 자료에 따른 환율 설명 업데이트 후보다. 현지 시장과 연결된 해설이 필요하며 일반 정책·소비 소개만으로 대체하지 않는다. 새 자료의 사건·발표시점과 설명 범위를 유지하고, 그 자료가 이전 기준환율보다 나중이면 과거 가격의 원인으로 소급하지 않는다. 유용한 새 설명이 있는지 별도 검토하며 drivers는 해당 시장 반응의 귀속 근거가 있을 때만 사용한다.']:[]),
  ...(purpose==='initial_check'?['첫 정기 점검이다. 이전 발행본이나 누적 비교 기준은 없다. 현재 확인된 환율 움직임과 현지 시장 해설에서 결론을 정리한다. 이전 설명 재확인·무변화·이 퍼센트 미만이라고 추정하지 않는다. drivers에는 확인된 현지 환율 해설을 최소 한 항목 담는다. 근거 부족은 집필 보류이며 소비·정책 배경으로 채우지 않는다.']:[]),
  ...(purpose==='periodic_check'?['전회 발행본 이후 정기 점검이다. edition.previous는 실제 발행 당시 비교 대상이며 현재 근거가 아니다. 현재 카드는 별도 근거다. 전회 설명을 다시 확인했는지, 설명이 보완됐는지, 일부를 확인하지 못했는지 현재 카드가 지지하는 범위에서만 설명한다. 관계를 판정할 근거가 없으면 현재 확인한 환율 해설만 쓴다. 환율 해설도 부족하면 집필을 보류한다. 새 뉴스가 없다는 이유로 시장 무변화·이전 원인의 지속·소멸을 단정하지 않는다. drivers에는 현재 근거로 확인한 환율 설명을 최소 한 항목 담는다. 새로운 원인은 억지로 요구하지 않는다. 직접 관련된 선택 배경만 implications에 짧게 쓴다. 전회 숫자와 누적 변화는 코드가 표시한다. 제목은 실제 점검 결론을 전달하고 공통 경고를 반복하지 않는다.']:[]),
  'drivers는 명시된 거래일 또는 commentaryPeriod 구간의 현지 환율 귀속 해석이다. 구간 해설을 당일 원인으로 표현하지 않는다. implications는 검토된 소비·정책 배경이다. 중요 정보와 전달 경로를 설명하고, 개수를 채우거나 범용 면책 문장을 반복하지 않는다.',
  '수치·기간·시각·출처 표시는 코드가 담당한다. 기사 속 귀속과 의미를 바꾸는 조건은 설명에 남긴다. 원문을 받았다고 하거나 입력에 없는 자료를 조회·복원하지 않는다.',
  'officialStatistic은 등록된 지표의 정의·수치·발표 기간을 코드가 검사한 소비 배경이다. 검사는 새로운 경제 해석의 승인이 아니다. 서로 다른 대상 월을 합쳐 실질 소비를 계산하거나 실질 소매를 물가로 다시 조정하지 않는다. 수집한 공식 통계 판본이며 발표 당시 수치를 복원한 자료가 아니다. observationStatus의 미해석 원코드로 잠정/확정 여부를 추정하지 않는다.',
  'availability.basis=captured_series_only이면 발표일이 미제공된 통계다. 수집일을 발표일로 쓰거나 오늘 발표·새 정책 사건·당일 환율 원인으로 바꾸지 않는다. governmentRedistribution이면 정부 재공급본으로 표시하며 mirror 기간과 원 기관의 발표를 구분한다. 금리 수준은 금리 상승·하락의 근거가 아니다.',
  'officialBackgroundCoverage는 이번 공식 숫자로 답할 수 있는 질문과 공백이다. 확인되지 않은 질문은 숫자를 추정하거나 다른 지표로 대체하지 않는다. 금융 상품만 확인했으면 그 금융 여건만 설명하며 소비 전체를 평가하지 않는다. 다른 검토 기사·정책 배경은 각자의 범위에서 사용할 수 있다.',
  ...brief.material.writingGuide,WRITING_CONTRACT_INSTRUCTIONS,
  'writingCoverageRequirements는 작성 후 별도 검토할 질문이다. 새 정보·기간·관련성으로 선별하고 같은 사건·경로를 합친다. relatedSourceGroups는 관련성 신호이며 독립 확인 수나 같은 사건을 확정하지 않는다.',
  '각 위치의 ruleLedger.claims에는 사용한 materialClaimIds를 함께 제출한다. evidenceIds는 그 카드들의 출처와 정확히 일치해야 한다. 배경 카드를 drivers에 사용하지 않는다. applicableMechanisms는 비어 있으므로 새 일반 원리를 승인하지 않는다.',
  outputInstructions({backgroundHeaders:true,marketHeaders:true})].join('\n')
 const schema=draftSchemaForPacket(packet,true,true,true)
 schema.properties.drivers.minItems=1
 schema.properties.implications.maxItems=1
 schema.properties.implications.items.properties.text.maxLength=180
 const request={model:'openrouter/free',messages:[{role:'system',content:system},{role:'user',content:JSON.stringify({
  version:SHARED_WRITING_VERSION,inputPolicyVersion:SHARED_INPUT_POLICY_VERSION,currency:packet.currency,baseDate:packet.baseDate,commentaryDate:brief.material.commentaryDate,...(brief.material.commentaryPeriod?{commentaryPeriod:brief.material.commentaryPeriod}:{}),
  ...(packet.sharedReference.edition?{edition:packet.sharedReference.edition}:{}),
  referenceContext:{snapshotId:handoff.reportPriceSnapshot.snapshotId,referencePolicy:brief.material.referencePolicy,
   dateMeaning:handoff.reportPriceSnapshot.dateMeaning,materialCutoff:packet.sharedReference.materialCutoff??null,observationAt:null,referenceRateCausalityEstablished:false},
  facts:packet.facts.map(({id})=>({id,owner:'code'})),
  // The claim text is transmitted once. Scope refers to the same pN passages;
  // source metadata and restrictions are not repeated on every claim.
  scopeCards:scopeCards.map(({admittedClaims,...scope})=>({...scope,admittedClaims:admittedClaims.map(({id,kind,passageIds})=>({id,kind,passageIds}))})),
  evidence:packet.evidence.map(({sharedNotes,...source})=>({...source,...(source.officialStatistic?{
   summary:'코드가 검사한 공식 집계 수치와 정의입니다. 출처 고지는 sourceCredit에 있으며 공개 표시 고지는 코드가 별도로 조립합니다.',
   officialStatistic:officialStatisticForModel(source.officialStatistic)}:{}),claims:sharedNotes.claims.map(r=>({
   id:r.passageId,materialClaimId:r.claimId,role:r.role,kind:r.kind,text:r.text,attributions:r.attributions,
   referencePeriod:r.referencePeriod,...(r.marketPeriod?{marketPeriod:r.marketPeriod}:{}),sourceSessionDate:r.sourceSessionDate,writingContext:r.writingContext}))})),
  officialBackgroundCoverage:brief.material.officialBackgroundCoverage,
  applicableMechanisms:[],writingCoverageRequirements:sharedCoverageRequirements(packet),relatedSourceGroups:sharedEvidenceRelations(packet),
  codeOwnedSections:['change','referenceTime','dataSource','sourceTiming','limitations']})}],
  response_format:{type:'json_schema',json_schema:{name:'shared_currency_brief',strict:true,schema}}}
 const selected=applyWriterPolicy(request,writer)
 const plan={version:SHARED_WRITING_VERSION,status:selected.status,currency:packet.currency,baseDate:packet.baseDate,
  packet,packetBinding:fingerprint(packet),body:selected.body,requestHash:fingerprint(selected.body),writerProfile:selected.profile,
  outputContract:selected.outputContract,localOnlyOutputConstraints:selected.localOnlyOutputConstraints,
  inputBound:selected.inputBound,maximumUsd:selected.maximumUsd,timeoutMs:selected.timeoutMs,retries:0,
  executionAdapter:'separate_approval_and_bound_paid_runner_required',contentReview:'pending_separate_review',
  paidCallAuthorized:false,publicationApproved:false,modelCalls:0,networkCalls:0,newPaidCostUsd:0}
 return {...plan,preparationBinding:fingerprint(plan)}
}
export function assertSharedWriterPlan(plan) {
 const {preparationBinding,...bound}=plan??{}
 if(plan?.version!==SHARED_WRITING_VERSION||plan.status!=='prepared_not_called'||plan.packetBinding!==fingerprint(plan.packet)
  ||plan.requestHash!==fingerprint(plan.body)||preparationBinding!==fingerprint(bound))throw new Error('bound_shared_writer_request_required')
 assertWriterPolicy(plan.body,plan.writerProfile)
 assertGenerationWireRequest(plan.body,plan.outputContract)
 return plan
}
export function compileSharedWriterOutput({plan,draft}) {
 assertSharedWriterPlan(plan)
 const normalized=decodeGenerationOutput(draft,plan.outputContract)
 const compiled=composeDraft(plan.packet,normalized,true,true)
 const priority=inspectFxPriority(compiled.candidate,normalized.ruleLedger?.claims,plan.packet.evidence.flatMap(e=>e.sharedNotes.claims))
 // A failed output is preserved for review, never repaired or retried here.
 return {...compiled,fxPriority:priority,sourceClaimLinks:structuredClone(normalized.ruleLedger?.claims??[]),
  contentReview:'pending_separate_review',publicationApproved:false,modelCalls:0}
}
