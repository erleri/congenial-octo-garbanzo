// Offline admission of INEGI numeric observations to the existing economic writer.
// Explicit reviewer judgments remain separate from integrity, novelty and publication.
import {fingerprint} from './research-harness.js'
import {validDate} from './core.js'
import {reviewSelectedStatisticMaterial} from './selected-material-review.js'
import {bindEvidenceScope,projectEvidenceScopes} from './evidence-scope.js'
import {inspectSourceUses} from './source-use.js'
import {researchSourceTimeIssue,planResearchNeeds} from './research-needs.js'
import {INEGI_REPORT_INDICATORS,inegiScopeMatches} from './inegi-report-indicators.js'

export const INEGI_CONTEXT_VERSION='inegi-consumer-context/1'
export const INEGI_TERMS_URL='https://www.inegi.org.mx/inegi/terminos.html'
export const INEGI_USE_CONDITIONS=['attribution_metadata','analysis_disclosure','no_official_endorsement']
const stamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))&&validDate(v.slice(0,10))
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)
const reason=v=>typeof v==='string'&&v.trim().length>=10&&v.length<=480
const identity=packet=>fingerprint({currency:packet.currency,baseDate:packet.baseDate,facts:packet.facts,evidence:packet.evidence,scopeCards:packet.evidenceScopeCards})
export const inegiReleaseBinding=(original,card)=>fingerprint({original,cardBinding:card.binding})

export function inegiConsumerInstructions({codeOwnedFacts=false}={}) { return [
  'consumerContext는 멕시코 소비 환경의 검토된 통계 입력이다. 환율 변화의 원인이나 당일 시장 반응으로 사용하지 않는다.',
  'readerContent.angles의 질문에 허용된 결론과 factIds로 답한다. 소매의 실질 매출 지수·연간 변화율과 물가의 월간·연간 변화율을 구분한다.',
  'timing의 대상 월·발표일·수집시각을 유지한다. 최근 확보한 과거 월 통계를 오늘 발표된 통계나 현재 월 실적으로 바꾸지 않는다.',
  '다른 달의 소매와 물가를 빼서 실질 판매를 계산하지 않는다. EMEC 소매는 이미 실질 지표다. 가전·TV·회사 셀아웃·판매수량이나 정책금리 결정으로 확대하지 않는다.',
  codeOwnedFacts
    ? '집필은 정성적 설명과 evidenceIds만 제출한다. 숫자·날짜·자리표시자는 본문에 쓰지 않는다. 연결한 근거의 수치·대상 월·비교 기준은 코드가 별도 표시한다. 서로 다른 기간을 같은 시점으로 종합하지 않는다. 제목은 확인한 결론을 전달하며 여러 통계를 연결한 문장에는 필요한 evidenceIds 전체를 연결한다.'
    : '본문 수치는 코드의 {{fact_id}}만 사용한다. 제목은 확인된 결론을 전달하며 자료 부족 안내나 편집 방법을 반복하지 않는다. 여러 통계를 연결한 문장에는 필요한 evidenceIds 전체를 연결한다.',
  '같은 EMEC·INPC 발표의 여러 계열과 그로부터 계산한 값은 독립된 여러 출처의 검증으로 세지 않는다. sourceGroups는 같은 통계 발표에 속하는 자료를 묶는다.',
  'sourceAttribution과 transformationDisclosure는 코드가 표시할 출처·가공 고지다. INEGI가 LATAM FX 분석이나 AI 해석을 작성·보증한 것으로 표현하지 않는다. reviewOnly를 문단마다 복사하지 않는다.',
].join('\n') }
export const INEGI_CONSUMER_INSTRUCTIONS=inegiConsumerInstructions()

// Explicit question-led selection from already reviewed facts. Original
// captures/receipts stay intact; omission is not a claim that a series is absent.
export function selectInegiWritingFacts(options,factIds) {
 const sources=prepareInegiWritingSources(options)
 if(!Array.isArray(factIds)||!factIds.length||new Set(factIds).size!==factIds.length
  ||sources.statistics.length!==options.statisticReviews.length||factIds.some(id=>!sources.statistics.some(s=>s.factId===id)))
  throw new Error('reviewed_inegi_fact_selection_required')
 const selected=sources.statistics.filter(s=>factIds.includes(s.factId)),evidenceIds=new Set(selected.map(s=>s.evidenceId))
 const reviews=options.statisticReviews.filter((_,i)=>factIds.includes(sources.statistics[i].factId)),cardIds=new Set(reviews.map(r=>r.cardId))
 return structuredClone({...options,statisticReviews:reviews,
  releaseReviews:options.releaseReviews.filter(r=>cardIds.has(r.cardId)),
  sourceUse:{...options.sourceUse,reviews:options.sourceUse.reviews.filter(r=>evidenceIds.has(r.resourceId))}})
}

