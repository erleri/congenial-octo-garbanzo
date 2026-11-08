// Opt-in, offline bridge from reviewed monthly statistics to the existing
// economic writer input. Neither source availability nor this fragment is a
// novelty decision, a new market snapshot, paid-call permission or publication.
import { createHash } from 'node:crypto'
import { chileConsumptionScopes, planChileConsumptionNeeds } from './chile-consumption-scopes.js'
import { projectEvidenceScopes } from './evidence-scope.js'
import {INEGI_CONTEXT_VERSION,projectInegiConsumerContext} from './inegi-writing-context.js'

export const CONSUMER_CONTEXT_VERSION = 'consumer-context/2'
const LEGACY_VERSION = 'consumer-context/1'
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex')
const aliases = ['consumer_pay_yoy','consumer_retail_yoy','consumer_category_yoy']
const boundary = [
  '시간당 보수·소매 활동지표를 가구별 소득, 판매수량, TV 단독 또는 회사 셀아웃으로 확대하지 않는다.',
  '동시 관측을 인과나 향후 판매 전망으로 바꾸지 않는다. 달별 변화의 지속성은 이번 한 달로 판단하지 않는다.',
  '자료가 없는 항목은 미확인이지 실제 부재가 아니다. 가격·판촉·매입 업무를 지시하지 않는다.',
]

export const LEGACY_CONSUMER_CONTEXT_INSTRUCTIONS = [
  'consumerContext는 검토된 월별 지표의 비교 재료다. 새 발표나 집필 자격을 승인한 값이 아니다.',
  'angles는 최대 두 개의 설명 후보다. 표제·수치 나열 대신 readerQuestion에 답하되, permittedStatement가 지지하는 범위만 사용한다.',
  '서로 다른 지표를 연결하는 문장은 해당 angle의 evidenceIds 전체를 claims와 본문 블록에 함께 붙인다. 같은 PDF에서 분리한 계열을 독립 출처 둘로 세지 않는다.',
  'factIds는 기존 {{fact_id}} 규칙으로만 표시한다. inlineCondition은 해석을 바꾸는 조건이므로 사용한 설명에 남긴다. reviewOnly는 문단마다 복사할 경고 문구가 아니다.',
  '새 일정·관찰 변수·일반 원리를 만들지 않는다. 기존 editorialPlan.watchCandidates가 비어 있으면 watch는 []다.',
].join('\n')

export const CONSUMER_CONTEXT_INSTRUCTIONS = [
  'consumerContext.readerContent는 독자에게 전달할 검토된 비교 결론이다. 각 angle의 readerQuestion에 readerTakeaway와 factIds로 답한다. 증가율 비교를 지수 수준·판매수량 비교로 바꾸지 않는다.',
  'consumerContext.editorialConstraints는 작성·검토 지침이며 본문 원고가 아니다. 나란히 읽는다, 별도 관측으로 제시한다 같은 작성 방법을 독자용 설명으로 복사하지 않는다.',
  '각 설명은 확인된 비교 결과를 먼저 전달하고 의미를 바꾸는 materialCondition만 바로 붙인다. 전체 경고를 반복하지 않되 시간당 보수의 근로시간 조건은 생략하지 않는다.',
  '새로 확보한 자료와 새로 발표된 통계를 구분한다. timing의 reportBaseDate, referencePeriod, publications는 서로 다른 시점이다. 당일 발표가 아닌 자료를 새 발표·오늘 발표라고 부르지 않는다. 시각 미상은 추정하지 않는다.',
  '제목과 요약에도 전년동월비의 비교 기준과 지표 범위를 유지한다. 대상 월·발표일은 코드가 제공하며 본문 수치는 {{fact_id}}로만 표시한다.',
  '서로 다른 지표를 연결할 때 해당 angle의 evidenceIds 전체를 claims와 블록에 붙인다. 같은 PDF의 계열은 독립 출처 둘이 아니다.',
  '확인되지 않은 판매 원인·추세 지속·회사 실적·업무 지시를 추가하지 않는다. watchCandidates가 비어 있으면 watch는 []다. 영업 의미는 근거가 있는 본문 비교 안에서 설명하며 분량을 채우지 않는다.',
].join('\n')

