import { createHash } from 'node:crypto'
import {officialStatisticForModel} from './official-publication.js'
import { validateContent } from './core.js'
import { inspectEditorial, EDITORIAL_VERSION } from './editorial.js'
import { RULE_VERSION, packetBinding, proseTargets, selectMechanisms } from './rules.js'
import { projectSourceContext } from './source-context.js'
import { codeOwnedTargets, ASSEMBLY_VERSION } from './owned-content.js'
import { EVIDENCE_SCOPE_VERSION, SCOPE_RULE_VERSION, SCOPE_CRITERIA, SCOPE_INSTRUCTIONS, projectEvidenceScopes, claimReferenceIssues } from './evidence-scope.js'
import { REASONING_POLICY_VERSION, REASONING_CRITERIA, REASONING_REVIEW_INSTRUCTIONS, REASONING_WRITER_INSTRUCTIONS } from './reasoning-policy.js'
import { sourcePublicationTiming } from '../../src/lib/report-source-timing.js'
import { reviewSentences, reviewSentenceSegments } from './report-text.js'
import { periodicWriterInput, PERIODIC_REVIEW_INSTRUCTIONS, PERIODIC_REVIEW_CHECKS } from './periodic-check.js'
import { PERIODIC_WRITING_VERSION } from './periodic-editing.js'
import {fxWritingCoverageRequirements} from './fx-writing-focus.js'
import {sharedEvidenceRelations,SHARED_INPUT_POLICY_VERSION} from './shared-input-policy.js'