export function prepareInegiWritingSources({collection,statisticReviews,releaseReviews}) {
  if(!Array.isArray(statisticReviews)||!statisticReviews.length||statisticReviews.length>4
    ||new Set(statisticReviews.map(r=>r.cardId)).size!==statisticReviews.length||!Array.isArray(releaseReviews)
    ||releaseReviews.length!==statisticReviews.length||new Set(releaseReviews.map(r=>r.cardId)).size!==releaseReviews.length)
    throw new Error('inegi_explicit_reviews_required')
  const evidence=[],evidenceScopeCards=[],facts=[],statistics=[]
  for(const selected of statisticReviews) {
    const card=collection.reviewQueue?.find(c=>c.id===selected.cardId),original=collection.originals?.find(o=>o.id===card?.originalId)
    if(!card||card.sourceId!=='mxn-consumer'||!original||collection.currency!=='MXN')throw new Error('inegi_original_required')
    const bundle=reviewSelectedStatisticMaterial({collection,card,receipt:selected.receipt})
    if(selected.receipt.observationIndexes.length!==1)throw new Error('inegi_one_period_observation_required')
    const row=original.observations[selected.receipt.observationIndexes[0]],scope=original.scope
    const definition=INEGI_REPORT_INDICATORS.find(d=>d.indicatorId===original.seriesId)
    if(!definition||!inegiScopeMatches(scope,definition))throw new Error('inegi_definition_required')
    const release=releaseReviews.find(r=>r.cardId===card.id),kind=scope.metric==='retail'?'emec':'inpc'
    const pattern=kind==='emec'?/^https:\/\/www\.inegi\.org\.mx\/contenidos\/saladeprensa\/boletines\/\d{4}\/emec\/emec\d{4}_\d{2}\.pdf$/
      :/^https:\/\/www\.inegi\.org\.mx\/contenidos\/saladeprensa\/boletines\/\d{4}\/inpc\/inpc_2q\d{4}_\d{2}\.pdf$/
    if(!release||release.binding!==inegiReleaseBinding(original,card)||release.period!==row.period
      ||!validDate(release.publishedOn)||!validDate(release.checkedOn)||release.publishedOn<`${row.period}-01`
      ||release.checkedOn<original.collectedAt.slice(0,10)||release.checkedOn<release.publishedOn
      ||!pattern.test(release.url)||!sha(release.documentSha256)||!['agent','human'].includes(release.review?.origin)
      ||release.review.status!=='checked'||!reason(release.review.reason)||release.publicationPrecision!=='day')
      throw new Error('inegi_release_review_required')
    const fileMonth=/([0-9]{4})_([0-9]{2})\.pdf$/.exec(release.url)
    if(!fileMonth||`${fileMonth[1]}-${fileMonth[2]}`!==release.publishedOn.slice(0,7))throw new Error('inegi_release_month_conflict')
    const product=kind==='emec'?'Encuesta Mensual sobre Empresas Comerciales (EMEC), serie 2018':'Índice Nacional de Precios al Consumidor (INPC), base segunda quincena de julio de 2018'
    const derived=original.metadata.derived===true
    const sourceAttribution=`Fuente: INEGI, ${product}.`
    const e={...structuredClone(bundle.evidence[0]),publisher:'INEGI',title:definition.label,publishedAt:release.publishedOn,
      publicationTime:null,eventDate:null,
      provenance:{...bundle.evidence[0].provenance,seriesId:original.seriesId,reportRole:'consumer_background',
        definitionId:original.definitionId,definitionVersion:original.definitionVersion,scope:{...scope},
        sourceAttribution,attribution:sourceAttribution,license:'INEGI Términos de Libre Uso de la Información',licenseUrl:INEGI_TERMS_URL,
        transformation:derived?'LATAM FX calculated year-over-year growth from the same EMEC index and prior-year month.':'LATAM FX normalized and rounded an INEGI numeric observation; no article text.',
        transformationDisclosure:derived?'전년 동월 대비 변화율은 INEGI 지수로 LATAM FX가 계산했습니다. 분석·해석은 INEGI의 공식 견해가 아닙니다.':'자료 정리·표현·분석은 LATAM FX가 제공하며 INEGI의 공식 견해가 아닙니다.',
        release:{publishedOn:release.publishedOn,precision:'day',url:release.url,documentSha256:release.documentSha256},
        currentSnapshotAt:original.collectedAt,providerUpdateDisplay:original.metadata.lastUpdateDisplay,
        archivedAsOfRelease:false}}
    const draft=bundle.evidenceScopeCards[0]
    evidence.push(e);evidenceScopeCards.push(bindEvidenceScope(e,draft,selected.receipt.review))
    const id=kind==='emec'?derived?'mxn_retail_yoy':'mxn_retail_index':scope.comparison==='month_over_month'?'mxn_cpi_mom':'mxn_cpi_yoy'
    const valueText=row.value.toFixed(kind==='emec'&&derived?1:2)
    const label=`${row.period} 멕시코 ${kind==='emec'?`전국 실질 소매 매출 ${derived?`전년 동월 대비 ${valueText}%`:`지수 ${valueText}(2018=100)`} · 비계절조정`:
      `전체 소비자물가 ${scope.comparison==='month_over_month'?'전월 대비':'전년 동월 대비'} ${valueText}% · 비계절조정`}`
    facts.push({id,value:row.value,label})
    statistics.push({evidenceId:e.id,factId:id,seriesId:original.seriesId,period:row.period,scope:{...scope},value:row.value,
      sourceAttribution,transformationDisclosure:e.provenance.transformationDisclosure,publishedOn:e.publishedAt,collectedAt:e.collectedAt,
      providerUpdateDisplay:original.metadata.lastUpdateDisplay,sourcePage:e.url,releaseUrl:release.url})
  }
  if(new Set(facts.map(f=>f.id)).size!==facts.length)throw new Error('inegi_duplicate_fact')
  projectEvidenceScopes({evidence,evidenceScopeCards},undefined,{required:true})
  return {version:INEGI_CONTEXT_VERSION,evidence,evidenceScopeCards,facts,statistics,publicationApproved:false}
}