function definitions() {
  const registry = chileConsumptionScopes()
  return [registry.pay,...registry.retailRegistry.definitions.slice(0,2)]
}

function getReviewedStatistic(packet, scopes, statistics, definition, period) {
  const cards = scopes.filter(c => c.period === period && Object.entries(definition.scope).every(([k,v]) => c.scope[k] === v))
  if (cards.length !== 1) throw new Error('consumer_series_ambiguous_or_missing')
  const card = cards[0], e = packet.evidence.find(e => e.id === card.evidenceId)
  const rows = statistics.filter(s => s?.evidenceId === e.id)
  if (rows.length !== 1) throw new Error('consumer_statistic_missing_or_duplicate')
  const s = rows[0], expected = `${period} ${definition.label}: 전년 동월 대비 ${s.value > 0 ? '+' : ''}${s.value}%. 실질·계절조정 전 지표.`
  // Numeric values must agree with the admitted source claim, not merely an
  // unbound number supplied alongside a valid evidence ID.
  if (!Number.isFinite(s.value) || s.period !== period || hash(s.scope) !== hash(definition.scope)
    || !card.admittedClaims.some(c => c.id === `${definition.id}-value` && c.kind === 'source_fact' && c.text === expected)
    || !/^pdf-[a-f0-9]{64}$/.test(s.documentId) || s.documentId !== e.provenance?.documentId
    || e.provenance?.independenceKey !== s.documentId || e.provenance?.provisional !== true)
    throw new Error('consumer_statistic_not_bound')
  return { definition, card, evidence:e, statistic:s }
}

/** Return a cloned packet plus an explicit dossier attachment. Caller must
 * still supply reviewed events/dossier to economicUpdateRequest; none are made
 * up here. Default writer requests remain unchanged when this is not attached. */