export const CLAIM_REVIEW_VERSION = 'claim-review/8'
// Reviewer findings, not keyword detections or proof that a claim is true/false.
export const REVIEW_ISSUES = Object.freeze({
  none: '지적 없음', observation_time: '관측·수집·발표 시점 혼동',
  source_authority: '출처 공식성·귀속 확대', claim_scope: '단위·대상·조건·인과 범위 확대',
  evidence_conflict: '확인한 근거와 모순', advice: '금지된 업무·투자 지시',
  style: '의미를 유지하는 편집 개선', verification_gap: '판단 자료 미확인',
})
const requiredIssues = new Set(['observation_time', 'source_authority', 'claim_scope', 'evidence_conflict', 'advice'])
function disposition(row) {
  if (row.issue === 'verification_gap' && row.support === 'unverified' && row.decision === 'keep') return 'verification_pending'
  if (row.issue === 'none' && row.support === 'supported' && row.decision === 'keep') return 'no_issue'
  if (row.issue === 'style' && row.support === 'supported' && row.decision === 'refine') return 'optional_refinement'
  if (requiredIssues.has(row.issue) && row.decision === 'rewrite' &&
    (['limited', 'unsupported', 'conflicting'].includes(row.support) || row.issue === 'advice' && row.support === 'supported')) return 'required_correction'
  return null
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const meaningful = value => typeof value === 'string' && value.trim().length >= 10
const currentReviewInput = p => p?.version === CLAIM_REVIEW_VERSION && p.reasoningPolicyVersion === REASONING_POLICY_VERSION &&
  JSON.stringify(p.reasoningCriteria) === JSON.stringify(REASONING_CRITERIA) &&
  (p.purpose !== 'periodic_check' || p.periodicCheck?.writingVersion === PERIODIC_WRITING_VERSION)
const safe = value => !/sk-or-|[\w.+-]+@[\w.-]+\.[a-z]{2}|-----BEGIN .*PRIVATE KEY|bearer\s+\S+|<[^>]+>|ignore\s+(previous|all)|system\s*prompt|지시.*무시/i.test(JSON.stringify(value))

// Sentence identities bind review to exact prose, including title and summary.
export function reviewClaims(content) {
  return Object.entries(proseTargets(content)).flatMap(([target, text]) =>
    reviewSentences(text).map((quote, index) => ({
      id: `${target}:${index}`, target, quote: quote.trim(), claimHash: hash({ target, quote: quote.trim() }),
    })))
}

export function prepareClaimReview(packet, content, { scopeCards = packet.evidenceScopeCards, claimLedger, purpose = packet.periodicCheck ? 'periodic_check' : 'fx_explanation', referenceRequirements = [],sharedClaimLinks } = {}) {
  const periodic = periodicWriterInput(packet)
  if (!['fx_explanation', 'economic_update', 'periodic_check'].includes(purpose) ||
    (purpose === 'periodic_check') !== Boolean(periodic)) throw new Error('invalid_review_purpose')
  const owned = codeOwnedTargets(packet, content)
  const sources = packet.evidence.filter(e => !periodic || periodic.topics.some(t => t.sourceLinks.some(l => l.evidenceId === e.id))).map(e => ({ id: e.id, country: e.country, url: e.url,
    publisher: e.publisher, provenance: e.provenance ?? null, publishedAt: e.publishedAt, eventAt: e.eventAt ?? null,
    eventDate: e.eventDate, period: e.period, admittedScope: e.review?.scope ?? '', sourceTiming: sourcePublicationTiming(e, packet),
    ...(packet.sharedReference?{sourceVersion:structuredClone(e.sourceVersion??null),articlePriceBasis:structuredClone(e.articlePriceBasis),
      sourceCredit:structuredClone(e.sourceCredit),collectedAt:e.collectedAt,
      ...(e.officialStatistic?{officialStatistic:officialStatisticForModel(e.officialStatistic)}:{})}:{}),
    // Summary alone is insufficient for checking entailment.
    sourceContext: projectSourceContext(e) ?? null }))
  if (periodic) for (const s of sources) {
    const ids = new Set(periodic.topics.flatMap(t => t.sourceLinks.filter(l => l.evidenceId === s.id).flatMap(l => l.passageIds)))
    if (s.sourceContext) s.sourceContext = { ...s.sourceContext, passages: s.sourceContext.passages.filter(p => ids.has(p.id)) }
  }
  const input = { version: CLAIM_REVIEW_VERSION, ruleVersion: RULE_VERSION, editorialVersion: EDITORIAL_VERSION,
    reasoningPolicyVersion: REASONING_POLICY_VERSION, reasoningCriteria: REASONING_CRITERIA,
    purpose, ...(periodic ? { periodicCheck: periodic } : {}), scopeRuleVersion: SCOPE_RULE_VERSION, evidenceScopeVersion: EVIDENCE_SCOPE_VERSION,
    ...(packet.sharedReference?{sharedReference:packet.sharedReference,sharedClaimLinks:structuredClone(sharedClaimLinks??[]),
      relatedSourceGroups:sharedEvidenceRelations(packet)}:{}),
    scopeCriteria: SCOPE_CRITERIA, scopeCards: periodic ? [] : projectEvidenceScopes(packet, scopeCards),
    currency: packet.currency, baseDate: packet.baseDate, observationAt: packet.observationAt ?? null,
    assemblyVersion: ASSEMBLY_VERSION,
    marketData: packet.marketData ? { fetchedAt: packet.marketData.fetchedAt, source: packet.marketData.source, rateType: packet.marketData.rateType } : null,
    facts: packet.facts, sources, applicableMechanisms: selectMechanisms(packet).selected,
    ...(fxWritingCoverageRequirements(packet).length?{writingCoverageRequirements:fxWritingCoverageRequirements(packet)}:{}),
    claims: reviewClaims(content).map(c => {
      const [section, index] = c.target.split('.')
      const block = content[section]?.[Number(index)]
      const normalize = s => typeof s === 'string' ? s.replace(/\s+/gu, '') : ''
      const mapped = Array.isArray(claimLedger) ? claimLedger.filter(r => r?.target === c.target && normalize(r.quote) === normalize(c.quote)) : undefined
      const evidenceIds = mapped?.length === 1 && Array.isArray(mapped[0].evidenceIds) ? mapped[0].evidenceIds : block?.evidenceIds ?? packet.evidence.map(e => e.id)
      return { ...c, owner: owned.includes(c.target) ? 'code' : 'ai', kind: block?.kind ?? 'header', factIds: block?.factIds ?? [], evidenceIds,
        referenceStatus: 'candidate_only', support: 'unverified' }
    }) }
  if (!safe(input)) throw new Error('unsafe_claim_review_input')
  const referenceIssues = claimReferenceIssues(packet, content, input.claims, claimLedger, referenceRequirements)
  return { ...input, referenceRequirements, referenceIssues, binding: hash({ input, referenceIssues, referenceRequirements, packetHash: packetBinding(packet), content }),
    automatic: validateContent(content, packet), editorial: inspectEditorial(content, { periodic: Boolean(periodic) }),
    status: 'unverified', publicationApproved: false }
}

export const CLAIM_REVIEW_INSTRUCTIONS = [
  'writingCoverageRequirements는 문장별 정확성과 별개인 편집 완결성 질문이다. 검토된 소비 배경 본문·당일 달러 연결의 누락을 확인하고, 자료 부족과 설명 누락을 구분한다. 출처 ID가 같다는 이유만으로 필요한 관측을 설명했다고 판단하지 않는다. 누락은 즉시 허위 사실로 분류하지 않으며, 표현된 인과·기간 오류는 별도로 필수 교정한다.',
  'writingCoverageRequirements가 있으면 writingCoverage에서 항목마다 pass/refine/hold/unverified와 구체적 이유를 제출한다. 선택적 설명 누락은 refine, required=true인 핵심 환율 설명의 누락·부족은 hold, 표현된 사실·인과 오류는 hold, 판단 불가는 unverified다. pass는 근거와 해당 본문을 실제 대조한 경우만 가능하다.',
  '공통 입력의 역할별 질문은 달러·특정 국가에 한정하지 않는다. 실제 본문의 사용·통합·의도적 생략·자료 부족을 구분하고 이유를 기록한다. 사용 가능한 모든 카드를 쓰도록 강제하지 않는다. 같은 발언 주체는 관련성 신호이며 같은 사건이나 독립 확인을 입증하지 않는다.',
  SCOPE_INSTRUCTIONS,
  REASONING_REVIEW_INSTRUCTIONS,
  'scopeCriteria의 비교·대상·기간·자료 상태를 문장마다 확인하고 관련 판단을 reason과 subclaims에 남긴다. 경제 업데이트는 구성과 소비 맥락을 평가한다. 환율 원인 보고서는 실제 시장 반응과 통화 연결도 평가한다.',
  '문장별로 대조한다. 작성자의 연결표나 자기 점수가 아니라 제공된 근거 구절과 검증된 원리 적용 조건을 확인한다. 근거가 원문 발췌인지 채택된 검토 요지인지 구분한다.',
  '각 claim에 supported/limited/unsupported/conflicting/unverified와 keep/refine/rewrite, 제공 구절의 passageId·정확한 인용·이유를 기록한다. 검토 요지의 인용을 기사 원문 인용으로 표시하지 않는다.',
  '발표와 집행, 가격과 거래량, 당일 변화와 추세, 실제 관측과 기사 시각, 분석가 해석과 사실을 구분한다. 같은 기관을 인용한 보도는 독립 근거로 세지 않는다.',
  '일반 원리는 applicableMechanisms 조건이 충족될 때만 설명한다. 환산 원리로 실제 소비자가격·판매·마진 효과를 추정하지 않는다.',
  '근거 오류·업무 지시는 rewrite, 문체만 개선하면 되는 경우 refine이다. 원문 발췌·채택된 검토 요지·승인 원리 어느 쪽에도 판단 자료가 없으면 unverified로 남긴다. 중요한 반대 근거·조건을 보존한다.',
  '각 문장의 모든 주장을 확인한다. 예: 공식 관측 이후는 출처의 공식성과 실제 관측의 선후관계라는 두 주장을 담는다. 한 부분의 인용으로 다른 부분까지 지지된 것으로 처리하지 않는다.',
  'sourceVersion=registered_numeric_projection인 자료는 코드가 정의·대상 월·발표일·수치 무결성을 검사한 통계 요지다. 새 원문 의미 검토나 경제적 파급 효과의 승인이 아니다. officialStatistic과 facts를 대조하고 대상 월·비교 기준·명목/실질·계절조정·현재 API 판본을 유지하는지, 환율 원인·회사 판매·다른 월과의 계산으로 범위를 넓히지 않았는지 검토한다.',
  'referenceRequirements가 있는 관계 문장은 각 출처에서 제공된 구절을 모두 대조한다. 출처 연결 보완은 경제 사실 교정이나 게시 승인과 다르며, 이전 검토는 새 binding에 재사용하지 않는다.',
  'issue는 observation_time/source_authority/claim_scope/evidence_conflict/advice 중 실제 문제를 고른다. 이유에 원고의 주장, 확인한 근거의 범위, 독자의 해석에 미치는 차이를 명시한다. 여러 문제가 있으면 주된 issue를 선택하고 이유에 나머지도 기록한다.',
  '수집시각은 관측시각이 아니다. observationAt이 없으면 기사와 실제 관측의 선후관계를 만들지 않는다. 정부 계획을 보도한 언론 기사는 정부 원문과 구분하되 보도에 귀속한 설명은 허용한다.',
  '원리의 결제 통화·계산 대상·조건을 대조한다. 같은 달러 결제대금 환산을 다른 통화 전반이나 장부 평가·판매 실적으로 넓히면 claim_scope다. 문맥에서 외화가 명확히 달러를 가리키면 단어만으로 오류 판정하지 않는다.',
  '근거가 지지하는 문장의 추상적 제목·긴 표현·구체 명칭 보완은 supported/refine/issue=style이다. 더 명확하게 쓸 수 있다는 이유만으로 rewrite하지 않는다. 제목이 새 인과·순위·방향을 단정하면 근거 문제로 검사한다.',
  '제공된 근거를 대조했고 주장 일부만 지지하면 limited, 지지하지 않으면 unsupported, 명시적으로 모순되면 conflicting이다. 이들은 필수 교정이다. 판단에 필요한 자료·조건 자체가 없다면 unverified/keep/issue=verification_gap이다. 검토 요지만 받은 경우 원문을 직접 확인했다고 기록하지 않는다.',
  '지적이 없으면 supported/keep/issue=none이다. 안전한 조건부 설명은 유지하며 경고 문장을 더 넣는 것을 교정 목표로 삼지 않는다.',
  '각 문장을 subclaims로 나누어 원문 순서대로 모든 글자를 포함한 quote 조각과 지지 여부·이유·인용·원리 적용 ID를 반환한다. 공식성·시점·사건·원인·범위·조건 등 독립적으로 참거짓을 판단할 주장을 분리한다. 단순한 한 주장은 한 조각으로 둘 수 있다. 일부 지지만으로 문장 전체를 supported로 표시하지 않는다.',
  '문장 support는 세부 주장 중 미확인, 모순, 미지원, 부분 지지, 지지 순으로 가장 약한 결과를 따른다. 문체 권고는 모든 주장이 supported일 때만 refine이다. 인용은 각 세부 주장마다 필요한 원문 구절을 붙인다.',
  'owner=code인 달러 환산 문장은 고정된 템플릿이다. 사실 ID·승인된 원리 적용 조건을 대조하고 keep한다. 문제를 발견하면 verification_gap으로 기록해 구현 확인을 요청하며 AI 교정 대상으로 바꾸지 않는다.',
].join('\n')

// Transport-neutral structured contracts. The existing authorized caller owns
// provider, privacy, model, reservation and cost accounting for each stage.
const string = { type: 'string' }
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })
export function claimReviewContract(prepared) {
  if (!currentReviewInput(prepared)) throw new Error('obsolete_claim_review_input')
  const anchors = { type: 'array', maxItems: 4, items: object({ evidenceId: { ...string, enum: prepared.sources.map(s => s.id) },
    passageId: string, passageHash: string, quote: { ...string, maxLength: 480 } }) }
  const applications = { type: 'array', maxItems: prepared.applicableMechanisms.length, items: string }
  const support = { ...string, enum: ['supported', 'limited', 'unsupported', 'conflicting', 'unverified'] }
  const row = object({ id: { ...string, enum: prepared.claims.map(c => c.id) }, claimHash: string,
    support,
    decision: { ...string, enum: ['keep', 'refine', 'rewrite'] }, reason: { ...string, minLength: 10, maxLength: 480 },
    issue: { ...string, enum: Object.keys(REVIEW_ISSUES) },
    anchors, applicationIds: applications,
    subclaims: { type: 'array', minItems: 1, maxItems: 10, items: object({ quote: { ...string, minLength: 1, maxLength: 480 }, support,
      reason: { ...string, minLength: 10, maxLength: 480 }, anchors, applicationIds: applications }) },
  })
  const schema = object({ version: { ...string, enum: [CLAIM_REVIEW_VERSION] }, binding: { ...string, enum: [prepared.binding] },
    origin: { ...string, enum: ['agent'] }, reviewer: { ...string, minLength: 1, maxLength: 120 },
    claims: { type: 'array', minItems: prepared.claims.length, maxItems: prepared.claims.length, items: row },
    ...(prepared.writingCoverageRequirements?.length?{writingCoverage:object(Object.fromEntries(prepared.writingCoverageRequirements.map(r=>[r.id,
      {...object({status:{...string,enum:['pass','refine','hold','unverified']},reason:{...string,minLength:10,maxLength:480},
        ...(r.policyVersion===SHARED_INPUT_POLICY_VERSION?{treatment:{...string,enum:['used','merged','omitted','insufficient_material','unverified']},
          targets:{type:'array',maxItems:16,uniqueItems:true,items:{...string,enum:[...new Set(prepared.claims.map(c=>c.target))]}}}:{})}),description:r.question}])))}:{}),
    ...(prepared.purpose === 'periodic_check' ? { periodicChecks: object(Object.fromEntries(Object.entries(PERIODIC_REVIEW_CHECKS).map(([key, description]) =>
      [key, { ...object({ status: { ...string, enum: ['pass', 'hold', 'unverified'] }, reason: { ...string, minLength: 10, maxLength: 480 } }), description }]))) } : {}),
  })
  return { schema, messages: [{ role: 'system', content: CLAIM_REVIEW_INSTRUCTIONS + (prepared.purpose === 'periodic_check' ? '\n' + PERIODIC_REVIEW_INSTRUCTIONS : '') }, { role: 'user', content: JSON.stringify(prepared) }] }
}