export function prepareInegiConsumerContext(packet,{collection,statisticReviews,releaseReviews,sourceUse,asOf}) {
  if(packet?.currency!=='MXN'||packet.purpose!=='economic_update'||!Array.isArray(packet.facts)||!Array.isArray(packet.evidence)
    ||!Array.isArray(packet.evidenceScopeCards)||!validDate(packet.baseDate)||!stamp(asOf)||asOf.slice(0,10)!==packet.baseDate)
    throw new Error('inegi_consumer_packet_required')
  const sources=prepareInegiWritingSources({collection,statisticReviews,releaseReviews})
  if(releaseReviews.some(r=>r.checkedOn>asOf.slice(0,10)))throw new Error('inegi_future_release_review')
  const next=structuredClone(packet)
  for(const [field,items]of [['facts',sources.facts],['evidence',sources.evidence],['evidenceScopeCards',sources.evidenceScopeCards]])
    for(const item of items) {
      const old=next[field].find(r=>(field==='evidenceScopeCards'?r.evidenceId:r.id)===(field==='evidenceScopeCards'?item.evidenceId:item.id))
      if(old&&fingerprint(old)!==fingerprint(item))throw new Error('inegi_packet_collision')
      if(!old)next[field].push(structuredClone(item))
    }
  if(!sourceUse||sourceUse.evaluatedOn!==asOf.slice(0,10))throw new Error('inegi_use_review_date_required')
  const use=inspectSourceUses({resources:sources.evidence,reviews:sourceUse.reviews,evaluatedOn:sourceUse.evaluatedOn})
  const items=sources.statistics.map(stat=>{
    const e=sources.evidence.find(e=>e.id===stat.evidenceId),review=sourceUse.reviews.find(r=>r.resourceId===e.id)
    const termsReviewed=review?.terms.url===INEGI_TERMS_URL&&INEGI_USE_CONDITIONS.every(id=>review.conditions.some(c=>c.id===id&&c.status==='satisfied'))
    const uses=use.items.find(r=>r.resourceId===e.id).uses
    const temporalIssue=researchSourceTimeIssue(e,asOf)
    return {evidenceId:e.id,period:e.period,publishedOn:e.publishedAt,publicationPrecision:'day',collectedAt:e.collectedAt,
      temporalIssue,termsReviewed,uses,ready:!temporalIssue&&termsReviewed&&['local_analysis','external_model'].every(u=>uses[u].status==='allowed'),directCauseAllowed:false}
  })
  const holds=items.flatMap(item=>[...(item.temporalIssue?[`${item.evidenceId}:${item.temporalIssue}`]:[]),
    ...(!item.termsReviewed?[`${item.evidenceId}:inegi_conditions_pending`]:[]),
    ...['local_analysis','external_model'].filter(u=>item.uses[u].status!=='allowed').map(u=>`${item.evidenceId}:${u}:${item.uses[u].reason}`)])
  const ready=holds.length===0
  for(const metric of ['retail','consumer_prices'])if(new Set(sources.statistics.filter(s=>s.scope.metric===metric).map(s=>s.period)).size>1)
    throw new Error('inegi_same_metric_period_required')
  const requirements=Object.fromEntries(['economic_release','economic_scope'].map(id=>[id,sources.statistics.map(s=>({id:s.factId,period:s.period,scope:{...s.scope}}))]))
  const researchNeeds=planResearchNeeds({packet:next,purpose:'economic_update',asOf,requirements,sourceUse,maxQueries:0,priority:'core_first'})
  const groups=[['retail','확인한 달의 전국 실질 소매 매출 흐름은 어떠한가?'],['consumer_prices','확인한 달의 전체 소비자물가 흐름은 어떠한가?']]
  const input={version:INEGI_CONTEXT_VERSION,role:'consumer_environment_only',
    readerContent:{angles:groups.flatMap(([metric,readerQuestion])=>{
      const rows=sources.statistics.filter(s=>s.scope.metric===metric)
      if(!rows.length)return []
      const yoy=rows.find(r=>r.scope.comparison==='year_over_year'),mom=rows.find(r=>r.scope.comparison==='month_over_month')
      const direction=value=>value>0?'상승했다':value<0?'하락했다':'변하지 않았다'
      const readerTakeaway=metric==='retail'?yoy?`전국 실질 소매 매출은 전년 동월보다 ${yoy.value>0?'늘었다':yoy.value<0?'줄었다':'변하지 않았다'}.`:'전국 소매업의 실질 매출 수준을 나타내는 지수다.'
        :mom&&yoy&&Math.sign(mom.value)===Math.sign(yoy.value)?`전체 소비자물가는 전월·전년 동월 대비 모두 ${direction(mom.value)}.`
          :[mom?`전체 소비자물가는 전월 대비 ${direction(mom.value)}.`:'',yoy?`전체 소비자물가는 전년 동월 대비 ${direction(yoy.value)}.`:''].filter(Boolean).join(' ')
      return [{id:metric,readerQuestion,readerTakeaway,
        factIds:rows.map(r=>r.factId),evidenceIds:rows.map(r=>r.evidenceId)}]
    })},timing:{reportBaseDate:packet.baseDate,asOf,publications:items.map(({evidenceId,period,publishedOn,collectedAt})=>({evidenceId,referencePeriod:period,publishedOn,publicationTime:null,collectedAt})),
      novelty:'background_attachment_not_a_new_release_or_publication_decision'},
    sourceAttributions:sources.statistics.map(({evidenceId,seriesId,sourceAttribution,transformationDisclosure,scope,period,providerUpdateDisplay,sourcePage,releaseUrl})=>({
      evidenceId,seriesId,sourceAttribution,transformationDisclosure,scope,period,sourcePage,releaseUrl,
      providerReportedUpdate:{display:providerUpdateDisplay,meaning:'provider_update_label_not_release_timestamp'}})),
    sourceGroups:groups.flatMap(([metric])=>{const rows=sources.statistics.filter(s=>s.scope.metric===metric);return rows.length?[{
      product:metric==='retail'?'INEGI EMEC':'INEGI INPC',referencePeriod:rows[0].period,evidenceIds:rows.map(r=>r.evidenceId),independentVerificationCount:null}]:[]}),
    editorialConstraints:{directCauseAllowed:false,companySalesInferenceAllowed:false,crossPeriodArithmeticAllowed:false,
      reviewOnly:['서로 다른 대상 월과 발표일을 보존한다.','실질 소매 지표를 다른 달 물가로 다시 조정하지 않는다.','가전·TV·회사 셀아웃이나 환율 원인으로 확대하지 않는다.']}}
  const context={version:INEGI_CONTEXT_VERSION,collection:structuredClone(collection),statisticReviews:structuredClone(statisticReviews),
    releaseReviews:structuredClone(releaseReviews),sourceUse:structuredClone(sourceUse),asOf,packetBinding:identity(next),input,
    paidCallAuthorized:false,publicationApproved:false}
  return {version:INEGI_CONTEXT_VERSION,status:ready?'prepared_consumer_context_not_called':'hold_before_writer',holds,
    packet:next,context,items,researchNeeds,requestInputFragment:ready?input:null,
    nextStage:{consumerInputReady:ready,fxExplanationReady:false,paidTrialAuthorized:false,publicationApproved:false},
    writingEligibility:'novelty_and_generation_decision_not_assessed',publicationApproved:false,networkCalls:0,modelCalls:0,newPaidCostUsd:0}
}

export function projectInegiConsumerContext(packet,context) {
  if(context?.version!==INEGI_CONTEXT_VERSION)throw new Error('inegi_context_version')
  const rebuilt=prepareInegiConsumerContext(packet,context)
  if(rebuilt.holds.length||fingerprint(context)!==fingerprint(rebuilt.context))throw new Error('inegi_context_review_or_binding_required')
  return rebuilt.requestInputFragment
}