export function prepareConsumerContext(packet, { period, asOf, statistics, version = CONSUMER_CONTEXT_VERSION }) {
  if (![CONSUMER_CONTEXT_VERSION, LEGACY_VERSION].includes(version)) throw new Error('consumer_context_version')
  if (packet?.purpose !== 'economic_update' || !Array.isArray(packet.facts) || !Array.isArray(statistics) || statistics.length !== 3)
    throw new Error('consumer_input_required')
  const plan = planChileConsumptionNeeds({packet,purpose:'economic_update',period,asOf})
  const questions = plan.questions.filter(q => ['consumption','category'].includes(q.id))
  if (questions.length !== 2 || questions.some(q => q.status !== 'available')) throw new Error('consumer_sources_not_available')
  const scopes = projectEvidenceScopes(packet,packet.evidenceScopeCards,{required:true})
  const rows = definitions().map(d => getReviewedStatistic(packet,scopes,statistics,d,period))
  const facts = rows.map((r,i) => ({id:aliases[i],value:r.statistic.value,
    label:`${period} ${r.definition.label} 전년동월비 ${r.statistic.value > 0 ? '+' : ''}${r.statistic.value}% (실질·계절조정 전·잠정치)`}))
  if (new Set(packet.facts.map(f=>f.id)).size !== packet.facts.length) throw new Error('consumer_duplicate_fact_id')
  for (const f of facts) {
    const old = packet.facts.find(x => x.id === f.id)
    if (old && hash(old) !== hash(f)) throw new Error('consumer_fact_collision')
  }
  const next = structuredClone(packet)
  next.facts.push(...facts.filter(f=>!next.facts.some(old=>old.id===f.id)))
  const [pay,total,category] = rows
  const ids = values => values.map(r=>r.evidence.id)
  const claims = values => values.map(r=>({evidenceId:r.evidence.id,claimId:`${r.definition.id}-value`}))
  const relative = category.statistic.value > total.statistic.value ? '높다' : category.statistic.value < total.statistic.value ? '낮다' : '같다'
  const direction = value => value > 0 ? '플러스' : value < 0 ? '마이너스' : '제로'
  const input = {
    version,period,
    angles:[
      {id:'retail-category',readerQuestion:'전체 소매와 전자·가정용·기술제품군의 흐름은 같은가?',
        factIds:[aliases[1],aliases[2]],evidenceIds:ids([total,category]),sourceClaims:claims([total,category]),
        permittedStatement:`같은 달·실질·계절조정 전 전년동월비에서 관련 상품군의 변화율이 전체 소매보다 ${relative}.`,
        explanatoryUse:'전체 소매 지표만으로 관련 상품군의 움직임을 대신 설명하지 않고 두 실측 지표를 나란히 제시한다.',
        inlineCondition:'관련 상품군은 전자·가정용·기술제품군의 넓은 분류다.'},
      {id:'pay-retail',readerQuestion:'시간당 보수 변화와 함께 확인할 수 있는 소매 실측 정보는 무엇인가?',
        factIds:[aliases[0],aliases[1]],evidenceIds:ids([pay,total]),sourceClaims:claims([pay,total]),
        permittedStatement:`같은 달 실질 시간당 보수의 전년동월비는 ${direction(pay.statistic.value)}, 실질 소매 활동의 전년동월비는 ${direction(total.statistic.value)}다.`,
        explanatoryUse:'보수만으로 소비를 추정하는 대신, 같은 달의 소매 활동을 별도 관측으로 함께 제시한다. 지수 수준 비교나 인과 설명은 하지 않는다.',
        inlineCondition:chileConsumptionScopes().pay.qualification},
    ],
    documents:[...new Set(rows.map(r=>r.statistic.documentId))].map(documentId=>({documentId,evidenceIds:ids(rows.filter(r=>r.statistic.documentId===documentId))})),
    reviewOnly:boundary,
  }
  if (version === CONSUMER_CONTEXT_VERSION) {
    // Keep the historical v1 reconstruction intact; new requests get a distinct
    // reader/constraint contract without changing saved manuscripts or receipts.
    input.readerContent = { angles: input.angles.map(a => ({
      id:a.id, readerQuestion:a.readerQuestion, readerTakeaway:a.permittedStatement,
      factIds:a.factIds, evidenceIds:a.evidenceIds, sourceClaims:a.sourceClaims,
    })) }
    input.editorialConstraints = {
      angles:input.angles.map(a => ({id:a.id, materialCondition:a.inlineCondition})),
      reviewOnly:input.reviewOnly,
    }
    input.timing = {
      reportBaseDate:packet.baseDate, referencePeriod:period,
      publications:rows.map(r => ({evidenceId:r.evidence.id, publishedAt:r.evidence.publishedAt,
        publicationTime:r.evidence.publicationTime ?? null,
        publishedOnReportDate:r.evidence.publishedAt.slice(0,10) === packet.baseDate})),
      novelty:'context_attachment_does_not_establish_release_novelty',
    }
    delete input.angles
    delete input.reviewOnly
  }
  const context = {version,period,asOf,statistics:structuredClone(statistics),input,
    packetBinding:hash({currency:next.currency,baseDate:next.baseDate,facts:next.facts,evidence:next.evidence,scopeCards:next.evidenceScopeCards}),
    paidCallAuthorized:false,publicationApproved:false}
  return {packet:next,context,requestInputFragment:input,status:'prepared_context_not_called',
    writingEligibility:'not_assessed',contentQuality:'not_assessed',publicationApproved:false,networkCalls:0,modelCalls:0,costUsd:0}
}

// Recompute all derived statements and bindings rather than trusting caller prose.
export function projectConsumerContext(packet, context) {
  if(context?.version===INEGI_CONTEXT_VERSION)return projectInegiConsumerContext(packet,context)
  if (!context || ![CONSUMER_CONTEXT_VERSION, LEGACY_VERSION].includes(context.version)) throw new Error('consumer_context_version')
  const rebuilt = prepareConsumerContext(packet,context)
  if (hash(rebuilt.context) !== hash(context)) throw new Error('consumer_context_binding')
  return rebuilt.requestInputFragment
}