// A valid citation anchor is not proof of semantic support. That remains a
// recorded reviewer judgment; agent reviews never become human/public approval.
export function assessClaimReview(prepared, review) {
  const errors = (prepared.referenceIssues ?? []).map(r => `${r.claimId ?? 'report'}:${r.code}`), rows = []
  const writingCoverage=(prepared.writingCoverageRequirements??[]).map(r=>{
    const v=review?.writingCoverage?.[r.id],shared=r.policyVersion===SHARED_INPUT_POLICY_VERSION
    const targetsValid=!shared||Array.isArray(v?.targets)&&new Set(v.targets).size===v.targets.length&&v.targets.every(t=>{
      const link=prepared.sharedClaimLinks.find(l=>l.target===t)
      return prepared.claims.some(c=>c.target===t)&&link?.materialClaimIds?.some(id=>r.materialClaimIds.includes(id))
    })
    const treatmentValid=!shared||['used','merged','omitted','insufficient_material','unverified'].includes(v?.treatment)
      &&(['used','merged'].includes(v.treatment)?v.targets?.length>0:v.targets?.length===0)
      &&!(v.treatment==='unverified'&&v.status!=='unverified')
    const requiredCoverage=r.required!==true||v?.status!=='pass'||['used','merged'].includes(v.treatment)
      &&v.targets?.includes('title')&&v.targets?.includes('summary')&&v.targets?.some(t=>/^drivers\.\d+\.text$/.test(t))
    return {id:r.id,required:r.required===true,status:targetsValid&&treatmentValid&&requiredCoverage&&['pass','refine','hold','unverified'].includes(v?.status)&&meaningful(v.reason)?v.status:'unverified',
      reason:v?.reason??'집필 완결성 검토 미완료',...(shared?{treatment:v?.treatment??'unverified',targets:v?.targets??[]}:{} )}
  })
  const periodicChecks = prepared.purpose === 'periodic_check' ? Object.keys(PERIODIC_REVIEW_CHECKS).map(id => ({ id,
    status: ['pass', 'hold', 'unverified'].includes(review?.periodicChecks?.[id]?.status) && meaningful(review.periodicChecks[id].reason) ? review.periodicChecks[id].status : 'unverified',
    reason: review?.periodicChecks?.[id]?.reason ?? '정기 점검 기준 검토 미완료' })) : []
  if (!currentReviewInput(prepared) || !review || review.version !== CLAIM_REVIEW_VERSION || review.binding !== prepared.binding ||
    !['agent', 'human'].includes(review.origin) || !(typeof review.reviewer==='string'&&review.reviewer.trim().length>0&&review.reviewer.length<=120) || !safe(review) ||
    !Array.isArray(review.claims) || review.claims.length !== prepared.claims.length)
    return { status: 'unverified', errors: ['review_binding_or_shape'], rows, publicationApproved: false }
  for (const c of prepared.claims) {
    const matches = review.claims.filter(r => r.id === c.id)
    const r = matches[0]
    if (matches.length !== 1 || r.claimHash !== c.claimHash ||
      !['supported', 'limited', 'unsupported', 'conflicting', 'unverified'].includes(r.support) ||
      !['keep', 'refine', 'rewrite'].includes(r.decision) || !meaningful(r.reason) || !Array.isArray(r.anchors) ||
      !Array.isArray(r.applicationIds)) { errors.push(`${c.id}:invalid_claim_review`); continue }
    let anchorsValid = r.anchors.length > 0
    for (const a of r.anchors) {
      if (!a || typeof a !== 'object') { errors.push(`${c.id}:invalid_original_anchor`); anchorsValid = false; continue }
      const s = prepared.sources.find(s => s.id === a.evidenceId)
      const context = s?.sourceContext
      const passage = context?.passages.find(p => p.id === a.passageId)
      if (!c.evidenceIds.includes(a.evidenceId) || !context || context.passageHash !== a.passageHash || typeof a.quote !== 'string' || a.quote.trim().length < 12 ||
        !passage?.text.includes(a.quote)) { errors.push(`${c.id}:invalid_original_anchor`); anchorsValid = false }
    }
    if (r.applicationIds.some(id => !prepared.applicableMechanisms.some(a => a.applicationId === id)))
      errors.push(`${c.id}:unknown_mechanism_application`)
    const mechanismValid = r.applicationIds.length > 0 && r.applicationIds.every(id => prepared.applicableMechanisms.some(a => a.applicationId === id))
    const requirement = prepared.referenceRequirements?.find(x => x.target === c.target && x.quote === c.quote)
    if (requirement && r.support === 'supported' && requirement.evidenceIds.some(id => !r.anchors.some(a => a.evidenceId === id)))
      errors.push(`${c.id}:relation_original_support_missing`)
    if (['supported', 'limited'].includes(r.support) && !anchorsValid && !mechanismValid) errors.push(`${c.id}:original_support_missing`)
    if (c.kind === 'mechanism' && ['supported', 'limited'].includes(r.support) && !mechanismValid) errors.push(`${c.id}:mechanism_conditions_missing`)
    if (['limited', 'unsupported', 'conflicting'].includes(r.support) && r.decision !== 'rewrite') errors.push(`${c.id}:required_correction_missing`)
    const category = disposition(r)
    if (!category) errors.push(`${c.id}:issue_disposition_mismatch`)
    if (c.owner === 'code' && r.decision !== 'keep') errors.push(`${c.id}:code_owned_correction_forbidden`)
    const parts = r.subclaims
    if (!Array.isArray(parts) || !parts.length || parts.length > 10 || parts.some(p => !p ||
      typeof p.quote !== 'string' || !p.quote.trim() || !c.quote.includes(p.quote) || !meaningful(p.reason) ||
      !['supported', 'limited', 'unsupported', 'conflicting', 'unverified'].includes(p.support) || !Array.isArray(p.anchors) || !Array.isArray(p.applicationIds))) {
      errors.push(`${c.id}:invalid_subclaims`)
    } else {
      const normalize = s => s.replace(/\s/gu, '')
      if (normalize(parts.map(p => p.quote).join('')) !== normalize(c.quote)) errors.push(`${c.id}:subclaim_coverage_missing`)
      const aggregate = ['unverified', 'conflicting', 'unsupported', 'limited', 'supported'].find(status => parts.some(p => p.support === status))
      if (r.support !== aggregate) errors.push(`${c.id}:subclaim_support_overstated`)
      for (const [i, part] of parts.entries()) {
        const validApplications = part.applicationIds.length > 0 && part.applicationIds.every(id => prepared.applicableMechanisms.some(a => a.applicationId === id))
        if (part.applicationIds.some(id => !prepared.applicableMechanisms.some(a => a.applicationId === id))) errors.push(`${c.id}:${i}:unknown_mechanism_application`)
        const validAnchors = part.anchors.length > 0 && part.anchors.every(a => {
          const s = prepared.sources.find(s => s.id === a?.evidenceId), passage = s?.sourceContext?.passages.find(p => p.id === a?.passageId)
          return c.evidenceIds.includes(a?.evidenceId) && s?.sourceContext?.passageHash === a?.passageHash && typeof a?.quote === 'string' && a.quote.trim().length >= 12 && passage?.text.includes(a.quote)
        })
        if (part.anchors.length && !validAnchors) errors.push(`${c.id}:${i}:invalid_original_anchor`)
        if (['supported', 'limited'].includes(part.support) && !validAnchors && !validApplications) errors.push(`${c.id}:${i}:subclaim_support_missing`)
        if (c.kind === 'mechanism' && ['supported', 'limited'].includes(part.support) && !validApplications) errors.push(`${c.id}:${i}:mechanism_conditions_missing`)
      }
    }
    rows.push({ ...c, support: r.support, decision: r.decision, issue: r.issue, disposition: category, reason: r.reason,
      anchors: r.anchors, applicationIds: r.applicationIds, subclaims: r.subclaims })
  }
  return { version: CLAIM_REVIEW_VERSION, binding: prepared.binding, origin: review.origin,
    status: errors.length || rows.some(r => r.support === 'unverified') || periodicChecks.some(c => c.status === 'unverified') || writingCoverage.some(c=>c.status==='unverified') ? 'unverified' :
      rows.some(r => r.decision === 'rewrite') || periodicChecks.some(c => c.status === 'hold') || writingCoverage.some(c=>c.status==='hold'||c.required&&c.status!=='pass') ? 'needs_revision' : 'reviewed',
    ...(writingCoverage.length?{writingCoverage}:{}),
    ...(prepared.purpose === 'periodic_check' ? { periodicChecks } : {}),
    errors, rows,
    requiredCorrections: rows.filter(r => r.disposition === 'required_correction').map(r => r.id),
    optionalRefinements: rows.filter(r => r.disposition === 'optional_refinement').map(r => r.id),
    verificationPending: rows.filter(r => r.disposition === 'verification_pending').map(r => r.id),
    needsRefinement: rows.some(r => r.disposition === 'optional_refinement') || writingCoverage.some(c=>c.status==='refine'), publicationApproved: false }
}

export function correctionPlan(prepared, review, { includeRefinements = false } = {}) {
  const assessment = assessClaimReview(prepared, review)
  if (assessment.errors.length) throw new Error('incomplete_claim_review')
  // Known defects can be corrected while unknown claims remain unverified.
  const items = assessment.rows.filter(r => r.support !== 'unverified' && (r.decision === 'rewrite' || (includeRefinements && r.decision === 'refine')))
  return { version: CLAIM_REVIEW_VERSION, binding: prepared.binding, planHash: hash(items),
    items, input: prepared, assessment, maximumRevisions: 1, publicationApproved: false }
}

export const CORRECTION_INSTRUCTIONS = [
  REASONING_WRITER_INSTRUCTIONS,
  '수정 대상으로 지정된 quote만 고친다. target·claimHash·before·after로 반환하며 before는 원고와 정확히 일치시킨다.',
  '제공된 근거·허용 원리와 지적 사유만 사용한다. 검토 요지를 원문 인용으로 바꾸지 않는다. 새 수치·출처·업무 지시를 추가하지 않는다. 귀속·기간·중요 조건을 보존한다.',
  '중복이나 근거 없는 문장은 삭제할 수 있다. 소제목과 본문이 모두 비면 해당 블록을 제거한다. 수정하지 않은 문장은 그대로 유지한다.',
  '수정은 승인이나 합격이 아니다. 바뀐 문장에는 새로운 근거 대조가 필요하다.',
].join('\n')

export function correctionContract(plan) {
  if (!plan.items.length) throw new Error('no_corrections_required')
  const schema = object({ patches: { type: 'array', minItems: plan.items.length, maxItems: plan.items.length,
    items: object({ id: { ...string, enum: plan.items.map(i => i.id) }, target: string, claimHash: string,
      before: string, after: { ...string, maxLength: 480 }, kind: { ...string, enum: ['', 'fact', 'interpretation', 'mechanism'] } }) } })
  // No reviewer name, human review object, private packet or raw model response.
  const input = { version: plan.version, binding: plan.binding, items: plan.items,
    reasoningPolicyVersion: plan.input.reasoningPolicyVersion, reasoningCriteria: plan.input.reasoningCriteria,
    purpose: plan.input.purpose, scopeRuleVersion: plan.input.scopeRuleVersion,
    scopeCriteria: plan.input.scopeCriteria, scopeCards: plan.input.scopeCards,
    sources: plan.input.sources, applicableMechanisms: plan.input.applicableMechanisms,
    currency: plan.input.currency, baseDate: plan.input.baseDate, observationAt: plan.input.observationAt,
    facts: plan.input.facts }
  return { schema, messages: [{ role: 'system', content: CORRECTION_INSTRUCTIONS + '\nkind는 기존 분류를 유지하면 빈 문자열, 변경하면 허용된 분류를 쓴다.' },
    { role: 'user', content: JSON.stringify(input) }] }
}

export function applyCorrections({ packet, content, plan, patches, revisionDepth = 0 }) {
  if (revisionDepth !== 0) throw new Error('revision_limit_reached')
  const prepared = prepareClaimReview(packet, content)
  if (!plan || !Array.isArray(plan.items) || plan.version !== CLAIM_REVIEW_VERSION || plan.binding !== prepared.binding || plan.planHash !== hash(plan.items) ||
    plan.input?.binding !== prepared.binding || !Array.isArray(patches) || patches.length !== plan.items.length || !safe(patches))
    throw new Error('stale_or_incomplete_correction_plan')
  if (new Set(plan.items.map(i => i.id)).size !== plan.items.length || plan.items.some(i => !prepared.claims.some(c =>
    c.owner !== 'code' && c.id === i.id && c.target === i.target && c.claimHash === i.claimHash && c.quote === i.quote)))
    throw new Error('stale_or_incomplete_correction_plan')
  const next = structuredClone(content), changes = [], seen = new Set()
  for (const patch of patches) {
    if (!patch || typeof patch !== 'object') throw new Error('unauthorized_correction')
    const item = plan.items.find(i => i.id === patch.id)
    if (!patch || !item || seen.has(patch.id) || patch.target !== item.target || patch.claimHash !== item.claimHash ||
      patch.before !== item.quote || typeof patch.after !== 'string' || patch.after.length > 480 || patch.after === patch.before)
      throw new Error('unauthorized_correction')
    if (patch.kind !== undefined && patch.kind !== '' && (!['fact', 'interpretation', 'mechanism'].includes(patch.kind) || !patch.target.endsWith('.text')))
      throw new Error('unauthorized_correction')
    seen.add(patch.id)
    const fields = item.target.split('.'), key = fields.at(-1)
    const object = fields.length === 1 ? next : next[fields[0]][Number(fields[1])]
    // Do not search-and-replace repeated text: locate the exact sentence occurrence.
    const pieces = reviewSentenceSegments(object[key])
    const index = Number(item.id.split(':').at(-1))
    const originalPieces = reviewSentenceSegments(proseTargets(content)[item.target])
    if (originalPieces[index]?.trim() !== patch.before) throw new Error('correction_location_mismatch')
    // Collect by original index; apply all replacements together below.
    changes.push({ ...patch, originalPieces, index, fields, key })
    if (patch.kind) object.kind = patch.kind
    if (!pieces.length) throw new Error('correction_location_mismatch')
  }
  for (const target of new Set(changes.map(c => c.target))) {
    const edits = changes.filter(c => c.target === target), first = edits[0]
    const object = first.fields.length === 1 ? next : next[first.fields[0]][Number(first.fields[1])]
    object[first.key] = first.originalPieces.map((s, i) => {
      const edit = edits.find(e => e.index === i)
      return edit ? (edit.after ? `${s.match(/^\s*/u)[0]}${edit.after}${s.match(/\s*$/u)[0]}` : '') : s
    }).join('').trim()
  }
  // Only explicitly emptied blocks are removed; surviving order is preserved.
  for (const section of ['drivers', 'implications', 'watch']) next[section] = next[section].filter(b => b.title || b.text)
  const safety = validateContent(next, packet), editorial = inspectEditorial(next)
  if (!safety.valid || editorial.blockers.length) return { status: 'hold', content: next, safety, editorial, publicationApproved: false }
  return { version: CLAIM_REVIEW_VERSION, status: 'requires_recheck', content: next, safety, editorial,
    revisionDepth: 1, parentContentHash: hash(content), contentHash: hash(next), reviewBinding: prepared.binding,
    changes: patches, ruleLedgerStatus: 'invalidated_by_revision', humanReviewStatus: 'unverified', publicationApproved: false }
}

// Explicit bounded editing operation. Generation never invokes this on failure.
// Callbacks can use a model or an offline reviewer; caller owns API budget/transport.
export async function runEditorialWorkflow({ packet, content, reviewer, editor, includeRefinements = false }) {
  const frozenPacket = structuredClone(packet), original = structuredClone(content)
  const prepared = prepareClaimReview(frozenPacket, original)
  const review = await reviewer(structuredClone(prepared), claimReviewContract(prepared))
  const assessment = assessClaimReview(prepared, review)
  if (assessment.errors.length) return { status: 'unverified', assessment, publicationApproved: false }
  const plan = correctionPlan(prepared, review, { includeRefinements })
  if (!plan.items.length) return { status: assessment.status === 'unverified' ? 'unverified' : assessment.status==='needs_revision'?'hold':prepared.automatic.valid && !prepared.editorial.blockers.length ? 'reviewed' : 'hold',
    content: original, assessment, publicationApproved: false }
  const edited = await editor(structuredClone(plan), correctionContract(plan))
  const patches = Array.isArray(edited) ? edited : edited?.patches
  const revision = applyCorrections({ packet: frozenPacket, content: original, plan, patches })
  if (revision.status === 'hold') return { ...revision, assessment }
  const recheckInput = prepareClaimReview(frozenPacket, revision.content)
  const recheck = assessClaimReview(recheckInput, await reviewer(structuredClone(recheckInput), claimReviewContract(recheckInput)))
  return { ...revision, status: recheck.status === 'reviewed' ? 'reviewed_revision' : 'hold', originalAssessment: assessment,
    recheck, calls: { reviews: 2, edits: 1 }, publicationApproved: false }
}
